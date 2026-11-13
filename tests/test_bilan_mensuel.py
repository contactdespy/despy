#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du bilan mensuel (écran de l'appli + email du 1er)
#
# Le bilan avait l'air périmé, et il l'était :
#   - l'écran affichait, sous « Ce mois-ci », des cumuls depuis l'inscription
#     (23 questions là où l'accueil en comptait 2), et « Surveillance dark web :
#     Active » écrit en dur, même pour un compte gratuit ;
#   - l'email du 1er portait le nom du mois qui COMMENCE pour les chiffres du
#     mois écoulé, disait « ce mois-ci », comptait des arnaques « bloquées »,
#     et citait la même « arnaque du mois » écrite en dur depuis le début.
#
# Ce banc fait tourner le VRAI code : bilanHtml() de l'appli, security-score,
# monthly-report et le gabarit de send-email.
#
# Usage : python3 tests/test_bilan_mensuel.py
# ════════════════════════════════════════════

import json, os, re, subprocess, sys, tempfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(RACINE, 'despy_app_v23.html')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')


def lire(nom):
    return open(os.path.join(FONCTIONS, nom), encoding='utf-8').read()


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


def module(nom_var, source):
    return ('var %s = (function () { var module = { exports: {} }, exports = module.exports;\n%s\n'
            'return module.exports; })();\n' % (nom_var, source))


# ── 1. L'écran ────────────────────────────────────────────────────────
ECRAN = r"""
var STOCK = { despy_module_1: '1', despy_module_2: '1', despy_module_3: '1' };
var localStorage = { getItem: function (k) { return k in STOCK ? STOCK[k] : null; } };
function heroScoreRing(s) { return '[anneau ' + s + ']'; }
var NB_REPERES = 3;
function elementsReperes() { return new Array(NB_REPERES); }
function jours(n) { return new Date(Date.now() - n * 864e5).toISOString(); }
function texte(h) { return h.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' | ').replace(/&amp;/g, '&').replace(/(\s*\|\s*)+/g, ' | ').trim(); }
"""

SCENARIO_ECRAN = r"""
var NOV13 = new Date(2026, 10, 13, 10, 0, 0), DEC1 = new Date(2026, 11, 1, 10, 0, 0), JAN5 = new Date(2027, 0, 5, 10, 0, 0);
function base(plus) {
  var st = { questions_used: 23, questions_month: 2, analyses_month: 4, arnaques_month: 1, breach_count: 0,
             last_hibp_check: jours(4), member_since: '2026-05-10T10:00:00Z', plan: 'monthly',
             mois_precedent: { analyses: 6, arnaques: 2 } };
  for (var k in (plus || {})) st[k] = plus[k];
  return { score: 72, color: '#16a34a', label: 'Bien <protégée>', emoji: '',
           checklist: { darkweb: true, trusted: true, conseiller: true, formation: true }, stats: st };
}
var R = {};
R.abonne = texte(bilanHtml(base(), { subscribed: true }, NOV13));
R.abonne_brut = bilanHtml(base(), { subscribed: true }, NOV13);
R.un = texte(bilanHtml(base({ analyses_month: 1, arnaques_month: 0, questions_month: 1 }), { subscribed: true }, NOV13));
R.inconnu = texte(bilanHtml(base({ analyses_month: null, arnaques_month: undefined, mois_precedent: undefined }), { subscribed: true }, NOV13));
R.premier = texte(bilanHtml(base({ analyses_month: 0, arnaques_month: 0, questions_month: 0, mois_precedent: { analyses: 9, arnaques: 3 } }), { subscribed: true }, DEC1));
R.janvier = texte(bilanHtml(base(), { subscribed: true }, JAN5));
R.fuite = texte(bilanHtml(base({ breach_count: 2 }), { subscribed: true }, NOV13));
R.gratuit_jamais = texte(bilanHtml(base({ plan: 'free', last_hibp_check: null }), { subscribed: false }, NOV13));
R.gratuit_verifie = texte(bilanHtml(base({ plan: 'free' }), { subscribed: false }, NOV13));
R.famille = texte(bilanHtml(base({ plan: 'family_member' }), { subscribed: false }, NOV13));
R.ancien_serveur = texte(bilanHtml(base({ plan: undefined }), { subscribed: true }, NOV13));
for (var i = 4; i <= 10; i++) STOCK['despy_module_' + i] = '1';
var tout = base(); tout.checklist.privacy = true; tout.checklist.training = true;
R.tout_fait = texte(bilanHtml(tout, { subscribed: true }, NOV13));
tout.stats.plan = 'free';
R.tout_fait_gratuit = texte(bilanHtml(tout, { subscribed: false }, NOV13));
NB_REPERES = 0;
R.rien_repere = texte(bilanHtml(base(), { subscribed: true }, NOV13));
// L'accueil et le bilan disent la même chose de la veille.
R.veille_accueil = texteVeille(base().stats, true);
print(JSON.stringify(R));
"""

