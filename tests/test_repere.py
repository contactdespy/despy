#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du fil « Repéré par Despy »
#
# Le fil montre au client ce que Despy a repéré. La règle qui le fonde : rien
# n'y est inventé. Chaque ligne est une arnaque que le client nous a montrée,
# une vague détectée chez les membres, une arnaque de saison annoncée avant le
# pic, ou une alerte relevée par la veille — et elle est nommée pour ce
# qu'elle est. Jamais « bloquée » ni « interceptée » : Despy ne bloque rien.
#
# Ce banc fait tourner le VRAI code de l'appli (faux DOM) et le VRAI
# _repere.js (fausse base), et vérifie aussi le texte des notifications.
#
# Usage : python3 tests/test_repere.py
# ════════════════════════════════════════════

import json, os, re, subprocess, sys, tempfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(RACINE, 'despy_app_v23.html')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')


def extraire(src, nom):
    d = src.index('function %s(' % nom)
    i = src.index('{', d)
    prof = 0
    while True:
        if src[i] == '{':
            prof += 1
        elif src[i] == '}':
            prof -= 1
            if prof == 0:
                return src[d:i + 1]
        i += 1


def jsc(code):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(code)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)
    lignes = (r.stdout or '').strip().splitlines()
    if r.returncode != 0 or not lignes:
        raise RuntimeError(((r.stderr or '') + (r.stdout or ''))[:2000])
    return json.loads(lignes[-1])


# ── L'appli, sur un faux DOM ─────────────────────────────────────────
APPLI = r"""
var console = { warn: function(){}, error: function(){}, log: function(){} };
var STOCK = {};
var localStorage = { getItem: function (k) { return k in STOCK ? STOCK[k] : null; },
                     setItem: function (k, v) { STOCK[k] = String(v); } };
var ELS;
function neuf() {
  ELS = { 'home-rp': { style: { display: 'none' }, innerHTML: '' }, 'rp-liste': { style: {}, innerHTML: '' },
          'rp-total': { style: {}, innerHTML: '' }, 'rp-tout': { style: {}, innerHTML: '' } };
}
neuf();
var document = { getElementById: function (i) { return ELS[i] || null; } };
var FICHE = null;
function openSheet(t, h) { FICHE = { titre: t, html: h }; }
var ALERTES = [];
function fetch() { return Promise.resolve({ json: function () { return Promise.resolve({ alerts: ALERTES }); } }); }
function jours(n) { return new Date(Date.now() - n * 864e5).toISOString(); }
function lire() {
  var h = ELS['rp-liste'].innerHTML;
  var lignes = h.split('<button class="listrow"').slice(1).map(function (b) {
    return { nature: (b.match(/rp-ic-(\w+)/) || [])[1],
             titre: (b.match(/<span class="a">([^<]*)/) || [])[1],
             sous: (b.match(/<span class="b">([^<]*)<\/span>/) || [])[1],
             nouveau: b.indexOf('rp-new') !== -1 };
  });
  return { carte: ELS['home-rp'].style.display, total: ELS['rp-total'].style.display === 'none' ? '' : ELS['rp-total'].innerHTML,
           tout: ELS['rp-tout'].style.display, lignes: lignes, brut: h };
}
function drainer(f) { var p = Promise.resolve(); for (var k = 0; k < 30; k++) p = p.then(function () {}); return p.then(f); }
"""

