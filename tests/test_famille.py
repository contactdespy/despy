#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai de l'offre Famille
#
# Un proche Famille n'a pas d'abonnement à son nom : c'est le payeur qui
# porte `subscribed = true`. Jusqu'ici, seul l'écran de connexion le savait.
# Tout le reste du serveur lisait `subscribed` seul — si bien que le parent
# pour qui la famille paie 14,99 € par mois :
#   · butait sur le quota de 5 questions du chat ;
#   · recevait le teaser gratuit au lieu de l'alerte complète ;
#   · n'avait ni surveillance des fuites, ni entraînement, ni bilan ;
#   · et recevait « Dernière chance : 2 mois offerts ».
#
# Ce banc fait tourner les VRAIS fichiers (chargés avec leurs vrais `require`
# vers _famille.js) sur une fausse base où vivent :
#   fils     — payeur Famille, abonné
#   mamie    — sa proche, lien actif → DOIT être traitée en abonnée
#   resilie  — ancien payeur Famille qui a résilié
#   tonton   — son proche : lien actif, mais plus rien ne le couvre
#   solo     — abonné à la formule individuelle
#   cousin   — rattaché à solo : une formule Solo ne couvre personne
#   libre    — vrai compte gratuit, sans famille
#
# Le contrôle va dans les deux sens : mamie doit tout recevoir, tonton,
# cousin et libre ne doivent rien recevoir de plus qu'avant. Un correctif qui
# ouvrirait le service payant à tous les rattachés serait une fuite de revenu.
#
# Usage : python3 tests/test_famille.py
# ════════════════════════════════════════════

import json, os, re, shutil, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

HARNAIS = r"""
var DIR = __DIR__;
var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: { URL: 'https://despy.fr', INTERNAL_SECRET: 's',
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' } };
var setTimeout = function (f) { f(); return 0; };

var MAINTENANT = new Date();
function ilYa(jours) { return new Date(MAINTENANT.getTime() - jours * 86400000).toISOString(); }
var PERIODE = MAINTENANT.toISOString().slice(0, 7);

var TABLES, PANNE, ENVOIS;
function remettre() {
  TABLES = {
    clients: [
      { email: 'fils@x.fr',    prenom: 'Karim',  subscribed: true,  plan: 'family_monthly', questions_used: 4, created_at: ilYa(200) },
      { email: 'mamie@x.fr',   prenom: 'Fatima', subscribed: false, plan: 'free',           questions_used: 0, created_at: ilYa(1) },
      { email: 'resilie@x.fr', prenom: 'Paul',   subscribed: false, plan: 'family_annual',  questions_used: 2, created_at: ilYa(300) },
      { email: 'tonton@x.fr',  prenom: 'Ali',    subscribed: false, plan: 'free',           questions_used: 0, created_at: ilYa(1) },
      { email: 'solo@x.fr',    prenom: 'Léa',    subscribed: true,  plan: 'monthly',        questions_used: 9, created_at: ilYa(90) },
      { email: 'cousin@x.fr',  prenom: 'Sami',   subscribed: false, plan: 'free',           questions_used: 0, created_at: ilYa(1) },
      { email: 'libre@x.fr',   prenom: 'Anne',   subscribed: false, plan: 'free',           questions_used: 0, created_at: ilYa(1) }
    ],
    family_members: [
      { member_email: 'mamie@x.fr',  owner_email: 'fils@x.fr',    status: 'active' },
      { member_email: 'tonton@x.fr', owner_email: 'resilie@x.fr', status: 'active' },
      { member_email: 'cousin@x.fr', owner_email: 'solo@x.fr',    status: 'active' },
      { member_email: null,          owner_email: 'fils@x.fr',    status: 'invited' }
    ],
    monthly_modules: [
      { id: 1, period: PERIODE, status: 'published', title: "L'arnaque du mois", intro: 'i', questions: [] }
    ],
    sent_alerts: []
  };
  PANNE = {};
  ENVOIS = [];
}

function copie(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

function Q(table) {
  var filtres = [], op = 'select', seul = false;
  var q = {};
  q.select = function () { return q; };
  q.eq  = function (c, v) { filtres.push(function (r) { return r[c] === v; }); return q; };
  q.in  = function (c, vs) { filtres.push(function (r) { return vs.indexOf(r[c]) >= 0; }); return q; };
  q.gte = function (c, v) { filtres.push(function (r) { return r[c] != null && r[c] >= v; }); return q; };
  q.lte = function (c, v) { filtres.push(function (r) { return r[c] != null && r[c] <= v; }); return q; };
  q.order = q.limit = q.not = q.is = function () { return q; };
  q.maybeSingle = q.single = function () { seul = true; return q; };
  q.insert = function () { op = 'insert'; return q; };
  q.update = function () { op = 'update'; return q; };
  q.upsert = function () { op = 'upsert'; return q; };
  q.then = function (ok, ko) {
    var rep;
    if (PANNE[table]) rep = { data: null, error: { message: 'panne ' + table } };
    else if (op !== 'select') rep = { data: null, error: null };
    else {
      var lignes = (TABLES[table] || []).filter(function (r) {
        return filtres.every(function (f) { return f(r); });
      }).map(copie);
      rep = { data: seul ? (lignes[0] || null) : lignes, error: null };
    }
    return Promise.resolve(rep).then(ok, ko);
  };
  return q;
}

function fetch(url, opts) {
  if (/send-email/.test(url)) {
    var c = JSON.parse(opts.body);
    ENVOIS.push({ email: c.data.email, type: c.type });
  }
  return Promise.resolve({ ok: true, status: 200,
    json: function () { return Promise.resolve({}); },
    text: function () { return Promise.resolve(''); } });
}

var CACHE = {};
function require(nom) {
  if (nom === '@supabase/supabase-js') return { createClient: function () { return { from: Q }; } };
  if (nom === './_auth') return { requireAuth: function () { return { ok: true }; },
                                  rateLimit: function () { return true; },
                                  issueToken: function () { return 'jeton'; } };
  if (nom === './_is-scheduled') return { isScheduled: function () { return true; },
                                          notScheduled: function () { return { statusCode: 400 }; } };
  if (nom === './_alert-sources') return { collecterAlertes: function () {
    return Promise.resolve([{ title: 'Faux conseiller bancaire', url: 'https://exemple.fr/a1',
      source: 'ANSSI', published: MAINTENANT.toISOString(), description: 'd' }]); } };
  if (nom.indexOf('./') === 0) {
    var k = nom.slice(2).replace(/\.js$/, '');
    if (CACHE[k]) return CACHE[k].exports;
    var m = { exports: {} };
    CACHE[k] = m;
    var src = read(DIR + '/' + k + '.js');
    (new Function('require', 'module', 'exports', 'process', 'console', 'fetch', 'setTimeout', src))
      (require, m, m.exports, process, console, fetch, setTimeout);
    return m.exports;
  }
  throw new Error('module inattendu : ' + nom);
}
"""