# ── 2. Le serveur ─────────────────────────────────────────────────────
SERVEUR = r"""
var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'k' } };
var PANNE = false, M = new Date();
var debut = new Date(Date.UTC(M.getUTCFullYear(), M.getUTCMonth(), 1));
var debutPrec = new Date(Date.UTC(M.getUTCFullYear(), M.getUTCMonth() - 1, 1));
function iso(t) { return new Date(t).toISOString(); }
var LIGNES = [
  { email: 'marie@x.fr', verdict: 'safe', created_at: iso(debut.getTime() + 3600e3) },
  { email: 'marie@x.fr', verdict: 'scam', created_at: iso(debut.getTime() - 86400e3) },
  { email: 'marie@x.fr', verdict: 'safe', created_at: iso(debut.getTime() - 2 * 86400e3) },
  { email: 'marie@x.fr', verdict: 'safe', created_at: iso(debutPrec.getTime() + 3600e3) },
  { email: 'marie@x.fr', verdict: 'scam', created_at: iso(debutPrec.getTime() - 86400e3) },
  { email: 'autre@x.fr', verdict: 'scam', created_at: iso(debut.getTime() - 86400e3) }
];
var CLIENT = { email: 'marie@x.fr', subscribed: true, plan: 'monthly', created_at: iso(debutPrec.getTime()), questions_used: 0, breach_count: 0 };
function Q(table) {
  var f = [], seul = false, q = {};
  q.select = function () { return q; };
  q.eq = function (c, v) { f.push(function (r) { return r[c] === v; }); return q; };
  q.gte = function (c, v) { f.push(function (r) { return r[c] >= v; }); return q; };
  q.lt = function (c, v) { f.push(function (r) { return r[c] < v; }); return q; };
  q.in = q.order = q.limit = q.not = q.is = q.update = function () { return q; };
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
function require(n) {
  if (n === '@supabase/supabase-js') return { createClient: function () { return { from: Q }; } };
  if (n === './_auth') return { requireAuth: function () { return { ok: true }; } };
  if (n === './_famille') return { estCouvert: function () { return Promise.resolve(true); } };
  if (n === './_repere') return __REPERE__;
  throw new Error('module inattendu : ' + n);
}
"""