SCENARIO_APPLI = r"""
var R = {};
ALERTES = [
  { title: 'Hameçonnage aux faux votes pour des concours sur WhatsApp', source: 'Cybermalveillance.gouv.fr', url: 'https://x/1', created_at: jours(12) },
  { title: 'Black Friday : le pic annuel des faux SMS de livraison', source: 'Despy · Anticipation', url: 'https://x/2', created_at: jours(2) },
  { title: 'Vague d’arnaque détectée : le site colis-suivi.top', source: 'Despy · détecté chez nos utilisateurs', url: 'https://x/3', created_at: jours(5) },
  { title: 'Une vieille alerte qui ne doit plus sortir', source: 'Clubic · presse', url: 'https://x/4', created_at: jours(40) }
];
majAlerteNationale();
drainer(function () {
  R.veille_seule = lire();
  majReperesClient({ reperes: [ { extrait: 'Votre colis est en attente, réglez 1,99 € ici : <script>x</script>', at: jours(1) } ],
                     arnaques_membres: 1234 });
  R.complet = lire();
  R.tout_dans_la_fiche = elementsReperes().length;
  openReperes();
  R.fiche = FICHE; R.apres_fiche = lire();
  majReperesClient({ reperes: [], arnaques_membres: 9 });   R.total_petit = lire().total;
  majReperesClient({ reperes: [], arnaques_membres: null }); R.total_inconnu = lire().total;
  majReperesClient({});                                       R.ancien_serveur = lire();
  // Rien du tout : pas de carte vide.
  neuf(); ALERTES = []; REPERE = { veille: null, perso: null, total: null };
  majAlerteNationale();
  return drainer(function () {
    majReperesClient({ reperes: [], arnaques_membres: 3 });
    R.rien = lire();
    // Un total sans aucune ligne : la carte dit le total, sans « Tout voir ».
    majReperesClient({ reperes: [], arnaques_membres: 50 });
    R.total_seul = lire();
    print(JSON.stringify(R));
  });
});
"""

# ── Le serveur, sur une fausse base ──────────────────────────────────
SERVEUR = r"""
var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: { ADMIN_EMAIL: 'yacine@despy.fr, test@despy.fr' } };
var PANNE = false;
function jours(n) { return new Date(Date.now() - n * 864e5).toISOString(); }
var LIGNES = [
  { email: 'marie@x.fr', verdict: 'scam', content: 'Votre colis   est\nen attente', created_at: jours(1) },
  { email: 'marie@x.fr', verdict: 'scam', content: 'Ameli : remboursement en attente', created_at: jours(10) },
  { email: 'marie@x.fr', verdict: 'scam', content: 'Faux conseiller bancaire', created_at: jours(30) },
  { email: 'marie@x.fr', verdict: 'scam', content: 'Quatrième, la plus vieille dans les 90 jours', created_at: jours(60) },
  { email: 'marie@x.fr', verdict: 'scam', content: 'Trop vieille', created_at: jours(120) },
  { email: 'marie@x.fr', verdict: 'safe', content: 'Message sain', created_at: jours(0.5) },
  { email: 'autre@x.fr', verdict: 'scam', content: 'Celui d’un autre membre', created_at: jours(0.2) },
  { email: null, verdict: 'scam', content: 'Visiteur anonyme', created_at: jours(2) },
  { email: 'yacine@despy.fr', verdict: 'scam', content: 'Essai', created_at: jours(3) },
  { email: 'test@despy.fr', verdict: 'scam', content: 'Essai', created_at: jours(3) }
];
function Q() {
  var f = [], tri = null, max = null, compte = false, q = {};
  q.select = function (c, o) { if (o && o.head) compte = true; return q; };
  q.eq = function (c, v) { f.push(function (r) { return r[c] === v; }); return q; };
  q.gte = function (c, v) { f.push(function (r) { return r[c] >= v; }); return q; };
  q.not = function (c, op, v) {
    if (op === 'is' && v === null) f.push(function (r) { return r[c] !== null; });
    else if (op === 'in') { var l = String(v).replace(/^\(|\)$/g, '').split(',').map(function (x) { return x.replace(/"/g, ''); });
                            f.push(function (r) { return l.indexOf(r[c]) === -1; }); }
    else throw new Error('not() inattendu : ' + op);
    return q;
  };
  q.order = function (c, o) { tri = { c: c, asc: !(o && o.ascending === false) }; return q; };
  q.limit = function (n) { max = n; return q; };
  q.then = function (ok, ko) {
    if (PANNE) return Promise.resolve({ data: null, count: null, error: { message: 'panne' } }).then(ok, ko);
    var l = LIGNES.filter(function (r) { return f.every(function (g) { return g(r); }); });
    if (tri) l.sort(function (a, b) { return (a[tri.c] < b[tri.c] ? -1 : 1) * (tri.asc ? 1 : -1); });
    if (max !== null) l = l.slice(0, max);
    return Promise.resolve(compte ? { count: l.length, data: null, error: null } : { data: l, error: null }).then(ok, ko);
  };
  return q;
}
var BASE = { from: function () { return Q(); } };
var module = { exports: {} }, exports = module.exports;
"""

