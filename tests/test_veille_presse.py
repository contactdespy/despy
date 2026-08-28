#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du circuit de validation de la presse
#
# test_alertes.py vérifie le TRI (quelles sources, quels articles retenus).
# Celui-ci vérifie le CÂBLAGE, c'est-à-dire tout ce qui se passe après : où
# atterrit un article, qui le voit, et ce qu'un clic dans l'email déclenche.
#
# C'est la partie qu'on ne peut pas essayer à la main sans déployer, et où une
# erreur ne se voit pas : un article de presse publié sans relecture ne
# ressemble à rien d'anormal dans les journaux du serveur. Il apparaît juste
# dans l'application de quelqu'un.
#
# Ce que ça vérifie, sur le VRAI code des fonctions Netlify :
#   1. l'officiel entre en 'publie', la presse en 'a_valider' ;
#   2. aucune notification push n'est envoyée pour un article de presse ;
#   3. le plafond par passage est respecté, et le Bas-Rhin passe en premier ;
#   4. un article déjà en base — même REJETÉ — n'est pas reproposé ;
#   5. les liens de l'email sont acceptés par alert-moderate, et lui seul ;
#   6. un deuxième clic ne change rien (idempotence) ;
#   7. list-alerts ne demande à la base que ce qui est publié.
#
# jsc n'a ni require, ni crypto, ni fetch : on les fabrique. Le faux crypto
# suffit ici — les deux côtés du test signent avec le même, donc on vérifie
# bien que les liens concordent, ce qui est la question posée.
#
# Usage : python3 tests/test_veille_presse.py
# ════════════════════════════════════════════

import io, json, os, subprocess, sys, tempfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

# Les modules réels chargés dans le bac à sable. Tout le reste est simulé.
REELS = ['_privacy-sign', '_presse-recap', '_alert-sources',
         '_is-scheduled', 'national-alerts', 'alert-moderate', 'list-alerts']


def lire(nom):
    return io.open(os.path.join(FONCTIONS, nom + '.js'), encoding='utf-8').read()