SCENARIO_SERVEUR = r"""
function appel(bilan) {
  return __SCORE__.handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {},
                             body: JSON.stringify(bilan ? { email: 'marie@x.fr', bilan: true } : { email: 'marie@x.fr' }) })
    .then(function (r) { return JSON.parse(r.body).stats || { erreur: r.body }; });
}
var R = {};
appel(true).then(function (s) { R.bilan = s.mois_precedent; R.mois = [s.analyses_month, s.arnaques_month];
  return appel(false); }).then(function (s) { R.accueil = 'mois_precedent' in s;
  PANNE = true; return appel(true); }).then(function (s) { R.panne = s.mois_precedent; print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

# ── 3. L'email du 1er ─────────────────────────────────────────────────
EMAIL = r"""
var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: { URL: 'https://despy.fr', INTERNAL_SECRET: 's', RESEND_API_KEY: 'r', SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'k' } };
var AbortSignal = { timeout: function () { return null; } };
var setTimeout = function (f) { f(); };
// Le 1er novembre 2026, 9 h UTC : l'heure du cron.
var VraiDate = Date, MAINT = '2026-11-01T09:00:00Z';
Date = function (a, b, c, d, e, f, g) {
  var n = arguments.length;
  return n === 0 ? new VraiDate(MAINT) : n === 1 ? new VraiDate(a) : new VraiDate(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
};
Date.now = function () { return new VraiDate(MAINT).getTime(); };
Date.UTC = VraiDate.UTC; Date.prototype = VraiDate.prototype;

var ANALYSES = [
  { email: 'marie@x.fr', verdict: 'scam', created_at: '2026-10-10T10:00:00Z' },
  { email: 'marie@x.fr', verdict: 'scam', created_at: '2026-10-20T10:00:00Z' },
  { email: 'marie@x.fr', verdict: 'safe', created_at: '2026-10-21T10:00:00Z' },
  { email: 'marie@x.fr', verdict: 'scam', created_at: '2026-09-15T10:00:00Z' },   // septembre : hors bilan
  { email: 'marie@x.fr', verdict: 'scam', created_at: '2026-11-01T08:00:00Z' },   // novembre : hors bilan
  { email: 'calme@x.fr', verdict: 'safe', created_at: '2026-09-15T10:00:00Z' }
];
var ALERTES = [
  { title: 'Alerte de novembre, trop récente', source: 'Cybermalveillance.gouv.fr', body: '', created_at: '2026-11-01T07:00:00Z' },
  { title: 'Faux SMS <Ameli> : la vague d’octobre', source: 'Despy · détecté chez nos utilisateurs', body: 'Douze   membres ont reçu ce message.', created_at: '2026-10-28T10:00:00Z' },
  { title: 'Une alerte plus ancienne d’octobre', source: 'Clubic · presse', body: '', created_at: '2026-10-05T10:00:00Z' },
  { title: 'Alerte de septembre', source: 'CNIL · officiel', body: '', created_at: '2026-09-20T10:00:00Z' }
];
var CLIENTS = [ { email: 'marie@x.fr', prenom: 'Marie', subscribed: true, breach_count: 1 },
                { email: 'calme@x.fr', prenom: 'Paul', subscribed: true, breach_count: 0 } ];
function Q(table) {
  var f = [], q = {};
  q.select = function () { return q; };
  q.eq = function (c, v) { f.push(function (r) { return r[c] === v; }); return q; };
  q.gte = function (c, v) { f.push(function (r) { return r[c] >= v; }); return q; };
  q.lt = function (c, v) { f.push(function (r) { return r[c] < v; }); return q; };
  q.limit = q.maybeSingle = q.order = function () { return q; };
  q.then = function (ok, ko) {
    var src = table === 'clients' ? CLIENTS : table === 'analyses_history' ? ANALYSES : [];
    var l = src.filter(function (r) { return f.every(function (g) { return g(r); }); });
    return Promise.resolve({ data: l, count: l.length, error: null }).then(ok, ko);
  };
  return q;
}
var PAYLOADS = [], MAILS = [], SANS_ALERTE = false;
function fetch(url, opts) {
  var rep = { id: 'x' };
  if (/list-alerts$/.test(url)) rep = { alerts: SANS_ALERTE ? [] : ALERTES };
  else if (/send-email$/.test(url)) PAYLOADS.push(JSON.parse(opts.body));
  else if (url === 'https://api.resend.com/emails') { var c = JSON.parse(opts.body); MAILS.push({ sujet: c.subject, html: c.html }); }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(rep); } });
}
function require(n) {
  if (n === '@supabase/supabase-js') return { createClient: function () { return { from: Q }; } };
  if (n === './_famille') return { avecProches: function (s, payeurs) { return Promise.resolve(payeurs); } };
  if (n === './_is-scheduled') return __PLANIF__;
  if (n === './_repere') return __REPERE__;
  if (n === 'crypto') return { createHmac: function () { var o = { update: function () { return o; }, digest: function () { return 'abcdef0123456789abcdef0123456789ff'; } }; return o; } };
  throw new Error('module inattendu : ' + n);
}
"""

SCENARIO_EMAIL = r"""
function texte(h) { return h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
var R = {};
__RAPPORT__.handler({ body: JSON.stringify({ next_run: 'x' }) }).then(function () {
  R.envois = PAYLOADS.map(function (p) { return { type: p.type, a: p.data.email, mois: p.data.monthName, court: p.data.mois, stats: p.data.stats, alerte: p.data.alerte }; });
  var suite = Promise.resolve();
  PAYLOADS.forEach(function (p) { suite = suite.then(function () {
    return __MAIL__.handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 's' }, body: JSON.stringify(p) }); }); });
  return suite;
}).then(function () {
  R.mails = MAILS.map(function (m) { return { sujet: m.sujet, texte: texte(m.html), brut_ameli: m.html.indexOf('<Ameli>') !== -1 }; });
  PAYLOADS = []; MAILS = []; SANS_ALERTE = true;
  return __RAPPORT__.handler({ body: JSON.stringify({ next_run: 'x' }) });
}).then(function () {
  R.sans_alerte = PAYLOADS[0].data.alerte;
  return __MAIL__.handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 's' }, body: JSON.stringify(PAYLOADS[0]) });
}).then(function () {
  R.mail_sans_alerte = texte(MAILS[0].html);
  PAYLOADS = [];
  return __RAPPORT__.handler({ body: '{}' });
}).then(function () {
  R.appel_par_url = PAYLOADS.length;
  print(JSON.stringify(R));
}).catch(function (e) { print(JSON.stringify({ erreur: String(e && e.stack || e) })); });
"""


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    src = open(APP, encoding='utf-8').read()
    ok = [True]

    def controle(nom, obtenu, attendu=True):
        bon = obtenu == attendu
        ok[0] = ok[0] and bon
        print('  %-5s %s' % ('OK' if bon else 'ÉCHEC', nom))
        if not bon:
            print('        attendu : %s' % json.dumps(attendu, ensure_ascii=False))
            print('        obtenu  : %s' % json.dumps(obtenu, ensure_ascii=False))

    try:
        bloc = src[src.index('var BILAN_ICONES'):src.index('function openBilan(')]
        e = jsc(ECRAN + bloc + '\n'.join(extraire(src, n) for n in
                ('texteVeille', 'timeAgoFr', 'prochainControleFr', 'escapeHtmlA')) + SCENARIO_ECRAN)
        repere = module('__REPERE__', lire('_repere.js'))
        s = jsc(SERVEUR + repere + module('__SCORE__', lire('security-score.js')) + SCENARIO_SERVEUR)
        m = jsc(EMAIL + repere + module('__PLANIF__', lire('_is-scheduled.js'))
                + module('__RAPPORT__', lire('monthly-report.js')) + module('__MAIL__', lire('send-email.js')) + SCENARIO_EMAIL)
    except Exception as ex:
        print('ÉCHEC — le banc n\'a pas pu tourner : %s' % ex)
        return 1
    for r in (s, m):
        if 'erreur' in r:
            print('ÉCHEC : ' + r['erreur'])
            return 1

    print('═' * 74)
    print("L'ÉCRAN : LES CHIFFRES DU MOIS, ET SEULEMENT EUX")
    print('═' * 74)
    A = e['abonne']
    controle('le titre dit jusqu\'où va le bilan', 'Du 1er au 13 novembre' in A)
    controle('les trois chiffres du mois, ceux de l\'accueil',
             '| 4 | messages vérifiés | 1 | arnaque repérée | 2 | questions posées |' in A)
    controle('le cumul depuis l\'inscription (23 questions) n\'y est plus', '23' in A, False)
    controle('accords au singulier', '| 1 | message vérifié | 0 | arnaque repérée | 1 | question posée |' in e['un'])
    controle('pas su compter : « — », pas un zéro', '| — | message vérifié | — | arnaque repérée |' in e['inconnu'])
    controle('le mois écoulé à côté', 'En octobre : | 6 | messages vérifiés, | 2 | arnaques repérées.' in A)
    controle('— absent si le serveur ne l\'a pas donné', 'En octobre' in e['inconnu'], False)
    controle('le 1er du mois : « Le 1er décembre », et novembre à côté',
             ['Le 1er décembre' in e['premier'], 'En novembre : | 9 | messages vérifiés, | 3 | arnaques repérées.' in e['premier']], [True, True])
    controle('en janvier, le mois écoulé est décembre', 'En décembre :' in e['janvier'])
    controle('plus d\'emojis en guise d\'icônes', bool(re.search('[🔎💬🎓📌]', e['abonne_brut'])), False)
    controle('le libellé du score est échappé', ('<protégée>' in e['abonne_brut'], '&lt;protégée&gt;' in e['abonne_brut']), (False, True))

    print()
    print('═' * 74)
    print("L'ÉCRAN : LA VEILLE, SELON LE COMPTE")
    print('═' * 74)
    va = e['veille_accueil']
    controle('abonné : « Active », et la même phrase que l\'accueil',
             ['| Votre veille | Active |' in A, va['titre'] in A, va['sous'] in A, 'prochain contrôle' in va['sous']], [True] * 4)
    controle('abonné : l\'email du 1er est annoncé, pour le mois écoulé',
             'Le 1er de chaque mois, vous recevez par email le bilan du mois écoulé.' in A)
    controle('une fuite : « À traiter », et c\'est la priorité',
             ['| Votre veille | À traiter | 2 fuites vous concernent' in e['fuite'], 'Changez les mots de passe concernés' in e['fuite']], [True, True])
    G = e['gratuit_jamais']
    controle('compte gratuit : ni « Active », ni email promis, ni contrôle à venir',
             ['Active' in G, 'par email' in G, 'prochain contrôle' in G], [False, False, False])
    controle('compte gratuit jamais vérifié : on le dit, et c\'est la priorité',
             ['Vos données n’ont jamais été vérifiées' in G, 'Faites vérifier vos données' in G, 'Débloquer' in G], [True] * 3)
    V = e['gratuit_verifie']
    controle('compte gratuit vérifié à la main : son résultat, sans contrôle hebdomadaire',
             ['Aucune fuite détectée | vérifié' in V, 'prochain contrôle' in V, 'Débloquer' in V], [True, False, True])
    controle('proche d\'une formule Famille : traité en abonné', '| Votre veille | Active |' in e['famille'])
    controle('serveur pas encore à jour : la session décide', '| Votre veille | Active |' in e['ancien_serveur'])
    controle('« Repéré par Despy » : le vrai nombre, ou rien de nouveau',
             ['Repéré par Despy | 3 à consulter' in A, 'Repéré par Despy | Rien de nouveau pour le moment' in e['rien_repere']], [True, True])
    controle('où il en est : gestes et formation, présentés comme un état',
             '| Où vous en êtes | Gestes de protection | 4 / 6 | Formation | 3 / 10 modules |' in A)
    controle('tout est fait : « Tout est en place », plus de « parfaitement protégé »',
             ['Tout est en place' in e['tout_fait'], 'parfaitement' in e['tout_fait'], 'Despy contrôle vos données chaque semaine' in e['tout_fait']], [True, False, True])
    controle('— et pas de contrôle hebdomadaire promis à un compte gratuit',
             'Despy contrôle vos données chaque semaine' in e['tout_fait_gratuit'], False)
    ob = extraire(src, 'openBilan')
    controle('l\'écran demande le mois écoulé au serveur', 'bilan: true' in ob)

    print()
    print('═' * 74)
    print('LE SERVEUR : LE MOIS ÉCOULÉ')
    print('═' * 74)
    controle('le mois écoulé de CE client, ni avant ni après', s['bilan'], {'analyses': 3, 'arnaques': 1})
    controle('le mois en cours n\'a pas bougé', s['mois'], [1, 0])
    controle('l\'accueil ne paie pas ces requêtes', s['accueil'], False)
    controle('base en panne : null, pas zéro', s['panne'], {'analyses': None, 'arnaques': None})

    print()
    print('═' * 74)
    print("L'EMAIL DU 1ER NOVEMBRE")
    print('═' * 74)
    marie = [x for x in m['envois'] if x['a'] == 'marie@x.fr'][0]
    controle('il porte le nom du mois écoulé', [marie['mois'], marie['court']], ['octobre 2026', 'octobre'])
    controle('les chiffres d\'octobre, ni septembre ni novembre',
             [marie['stats']['analyses'], marie['stats']['arnaques']], [3, 2])
    controle('l\'alerte : la plus récente d\'octobre, nommée pour ce qu\'elle est',
             [marie['alerte']['title'], marie['alerte']['etiquette'], marie['alerte']['body']],
             ['Faux SMS <Ameli> : la vague d’octobre', 'Détecté chez les membres Despy en octobre', 'Douze membres ont reçu ce message.'])
    mm = [x for x in m['mails'] if 'Marie' in x['texte']][0]
    controle('objet', mm['sujet'], 'Votre bilan Despy — octobre 2026')
    controle('« En octobre, Despy a repéré 2 arnaques dans les messages que vous lui avez montrés »',
             'En octobre, Despy a repéré 2 arnaques dans les messages que vous lui avez montrés' in mm['texte'])
    controle('plus de « ce mois-ci » ni d\'arnaque « bloquée »',
             [bool(re.search(r'ce mois-ci', mm['texte'], re.I)), bool(re.search(r'bloqu|avant qu.elles? ne vous touche', mm['texte'], re.I))], [False, False])
    controle('les tuiles : arnaques repérées, messages vérifiés',
             ['2 arnaques repérées' in mm['texte'], '3 messages vérifiés' in mm['texte']], [True, True])
    controle('plus de phrase écrite en dur sur La Poste et Ameli', 'Les SMS imitant La Poste' in mm['texte'], False)
    controle('le titre de l\'alerte est échappé', mm['brut_ameli'], False)
    paul = [x for x in m['mails'] if 'Paul' in x['texte']][0]
    controle('un mois sans rien : « Octobre a été calme »', 'Octobre a été calme : vous n\'avez fait vérifier aucun message' in paul['texte'])
    controle('aucune alerte publiée ce mois-là : pas d\'encadré, pas de remplissage',
             [m['sans_alerte'], 'Repéré par Despy' in m['mail_sans_alerte'], 'Détecté chez' in m['mail_sans_alerte']], [None, False, False])
    controle('appelé par URL : rien ne part', m['appel_par_url'], 0)

    print()
    print('TOUT EST BON' if ok[0] else 'IL Y A DES ÉCHECS')
    return 0 if ok[0] else 1


if __name__ == '__main__':
    sys.exit(main())
