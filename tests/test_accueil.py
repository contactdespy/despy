#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai de l'accueil de l'appli
#
# La veille était éclatée en trois blocs, à trois hauteurs, dans trois styles :
# l'alerte en orange tout en haut, chevauchée de 4 px par la carte de score, les
# fuites en vert 500 px plus bas, l'activation des alertes en gris. Le bas de
# page disait une seconde fois « 0 fuite », et « 30+ sites surveillés », un
# chiffre écrit en dur que rien ne mesurait.
#
# Ce banc ne juge pas l'apparence. Il garde ce qui se vérifie : l'ordre des
# blocs, ce que le panneau dit selon la situation, et que les chiffres affichés
# viennent bien de la base — « — » si elle ne répond pas, jamais un zéro inventé.
#
# Usage : python3 tests/test_accueil.py
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
        return subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)


FAUX_DOM = r"""
function El(id, affiche) {
  var e = { id: id, style: { display: affiche ? 'flex' : 'none' }, textContent: '', parentNode: null, nextElementSibling: null, _cl: {} };
  e.classList = { contains: function (c) { return !!e._cl[c]; },
                  toggle: function (c, v) { e._cl[c] = !!v; }, };
  return e;
}
var ORDRE, ELS;
function poser(veille, fuite, alerte, push) {
  ELS = {};
  ['home-vp', 'home-veille', 'home-alerte-nat', 'home-push', 'vp-titre', 'vp-etat', 'vp-dot', 'home-aide-sec', 'home-fam']
    .forEach(function (i) { ELS[i] = El(i, false); });
  ELS['home-vp'].style.display = 'none';
  ELS['vp-dot'].style.display = '';
  ELS['home-veille'].style.display = veille ? 'flex' : 'none';
  ELS['home-veille']._cl['veille-fuite'] = !!fuite;
  ELS['home-alerte-nat'].style.display = alerte ? 'flex' : 'none';
  ELS['home-push'].style.display = push ? 'flex' : 'none';
  // L'accueil, réduit aux trois repères : aide, panneau, bande famille.
  ORDRE = ['home-aide-sec', 'home-vp', 'home-fam'];
  var parent = { insertBefore: function (p, ancre) {
    ORDRE = ORDRE.filter(function (x) { return x !== p.id; });
    ORDRE.splice(ORDRE.indexOf(ancre.id), 0, p.id);
    lier();
  } };
  function lier() { ORDRE.forEach(function (x, i) { ELS[x].parentNode = parent; ELS[x].nextElementSibling = ELS[ORDRE[i + 1]] || null; }); }
  lier();
}
var document = { getElementById: function (i) { return (ELS && ELS[i]) || null; } };
function etat() {
  return { panneau: ELS['home-vp'].style.display, titre: ELS['vp-titre'].textContent, etat: ELS['vp-etat'].textContent,
           point: ELS['vp-dot'].style.display, rouge: ELS['vp-etat'].classList.contains('a-faire'), ordre: ORDRE.join(' > ') };
}
"""

SCENARIO_PANNEAU = r"""
var R = {};
poser(true, false, true, true);  suivrePanneauVeille(); R.abonne = etat();
poser(true, true, true, false);  suivrePanneauVeille(); R.fuite = etat();
poser(true, true, true, false);  suivrePanneauVeille(); ELS['home-veille']._cl['veille-fuite'] = false; suivrePanneauVeille(); R.fuite_reglee = etat();
poser(false, false, true, true); suivrePanneauVeille(); R.gratuit = etat();
poser(false, false, false, false); ELS['home-vp'].style.display = 'block'; suivrePanneauVeille(); R.rien = etat();
print(JSON.stringify(R));
"""

SCENARIO_STATS = r"""
var IDS = {}, session = { get: function () { return { subscribed: true }; } };
function Case(id) { var lib = { textContent: '?' }; IDS[id] = { textContent: '?', nextElementSibling: lib, style: {} }; }
var document = { getElementById: function (i) { return IDS[i] || null; } };
['stat-verifies', 'stat-arnaques', 'stat-questions'].forEach(Case);
function lire() { return ['stat-verifies', 'stat-arnaques'].map(function (i) { return IDS[i].textContent + ' ' + IDS[i].nextElementSibling.textContent; }); }
var R = {};
renderHomeStats({ analyses_month: 4, arnaques_month: 1, questions_month: 2 }); R.chiffres = lire(); R.questions = IDS['stat-questions'].textContent;
renderHomeStats({ analyses_month: 0, arnaques_month: 0, questions_month: 0 }); R.zero = lire();
renderHomeStats({ analyses_month: null, arnaques_month: null, questions_month: 0 }); R.inconnu = lire();
renderHomeStats({ questions_month: 0 }); R.ancien_serveur = lire();
print(JSON.stringify(R));
"""