VERIF = r"""
var R = [];
// Comparaison indépendante de l'ordre des clés : c'est le contenu qui compte.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}
function note(nom, attendu, obtenu) {
  R.push({ nom: nom, ok: canon(attendu) === canon(obtenu),
           attendu: attendu, obtenu: obtenu });
}
function echec(nom, e) { R.push({ nom: nom, ok: false, attendu: '—', obtenu: 'EXCEPTION ' + (e && e.message || e) }); }
function tri(a) { return a.slice().sort(); }
function sb() { return require('@supabase/supabase-js').createClient(); }

var F = require('./_famille');

Promise.resolve()
  // ── Les outils ──────────────────────────────────────────────────────────
  .then(function () { remettre();
    if (!F.prochesCouverts) throw new Error('prochesCouverts absent');
    return F.prochesCouverts(sb()).then(function (s) {
      note('qui est couvert : mamie seule', ['mamie@x.fr'], tri(Array.from(s))); }); })
  .catch(function (e) { echec('qui est couvert : mamie seule', e); })

  .then(function () { remettre();
    if (!F.estCouvert) throw new Error('estCouvert absent');
    var c = sb(), L = TABLES.clients, out = {};
    return L.reduce(function (p, cl) {
      return p.then(function () { return F.estCouvert(c, cl).then(function (v) { out[cl.email.split('@')[0]] = v; }); });
    }, Promise.resolve()).then(function () {
      note('droit au service, personne par personne',
        { cousin: false, fils: true, libre: false, mamie: true, resilie: false, solo: true, tonton: false },
        out); }); })
  .catch(function (e) { echec('droit au service, personne par personne', e); })

  .then(function () { remettre();
    if (!F.avecProches) throw new Error('avecProches absent');
    var payeurs = TABLES.clients.filter(function (c) { return c.subscribed; }).map(copie);
    return F.avecProches(sb(), payeurs, 'email, prenom').then(function (l) {
      var m = l.filter(function (x) { return x.email === 'mamie@x.fr'; })[0] || {};
      note('envoi abonnés : payeurs + mamie, marquée abonnée',
        { emails: ['fils@x.fr', 'mamie@x.fr', 'solo@x.fr'], mamie: [true, 'family_member'] },
        { emails: tri(l.map(function (x) { return x.email; })), mamie: [m.subscribed, m.plan] }); }); })
  .catch(function (e) { echec('envoi abonnés : payeurs + mamie, marquée abonnée', e); })

  .then(function () { remettre();
    return F.avecProches(sb(), [], 'email', { parmi: ['fils@x.fr', 'libre@x.fr'] }).then(function (l) {
      note("restreint à une liste où mamie n'est pas : personne d'ajouté", [],
           l.map(function (x) { return x.email; })); }); })
  .catch(function (e) { echec("restreint à une liste où mamie n'est pas : personne d'ajouté", e); })

  .then(function () { remettre();
    return F.avecProches(sb(), [{ email: 'mamie@x.fr' }], 'email').then(function (l) {
      note('mamie déjà présente : pas de doublon', 1, l.length); }); })
  .catch(function (e) { echec('mamie déjà présente : pas de doublon', e); })

  .then(function () { remettre(); PANNE.family_members = true;
    return F.prochesCouverts(sb()).then(function (s) {
      note('table famille en panne : ensemble vide, pas de plantage', 0, s.size); }); })
  .catch(function (e) { echec('table famille en panne : ensemble vide, pas de plantage', e); })

  // ── Les vraies fonctions ────────────────────────────────────────────────
  .then(function () { remettre();
    var h = require('./monthly-module').handler, out = {};
    function lit(qui) {
      return h({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ email: qui + '@x.fr' }) })
        .then(function (r) { var m = JSON.parse(r.body).module; out[qui] = !!(m && m.locked); });
    }
    return lit('mamie').then(function () { return lit('libre'); })
      .then(function () { return lit('tonton'); })
      .then(function () { note('module du mois verrouillé ?', { libre: true, mamie: false, tonton: true }, out); }); })
  .catch(function (e) { echec('module du mois verrouillé ?', e); })

  .then(function () { remettre();
    return require('./cyber-alerts').handler({ body: '{}' }).then(function () {
      var par = {};
      ENVOIS.forEach(function (e) { (par[e.email.split('@')[0]] = par[e.email.split('@')[0]] || []).push(e.type); });
      note('alerte cyber : complète ou teaser',
        { cousin: ['cyber_alert_free'], fils: ['cyber_alert'], libre: ['cyber_alert_free'],
          mamie: ['cyber_alert'], resilie: ['cyber_alert_free'], solo: ['cyber_alert'],
          tonton: ['cyber_alert_free'] }, par); }); })
  .catch(function (e) { echec('alerte cyber : complète ou teaser', e); })

  .then(function () { remettre();
    return require('./onboarding-sequence').handler({ body: '{}' }).then(function () {
      note('séquence « abonnez-vous » J+1 : qui la reçoit',
        ['cousin@x.fr', 'libre@x.fr', 'tonton@x.fr'],
        tri(ENVOIS.map(function (e) { return e.email; }))); }); })
  .catch(function (e) { echec('séquence « abonnez-vous » J+1 : qui la reçoit', e); })

  .then(function () { print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

# Fichiers où `subscribed` veut dire « PAIE », et doit le rester. Tout autre
# fichier qui lit `subscribed` doit passer par _famille — sinon, c'est
# exactement le défaut corrigé ici qui revient, un fichier à la fois.
PAYEURS_SEULEMENT = {
    'admin-stats.js':          "compte ceux qui paient",
    'get-count.js':            "compteur public des abonnés payants",
    'stripe-webhook.js':       "écrit l'état du paiement",
    'register-free.js':        "crée un compte gratuit",
    'set-initial-password.js': "ne sert qu'à celui qui vient de payer",
    'referral-status.js':      "parrainage : ne concerne que le payeur",
    'sos-request.js':          "reçoit le statut déjà calculé par l'appli",
}


def banc(dossier):
    src = HARNAIS.replace('__DIR__', json.dumps(dossier)) + '\n' + VERIF
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(src)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)
    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        return None, (r.stderr or '').strip()[:2000] or brut[:2000]
    d = json.loads(brut.splitlines()[-1])
    if isinstance(d, dict):
        return None, d.get('erreur', str(d))
    return d, None


def afficher(d):
    ok = True
    for c in d:
        ok = ok and c['ok']
        print('  %-5s %s' % ('OK' if c['ok'] else 'ÉCHEC', c['nom']))
        if not c['ok']:
            print('        attendu : %s' % json.dumps(c['attendu'], ensure_ascii=False))
            print('        obtenu  : %s' % json.dumps(c['obtenu'], ensure_ascii=False))
    return ok


def relecture():
    print()
    print('═' * 74)
    print('AUCUN FICHIER NE DÉCIDE « ABONNÉ » SANS CONNAÎTRE LA FAMILLE')
    print('═' * 74)
    fautes = []
    for nom in sorted(os.listdir(FONCTIONS)):
        if not nom.endswith('.js') or nom in ('_famille.js',):
            continue
        s = open(os.path.join(FONCTIONS, nom), encoding='utf-8').read()
        code = re.sub(r'//[^\n]*', '', s)
        if not re.search(r"\bsubscribed\b", code):
            continue
        if nom in PAYEURS_SEULEMENT or "require('./_famille')" in s:
            continue
        fautes.append(nom)
    for f in fautes:
        print("  ÉCHEC %s lit `subscribed` sans passer par _famille "
              "(ou l'ajouter à PAYEURS_SEULEMENT, avec la raison)" % f)
    if not fautes:
        print('  OK    chaque lecture de `subscribed` connaît la famille, ou compte les payeurs')
    return not fautes


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    print('═' * 74)
    print('CE QUE REÇOIT CHACUN, SELON QUI PAIE POUR LUI')
    print('═' * 74)
    d, err = banc(FONCTIONS)
    if err:
        print('ÉCHEC — le banc n\'a pas pu tourner :\n' + err)
        return 1
    ok = afficher(d)
    ok = relecture() and ok
    print()
    print('TOUT EST BON' if ok else 'IL Y A DES ÉCHECS')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