SOCLE = r"""
// ── Ce que jsc n'a pas ────────────────────────────────────────────────────
var console = { log: function(){}, error: function(){}, warn: function(){} };
var AbortSignal = { timeout: function(){ return null; } };
var process = { env: {
  SUPABASE_URL: 'https://exemple.supabase.co',
  SUPABASE_SERVICE_KEY: 'cle-de-test',
  RESEND_API_KEY: 'cle-resend-de-test',
  INTERNAL_SECRET: 'secret-de-test',
  URL: 'https://despy.fr'
} };
var Buffer = { from: function (s) { return { toString: function(){ return String(s); } }; } };

// Journal de tout ce que le code tente de faire sortir : c'est lui qu'on
// interroge à la fin.
var JOURNAL = { insertions: [], majs: [], push: [], emails: [], requetes: [] };

// ── Faux crypto : déterministe, suffisant pour vérifier une concordance ───
var __crypto__ = {
  createHmac: function (algo, secret) {
    var acc = '';
    return {
      update: function (s) { acc += s; return this; },
      digest: function () {
        var h = 0, i;
        for (i = 0; i < (secret + '|' + acc).length; i++) {
          h = ((h << 5) - h + (secret + '|' + acc).charCodeAt(i)) | 0;
        }
        return ('0000000' + (h >>> 0).toString(16)).slice(-8).repeat(6);
      }
    };
  }
};

// ── Faux Supabase ─────────────────────────────────────────────────────────
// Reproduit le strict nécessaire du client chaîné, et surtout son
// comportement essentiel : il RENVOIE les erreurs, il ne les lève pas.
var TABLE = [];          // contenu simulé de national_alerts
var SANS_COLONNE = false;  // bascule : migration SQL pas encore exécutée
var PROCHAIN_ID = 100;

function requete(nom) {
  var q = { table: nom, type: null, filtres: [], valeurs: null, colonnes: null };
  var api = {};
  api.select = function (c) { q.colonnes = c; if (!q.type) q.type = 'select'; return api; };
  api.insert = function (v) { q.type = 'insert'; q.valeurs = v; return api; };
  api.update = function (v) { q.type = 'update'; q.valeurs = v; return api; };
  api.delete = function () { q.type = 'delete'; return api; };
  api.eq = function (c, v) { q.filtres.push(['eq', c, v]); return api; };
  api.in = function (c, v) { q.filtres.push(['in', c, v]); return api; };
  api.or = function (v) { q.filtres.push(['or', v]); return api; };
  api.order = function () { return api; };
  api.limit = function () { return executer(q); };
  api.maybeSingle = function () { return executer(q); };
  api.then = function (ok, ko) { return executer(q).then(ok, ko); };
  return api;
}

function executer(q) {
  JOURNAL.requetes.push({ table: q.table, type: q.type, filtres: q.filtres });

  if (q.table === 'push_subscriptions') {
    return Promise.resolve({ data: [{ endpoint: 'https://push.test/x',
                                      p256dh: 'p', auth: 'a' }], error: null });
  }

  if (q.table === 'national_alerts') {
    // Simule l'état du jour du déploiement : le code est en ligne, le script
    // SQL n'a pas encore été passé dans Supabase.
    if (SANS_COLONNE && q.type === 'select' && q.colonnes === 'status') {
      return Promise.resolve({ data: null,
        error: { message: 'column national_alerts.status does not exist' } });
    }
    if (q.type === 'insert') {
      var ligne = {};
      for (var k in q.valeurs) ligne[k] = q.valeurs[k];
      ligne.id = PROCHAIN_ID++;
      TABLE.push(ligne);
      JOURNAL.insertions.push(ligne);
      return Promise.resolve({ data: { id: ligne.id }, error: null });
    }
    if (q.type === 'update') {
      var cibles = TABLE.filter(function (r) {
        return q.filtres.every(function (f) {
          return f[0] !== 'eq' || String(r[f[1]]) === String(f[2]);
        });
      });
      if (!cibles.length) return Promise.resolve({ data: null, error: null });
      for (var i = 0; i < cibles.length; i++) {
        for (var c in q.valeurs) cibles[i][c] = q.valeurs[c];
      }
      JOURNAL.majs.push({ filtres: q.filtres, valeurs: q.valeurs, touchees: cibles.length });
      return Promise.resolve({ data: cibles[0], error: null });
    }
    // select
    var res = TABLE.filter(function (r) {
      return q.filtres.every(function (f) {
        return f[0] !== 'eq' || String(r[f[1]]) === String(f[2]);
      });
    });
    return Promise.resolve({ data: res, error: null });
  }
  return Promise.resolve({ data: [], error: null });
}

var __supabase__ = { createClient: function () { return { from: requete }; } };
var __webpush__ = {
  setVapidDetails: function () {},
  sendNotification: function (sub, payload) {
    JOURNAL.push.push(JSON.parse(payload));
    return Promise.resolve();
  }
};

// ── Faux fetch : n'existe que pour Resend et les flux ──────────────────────
var __FLUX__ = {};
function fetch(url, opts) {
  if (String(url).indexOf('api.resend.com') !== -1) {
    JOURNAL.emails.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, status: 200 });
  }
  var xml = __FLUX__[url];
  return Promise.resolve({
    ok: typeof xml === 'string' && xml.length > 0,
    status: (typeof xml === 'string' && xml.length) ? 200 : 599,
    text: function () { return Promise.resolve(xml || ''); }
  });
}

// ── require ───────────────────────────────────────────────────────────────
var __SRC__ = {}, __CACHE__ = {};
function require(nom) {
  if (nom === 'crypto') return __crypto__;
  if (nom === '@supabase/supabase-js') return __supabase__;
  if (nom === 'web-push') return __webpush__;
  // Modules simulés : leur contenu n'est pas le sujet de ce banc.
  if (nom === './_calendrier-arnaques') return { fichesAPublier: function(){ return Promise.resolve([]); } };
  if (nom === './_vagues') return { detecterVagues: function(){ return Promise.resolve([]); } };

  var court = String(nom).replace('./', '');
  if (__CACHE__[court]) return __CACHE__[court].exports;
  if (!__SRC__[court]) throw new Error('module inconnu dans le bac à sable : ' + nom);
  var m = { exports: {} };
  __CACHE__[court] = m;
  (new Function('module', 'exports', 'require', __SRC__[court]))(m, m.exports, require);
  return m.exports;
}
"""


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    srcs = {n: lire(n) for n in REELS}

    # Faux flux : on n'appelle pas le réseau. Trois articles de presse dont un
    # local, un article officiel, et un article de presse au-delà du plafond.
    from email.utils import formatdate
    import time
    recent = formatdate(time.time() - 3600, usegmt=True)

    def item(titre, lien, source=None):
        s = '<source url="https://x">%s</source>' % source if source else ''
        return ('<item><title>%s</title><link>%s</link>'
                '<pubDate>%s</pubDate>'
                '<description>&lt;a href="https://news.google.com/rss/articles/'
                'CBMiSPORTPSGuniversitBASE64"&gt;%s&lt;/a&gt;</description>'
                '%s</item>') % (titre, lien, recent, titre, s)

    def rss(items):
        return '<?xml version="1.0"?><rss><channel>' + ''.join(items) + '</channel></rss>'

    # 12 articles nationaux pour dépasser le plafond de 10.
    #
    # Ils doivent parler de choses DIFFÉRENTES, sinon le regroupement les
    # réduit à un seul et le plafond n'est jamais atteint. Première version de
    # ce banc : douze titres identiques à un numéro près — le module n'en a
    # gardé qu'un, à juste titre, et c'est le banc qui avait tort.
    SUJETS = [
        'Arnaque au faux conseiller bancaire, un retraite depouille',
        'Escroquerie au faux coursier : les cartes recuperees a domicile',
        'Hameconnage au nom de Doctolib : le faux kit medical circule',
        'Arnaque au compteur Linky : de faux techniciens sonnent aux portes',
        'Escroquerie au chantage a la webcam relancee par courriel',
        'Arnaque au faux depannage informatique par appel telephonique',
        'Fraude aux faux ordres de virement chez les notaires',
        'Escroquerie au placement en cryptomonnaie promise sans risque',
        'Arnaque a la fausse amende de stationnement par message',
        'Hameconnage au nom de la mutuelle pour une carte vitale',
        'Escroquerie au faux gendarme reclamant des bons cadeaux',
        'Arnaque au demarchage pour des panneaux solaires jamais poses'
    ]
    nat = [item(t, 'https://presse.test/national-%d' % (i + 1), 'Journal%d' % (i + 1))
           for i, t in enumerate(SUJETS)]
    loc = [item('Strasbourg : deux seniors victimes d une arnaque telephonique',
                'https://presse.test/local-1', 'Actu.fr')]
    off = [item('Hameconnage : attention aux faux courriels des impots',
                'https://officiel.test/cnil-1')]

    flux = {}
    # On associe les faux flux aux VRAIES URL déclarées par le module.
    sondage = jsc(SOCLE + '\n'
                  + registre(srcs) + '\n'
                  + "var S = require('./_alert-sources').SOURCES;\n"
                  + "print(JSON.stringify(S.map(function(s){"
                  + " return { nom: s.nom, url: s.url, confiance: s.confiance }; })));")
    if sondage.returncode != 0 or not sondage.stdout.strip():
        sys.exit('ERREUR de chargement :\n' + (sondage.stderr or '')[:1500])
    sources = json.loads(sondage.stdout.strip().splitlines()[-1])

    for s in sources:
        if s['nom'] == 'Presse nationale':
            flux[s['url']] = rss(nat)
        elif s['nom'] == 'Presse locale':
            flux[s['url']] = rss(loc)
        elif s['nom'] == 'CNIL':
            flux[s['url']] = rss(off)
        else:
            flux[s['url']] = rss([])

    scenario = r"""
var sortie = {};

// Une ligne déjà en base, REJETÉE à la main : elle ne doit jamais revenir.
TABLE.push({ id: 7, title: 'Deja rejete', url: 'https://presse.test/national-3',
             status: 'rejete', confiance: 'presse' });
// Une ligne d'avant la migration : pas de statut. Elle doit rester visible.
TABLE.push({ id: 8, title: 'Ancienne alerte', url: 'https://officiel.test/vieux',
             status: null, confiance: null });

var cron = require('./national-alerts');
var moder = require('./alert-moderate');
var lister = require('./list-alerts');

cron.handler({ body: JSON.stringify({ next_run: '2026-08-29T09:00:00Z' }) })
.then(function (r) {
  sortie.retour = JSON.parse(r.body);

  var ins = JOURNAL.insertions;
  sortie.publies   = ins.filter(function(a){ return a.status === 'publie'; })
                        .map(function(a){ return a.title; });
  sortie.a_valider = ins.filter(function(a){ return a.status === 'a_valider'; })
                        .map(function(a){ return { titre: a.title, source: a.source,
                                                   confiance: a.confiance }; });
  sortie.sans_statut = ins.filter(function(a){ return !a.status; }).length;

  // Une notification pour un article de presse serait la faute grave : on
  // réveille des gens avec une information que personne n'a relue.
  sortie.push_titres = JOURNAL.push.map(function(p){ return p.title; });
  var titresPresse = sortie.a_valider.map(function(a){ return a.titre; });
  sortie.push_de_presse = sortie.push_titres.filter(function (t) {
    return titresPresse.some(function (p) { return p.indexOf(t.replace('…','')) === 0; });
  });

  sortie.nb_emails = JOURNAL.emails.length;
  var mail = JOURNAL.emails[0] || {};
  sortie.objet = mail.subject || '';
  sortie.destinataire = (mail.to || [])[0] || '';

  // Le rejeté ne doit pas revenir.
  sortie.rejete_repropose = ins.filter(function (a) {
    return a.url === 'https://presse.test/national-3';
  }).length;

  // ── Les liens de l'email ────────────────────────────────────────────────
  var liens = (mail.html || '').match(/https:\/\/despy\.fr\/\.netlify\/functions\/alert-moderate\?[^"]+/g) || [];
  sortie.nb_liens = liens.length;

  function params(u) {
    var o = {};
    u.split('?')[1].split('&').forEach(function (p) {
      var kv = p.split('='); o[kv[0]] = kv[1];
    });
    return o;
  }
  var publier = liens.filter(function (u) { return params(u).d === 'publier'; })[0];
  var p = params(publier);
  sortie.cible = Number(p.a);

  // 1er clic : publie.
  return moder.handler({ queryStringParameters: { a: p.a, d: p.d, k: p.k } })
  .then(function (r1) {
    sortie.clic1_code = r1.statusCode;
    sortie.clic1_publie = r1.body.indexOf('Publié') !== -1;
    sortie.statut_apres = TABLE.filter(function(x){ return x.id === Number(p.a); })[0].status;

    // 2e clic : ne doit rien changer.
    return moder.handler({ queryStringParameters: { a: p.a, d: p.d, k: p.k } });
  })
  .then(function (r2) {
    sortie.clic2_deja = r2.body.indexOf('Déjà traité') !== -1;

    // Signature bricolée : doit être refusée.
    return moder.handler({ queryStringParameters: { a: p.a, d: 'publier', k: 'faux' } });
  })
  .then(function (r3) {
    sortie.faux_code = r3.statusCode;

    // Changer la décision en gardant la signature du « publier » : refusé
    // aussi, sinon un lien « publier » vaudrait « rejeter ».
    return moder.handler({ queryStringParameters: { a: p.a, d: 'rejeter', k: p.k } });
  })
  .then(function (r4) {
    sortie.decision_permutee_code = r4.statusCode;

    JOURNAL.requetes = [];
    return lister.handler({ httpMethod: 'GET' });
  })
  .then(function () {
    var q = JOURNAL.requetes.filter(function (r) {
      return r.table === 'national_alerts' && r.type === 'select';
    })[0] || { filtres: [] };
    sortie.filtre_lecture = q.filtres.map(function (f) { return f.join(':'); });

    // ── Deuxième passage, migration SQL pas encore exécutée ───────────────
    SANS_COLONNE = true;
    TABLE.length = 0;
    JOURNAL.insertions = []; JOURNAL.emails = []; JOURNAL.push = [];
    return cron.handler({ body: JSON.stringify({ next_run: '2026-08-29T18:00:00Z' }) });
  })
  .then(function (r) {
    sortie.repli_code = r.statusCode;
    sortie.repli_inserees = JOURNAL.insertions.length;
    sortie.repli_presse = JOURNAL.insertions.filter(function (a) {
      return a.confiance === 'presse' || a.status === 'a_valider';
    }).length;
    sortie.repli_statuts = JOURNAL.insertions.map(function (a) { return a.status; });
    sortie.repli_emails = JOURNAL.emails.length;
    print(JSON.stringify(sortie));
  });
})
.catch(function (e) {
  print(JSON.stringify({ erreur: String((e && e.stack) || e) }));
});
"""

    code = (SOCLE + '\nvar __FLUX__ = ' + json.dumps(flux) + ';\n'
            + registre(srcs) + '\n' + scenario)
    r = jsc(code)
    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — le scénario n\'a pas pu tourner :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    try:
        d = json.loads(brut.splitlines()[-1])
    except Exception:
        print('Sortie inattendue :\n' + brut[:2000])
        return 1
    if 'erreur' in d:
        print('ÉCHEC pendant le scénario :\n' + d['erreur'][:2000])
        return 1

    ok = [True]

    def controle(intitule, obtenu, attendu):
        bon = obtenu == attendu
        ok[0] = ok[0] and bon
        print('  %-5s %-46s %r' % ('OK' if bon else 'ÉCHEC', intitule, obtenu))
        if not bon:
            print('        attendu : %r' % (attendu,))

    print('═' * 74)
    print('OÙ ATTERRIT CHAQUE ARTICLE')
    print('═' * 74)
    controle('officiel publié directement', len(d['publies']), 1)
    controle('presse mise en attente', len(d['a_valider']), 10)
    controle('aucune insertion sans statut', d['sans_statut'], 0)
    controle('presse étiquetée « presse »',
             sorted(set(a['confiance'] for a in d['a_valider'])), ['presse'])
    controle('plafond de 10 respecté',
             d['retour'].get('presse_en_attente'), 10)
    controle('le Bas-Rhin passe en premier',
             'Strasbourg' in d['a_valider'][0]['titre'], True)
    controle('un article rejeté n\'est pas reproposé', d['rejete_repropose'], 0)

    print()
    print('═' * 74)
    print('CE QUI SORT VERS LES GENS')
    print('═' * 74)
    controle('aucune notification pour la presse', d['push_de_presse'], [])
    controle('un seul email pour tout le passage', d['nb_emails'], 1)
    controle('objet signalant le local',
             'Bas-Rhin' in d['objet'], True)
    controle('envoyé à la boîte de modération',
             d['destinataire'], 'contact.despy@gmail.com')
    controle('deux boutons par article', d['nb_liens'], 20)

    print()
    print('═' * 74)
    print('CE QU\'UN CLIC DÉCLENCHE')
    print('═' * 74)
    controle('lien valide accepté', d['clic1_code'], 200)
    controle('page « Publié »', d['clic1_publie'], True)
    controle('statut passé à publié', d['statut_apres'], 'publie')
    controle('deuxième clic sans effet', d['clic2_deja'], True)
    controle('signature bricolée refusée', d['faux_code'], 403)
    controle('« publier » ne vaut pas « rejeter »',
             d['decision_permutee_code'], 403)

    print()
    print('═' * 74)
    print('CE QUE L\'APPLICATION DEMANDE')
    print('═' * 74)
    controle('lecture restreinte aux publiées',
             d['filtre_lecture'], ['or:status.is.null,status.eq.publie'])

    print()
    print('═' * 74)
    print('SI LE SCRIPT SQL N\'A PAS ENCORE ÉTÉ PASSÉ')
    print('═' * 74)
    controle('le robot ne tombe pas', d['repli_code'], 200)
    controle('les alertes officielles continuent', d['repli_inserees'], 1)
    controle('aucune presse écrite', d['repli_presse'], 0)
    controle('écrites sans statut, donc publiées comme avant',
             d['repli_statuts'], [None])
    controle('aucun email de validation', d['repli_emails'], 0)

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok[0]
                           else 'au moins un contrôle a échoué.'))
    return 0 if ok[0] else 1


def registre(srcs):
    return '\n'.join("__SRC__[%s] = %s;" % (json.dumps(n), json.dumps(s))
                     for n, s in srcs.items())


def jsc(code):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(code)
        chemin = f.name
    try:
        return subprocess.run([JSC, chemin], capture_output=True,
                              text=True, timeout=90)
    finally:
        os.unlink(chemin)


if __name__ == '__main__':
    sys.exit(main())