SCENARIO_SERVEUR = r"""
var M = module.exports, R = {};
M.reperesDuClient(BASE, 'marie@x.fr').then(function (p) { R.perso = p;
  return M.arnaquesChezLesMembres(BASE); }).then(function (n) { R.total = n;
  PANNE = true; return M.reperesDuClient(BASE, 'marie@x.fr'); }).then(function (p) { R.perso_panne = p;
  return M.arnaquesChezLesMembres(BASE); }).then(function (n) { R.total_panne = n;
  R.long = M.extrait('Bonjour, votre colis numéro 4587 est bloqué au centre de tri. Pour le recevoir, réglez les frais de 1,99 € en cliquant sur le lien suivant avant ce soir minuit.');
  R.push = {
    veille: M.textePush({ title: 'Hameçonnage aux faux votes sur WhatsApp', source: 'Cybermalveillance.gouv.fr' }),
    presse: M.textePush({ title: 'Faux SMS Chronopost', source: 'Clubic · presse' }),
    vague:  M.textePush({ title: 'Vague d’arnaque détectée : le site colis-suivi.top', source: 'Despy · détecté chez nos utilisateurs' }),
    saison: M.textePush({ title: 'Black Friday : le pic annuel des faux SMS', source: 'Despy · Anticipation' })
  };
  print(JSON.stringify(R));
}).catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    src = open(APP, encoding='utf-8').read()
    ok = [True]

    def controle(nom, obtenu, attendu):
        bon = obtenu == attendu
        ok[0] = ok[0] and bon
        print('  %-5s %s' % ('OK' if bon else 'ÉCHEC', nom))
        if not bon:
            print('        attendu : %s' % json.dumps(attendu, ensure_ascii=False))
            print('        obtenu  : %s' % json.dumps(obtenu, ensure_ascii=False))

    try:
        bloc = src[src.index('var ALERTE_HOME_JOURS'):src.index('function loadAlertesFeed(')]
        code = APPLI + bloc + '\n'.join(extraire(src, n) for n in ('timeAgoFr', 'alerteCard', 'escapeHtmlA')) + SCENARIO_APPLI
        a = jsc(code)
        repere = open(os.path.join(FONCTIONS, '_repere.js'), encoding='utf-8').read()
        v = jsc(SERVEUR + repere + SCENARIO_SERVEUR)
    except Exception as e:
        print('ÉCHEC — le banc n\'a pas pu tourner : %s' % e)
        return 1
    if 'erreur' in v:
        print('ÉCHEC : ' + v['erreur'])
        return 1

    print('═' * 74)
    print("LE FIL DE L'ACCUEIL")
    print('═' * 74)
    L = a['complet']['lignes']
    controle('trois lignes au plus, la plus récente d\'abord',
             [x['nature'] for x in L], ['perso', 'saison', 'vague'])
    controle('la fiche « Tout voir » a tout le reste (sauf ce qui a plus de trois semaines)', a['tout_dans_la_fiche'], 4)
    controle('chaque ligne dit ce qu\'elle est vraiment', [x['sous'].rsplit(' · ', 1)[0] for x in L],
             ['Arnaque repérée pour vous', 'Anticipée par Despy', 'Détectée chez les membres Despy'])
    controle('l\'ancienneté ne se coupe pas en fin de ligne', all(' ' not in x['sous'].rsplit(' · ', 1)[1] for x in L), True)
    seule = a['veille_seule']['lignes']
    controle('une alerte officielle : « Veille Despy » et sa source', seule[2]['sous'].rsplit(' · ', 1)[0],
             'Veille Despy · Cybermalveillance.gouv.fr')
    controle('plus de trois semaines : hors du fil', 'vieille alerte' in json.dumps(a, ensure_ascii=False), False)
    controle('son message entre guillemets, coupé au mot entier', L[0]['titre'], '« Votre colis est en attente, réglez 1,99 € ici… »')
    controle('le message du client est échappé, à l\'accueil comme dans la fiche',
             ('<script>' in a['complet']['brut'] + a['fiche']['html'], '&lt;script&gt;' in a['fiche']['html']), (False, True))
    controle('ni « bloquée » ni « interceptée », nulle part',
             bool(re.search(r'bloqu|intercept', a['complet']['brut'] + a['fiche']['html'], re.I)), False)

    print()
    print('═' * 74)
    print('LE TOTAL CHEZ LES MEMBRES')
    print('═' * 74)
    t = a['complet']['total']
    controle('affiché quand il est réel et parlant',
             (re.sub(r'\D', '', t.split('</b>')[0]), t.split('</b>')[-1]),
             ('1234', ' arnaques repérées chez les membres de Despy, au total'))
    controle('sous 10, on se tait', a['total_petit'], '')
    controle('inconnu, on se tait', a['total_inconnu'], '')
    controle('serveur pas encore à jour : le fil reste, sans total', [a['ancien_serveur']['total'], len(a['ancien_serveur']['lignes'])], ['', 3])
    controle('rien à montrer : pas de carte vide', a['rien']['carte'], 'none')
    controle('un total seul : la carte, sans « Tout voir »', [a['total_seul']['carte'], a['total_seul']['tout']], ['block', 'none'])

    print()
    print('═' * 74)
    print('« NOUVEAU »')
    print('═' * 74)
    controle('jamais vu, de moins d\'une semaine : « Nouveau », sur la plus récente seulement', [x['nouveau'] for x in L], [True, False, False])
    controle('plus d\'une semaine : pas « Nouveau »', seule[2]['nouveau'], False)
    controle('la fiche ouverte, les pastilles disparaissent', [x['nouveau'] for x in a['apres_fiche']['lignes']], [False, False, False])
    controle('la fiche explique d\'où vient chaque ligne', 'Vous nous avez montré ce message' in a['fiche']['html'] and 'Vague détectée' in a['fiche']['html'], True)

    print()
    print('═' * 74)
    print('CE QUE LE SERVEUR RENVOIE')
    print('═' * 74)
    controle('les arnaques de CE client, 90 jours, 3 au plus, la plus récente d\'abord',
             [x['extrait'] for x in v['perso']], ['Votre colis est en attente', 'Ameli : remboursement en attente', 'Faux conseiller bancaire'])
    controle('total : les membres seulement, sans visiteurs anonymes ni essais de l\'équipe', v['total'], 6)
    controle('base en panne : null, pas un fil vide ni un zéro', [v['perso_panne'], v['total_panne']], [None, None])
    controle('un long message : une ligne, coupée au mot', (len(v['long']) <= 120, v['long'].endswith('…'), v['long'][-2] != ' '), (True, True, True))

    print()
    print('═' * 74)
    print('LES NOTIFICATIONS')
    print('═' * 74)
    P = v['push']
    controle('officielle : « Repéré par Despy », la source entre parenthèses', P['veille'],
             {'title': '🛡️ Repéré par Despy', 'body': 'Hameçonnage aux faux votes sur WhatsApp (Cybermalveillance.gouv.fr)'})
    controle('presse : le nom du média seul', P['presse']['body'], 'Faux SMS Chronopost (Clubic)')
    controle('vague : « Détecté chez les membres Despy »', P['vague']['title'], '🛡️ Détecté chez les membres Despy')
    controle('saison : « anticipée », pas « repérée »', P['saison']['title'], '🛡️ Arnaque de saison, anticipée par Despy')
    controle('ni « bloquée » ni « interceptée »', bool(re.search(r'bloqu|intercept', json.dumps(P, ensure_ascii=False), re.I)), False)
    na = open(os.path.join(FONCTIONS, 'national-alerts.js'), encoding='utf-8').read()
    controle('national-alerts s\'en sert', 'const t = textePush(alert);' in extraire(na, 'sendPushToAll'), True)

    print()
    print('═' * 74)
    print('BRANCHEMENTS')
    print('═' * 74)
    rhs = extraire(src, 'refreshHomeScore')
    controle('changer de compte efface ce que l\'autre avait repéré',
             -1 < rhs.find('REPERE.perso = null') < rhs.find('majAlerteNationale()') < rhs.find('majReperesClient(d.stats)'), True)
    ss = open(os.path.join(FONCTIONS, 'security-score.js'), encoding='utf-8').read()
    controle('security-score renvoie les deux', ('reperes:           reperes,' in ss, 'arnaques_membres:  arnaquesMembres,' in ss), (True, True))

    print()
    print('TOUT EST BON' if ok[0] else 'IL Y A DES ÉCHECS')
    return 0 if ok[0] else 1


if __name__ == '__main__':
    sys.exit(main())