# Le vrai security-score, sur une fausse base.
SCENARIO_SERVEUR = r"""
var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'k' } };
var PANNE = false, MAINTENANT = new Date();
function ilYa(j) { return new Date(MAINTENANT.getTime() - j * 864e5).toISOString(); }
var debut = new Date(Date.UTC(MAINTENANT.getUTCFullYear(), MAINTENANT.getUTCMonth(), 1));
var CE_MOIS = new Date(debut.getTime() + 3600000).toISOString();
var AVANT = new Date(debut.getTime() - 86400000).toISOString();
var LIGNES = [
  { email: 'marie@x.fr', verdict: 'safe', created_at: CE_MOIS },
  { email: 'marie@x.fr', verdict: 'scam', created_at: CE_MOIS },
  { email: 'marie@x.fr', verdict: 'scam', created_at: AVANT },
  { email: 'autre@x.fr', verdict: 'scam', created_at: CE_MOIS }
];
var CLIENT = { email: 'marie@x.fr', subscribed: true, plan: 'monthly', created_at: AVANT, questions_used: 0, breach_count: 0 };
function Q(table) {
  var f = [], seul = false, compte = false, q = {};
  q.select = function (c, o) { if (o && o.head) compte = true; return q; };
  q.eq = function (c, v) { f.push(function (r) { return r[c] === v; }); return q; };
  q.gte = function (c, v) { f.push(function (r) { return r[c] >= v; }); return q; };
  q.in = q.order = q.limit = q.not = q.is = function () { return q; };
  q.update = function () { return q; };
  q.maybeSingle = q.single = function () { seul = true; return q; };
  q.then = function (ok, ko) {
    var rep;
    if (table === 'clients') rep = { data: seul ? CLIENT : [CLIENT], error: null };
    else if (table === 'analyses_history') {
      if (PANNE) rep = { count: null, data: null, error: { message: 'panne' } };
      else { var l = LIGNES.filter(function (r) { return f.every(function (g) { return g(r); }); }); rep = { count: l.length, data: l, error: null }; }
    } else rep = { count: 0, data: seul ? null : [], error: null };
    return Promise.resolve(rep).then(ok, ko);
  };
  return q;
}
var C = {};
function require(n) {
  if (n === '@supabase/supabase-js') return { createClient: function () { return { from: Q }; } };
  if (n === './_auth') return { requireAuth: function () { return { ok: true }; } };
  if (n === './_famille') return { estCouvert: function () { return Promise.resolve(true); } };
  throw new Error('module inattendu : ' + n);
}
var module = { exports: {} }, exports = module.exports;
"""

SCENARIO_SERVEUR_FIN = r"""
function appel() {
  return module.exports.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ email: 'marie@x.fr' }), queryStringParameters: {} })
    .then(function (r) { return JSON.parse(r.body).stats || { erreur: r.body }; });
}
var R = {};
appel().then(function (s) { R.normal = [s.analyses_month, s.arnaques_month];
  PANNE = true; return appel(); }).then(function (s) { R.panne = [s.analyses_month, s.arnaques_month]; print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
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

    print('═' * 74)
    print("L'ORDRE DES BLOCS")
    print('═' * 74)
    d = src.index('<div id="tab-home"')
    f = src.index('<div id="tab-protection"')
    acc = src[d:f]
    pos = lambda m: acc.find(m)
    controle('le score vient en premier, contre l\'en-tête',
             pos('hero-card') < pos('home-aide-sec') and acc.find('<button', acc.index('</header>')) == pos('<button class="card hero-card"'), True)
    controle('rien entre l\'en-tête et le score (il mord sur l\'en-tête)',
             re.sub(r'\s+', '', acc[acc.index('</header>') + 9:pos('<button class="card hero-card"')]), '<divclass="pbody">')
    controle('le panneau vient après l\'aide', pos('home-aide-sec') < pos('id="home-vp"'), True)
    panneau = acc[pos('id="home-vp"'):acc.index('</section>', pos('id="home-vp"'))]
    controle('les trois lignes sont dans le panneau',
             [('id="%s"' % i) in panneau for i in ('home-veille', 'home-alerte-nat', 'home-push')], [True, True, True])
    controle('et ne sont nulle part ailleurs',
             [acc.count('id="%s"' % i) for i in ('home-veille', 'home-alerte-nat', 'home-push')], [1, 1, 1])

    print()
    print('═' * 74)
    print('CE QUE DIT LE PANNEAU, SELON LA SITUATION')
    print('═' * 74)
    r = jsc(FAUX_DOM + extraire(src, 'suivrePanneauVeille') + SCENARIO_PANNEAU)
    if r.returncode != 0 or not r.stdout.strip():
        print('ÉCHEC : ' + (r.stderr or r.stdout)[:1500])
        return 1
    p = json.loads(r.stdout.strip().splitlines()[-1])
    SOUS = 'home-aide-sec > home-vp > home-fam'
    DESSUS = 'home-vp > home-aide-sec > home-fam'
    controle('abonné : « Votre veille », active, sous l\'aide',
             [p['abonne'][k] for k in ('panneau', 'titre', 'etat', 'point', 'ordre')],
             ['block', 'Votre veille', 'Active', '', SOUS])
    controle('une fuite : « À traiter » en rouge, au-dessus de l\'aide',
             [p['fuite'][k] for k in ('etat', 'rouge', 'point', 'ordre')], ['À traiter', True, 'none', DESSUS])
    controle('fuite réglée : le panneau redescend',
             [p['fuite_reglee'][k] for k in ('etat', 'rouge', 'ordre')], ['Active', False, SOUS])
    controle('compte gratuit : ne prétend pas surveiller',
             [p['gratuit'][k] for k in ('panneau', 'titre', 'etat', 'point')], ['block', 'En ce moment', '', 'none'])
    controle('rien à montrer : pas de panneau vide', p['rien']['panneau'], 'none')

    print()
    print('═' * 74)
    print('LES CHIFFRES DU BAS DE PAGE')
    print('═' * 74)
    r = jsc(extraire(src, 'renderHomeStats') + SCENARIO_STATS)
    if r.returncode != 0 or not r.stdout.strip():
        print('ÉCHEC : ' + (r.stderr or r.stdout)[:1500])
        return 1
    s = json.loads(r.stdout.strip().splitlines()[-1])
    controle('les chiffres reçus, bien accordés', s['chiffres'], ['4 messages vérifiés', '1 arnaque repérée'])
    controle('zéro mesuré : zéro affiché', s['zero'], ['0 message vérifié', '0 arnaque repérée'])
    controle('pas su compter : « — », pas un zéro', s['inconnu'], ['— message vérifié', '— arnaque repérée'])
    controle('serveur pas encore à jour : « — » aussi', s['ancien_serveur'], ['— message vérifié', '— arnaque repérée'])
    controle('plus aucun « 30+ » écrit en dur', '30+' in src.replace('« 30+ sites surveillés »', ''), False)
    controle('plus de « 24 h/24 » ni de « surveillance en continu » sur l\'accueil',
             bool(re.search(r'24 h/24|[Ss]urveillance en continu', acc)), False)

    print()
    print('═' * 74)
    print('CE QUE LE SERVEUR COMPTE')
    print('═' * 74)
    code = open(os.path.join(FONCTIONS, 'security-score.js'), encoding='utf-8').read()
    r = jsc(SCENARIO_SERVEUR + code + SCENARIO_SERVEUR_FIN)
    if r.returncode != 0 or not r.stdout.strip():
        print('ÉCHEC : ' + (r.stderr or r.stdout)[:1500])
        return 1
    v = json.loads(r.stdout.strip().splitlines()[-1])
    if 'erreur' in v:
        print('ÉCHEC : ' + v['erreur'])
        return 1
    controle('ce mois-ci, ce client seulement', v['normal'], [2, 1])
    controle('base en panne : null, pas zéro', v['panne'], [None, None])

    print()
    print('TOUT EST BON' if ok[0] else 'IL Y A DES ÉCHECS')
    return 0 if ok[0] else 1


if __name__ == '__main__':
    sys.exit(main())
