#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du désabonnement
#
# Chaque email porte un bouton « se désinscrire », et le clic est bien
# enregistré dans `email_optouts`. Mais jusqu'ici `send-email` ne relisait
# jamais cette table : la relance J+3, la séquence d'accueil et les bilans
# continuaient d'écrire à des gens qui avaient dit non. Interdit en
# prospection — et Gmail range en spam l'expéditeur qui ignore ce bouton,
# alertes de sécurité comprises.
#
# Ce banc fait tourner le vrai `send-email.js`, sans réseau ni base, et
# vérifie les deux moitiés du contrat :
#   A. ce qui est de la prospection ou un bilan ne part plus à qui a dit non ;
#   B. ce qui est du service — mot de passe, alerte de fuite, guide qu'on
#      vient de demander — part TOUJOURS, désinscrit ou pas.
#
# Le B compte autant que le A : couper l'alerte « vos données ont fuité » à un
# abonné payant parce qu'il ne voulait plus de conseils, ce serait pire que
# le défaut corrigé.
#
# Usage : python3 tests/test_desinscription.py
# ════════════════════════════════════════════

import json, os, re, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
CIBLE = os.path.join(FONCTIONS, 'send-email.js')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

HARNAIS = r"""
// ── Le monde extérieur, en toc ──────────────────────────────────────────────
var ETAT_BASE = 'normale';            // 'normale' | 'absente' | 'panne'
var DESINSCRITS = ['parti@example.fr'];
var ENVOIS = [];                      // ce qui est réellement parti chez Resend

var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: {
  URL: 'https://despy.fr', INTERNAL_SECRET: 's', RESEND_API_KEY: 'r',
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k'
} };
var AbortSignal = { timeout: function(){ return null; } };

function chaine() {
  var cherche = null;
  var c = {};
  c.select = function () { return c; };
  c.eq = function (col, val) { cherche = val; return c; };
  c.limit = function () { return c; };
  c.maybeSingle = function () { return c; };
  c.then = function (resoudre) {
    if (ETAT_BASE === 'absente') return resoudre({ data: null, error: {
      code: 'PGRST205', message: "Could not find the table 'public.email_optouts'" } });
    if (ETAT_BASE === 'panne') return resoudre({ data: null, error: {
      code: '08006', message: 'connexion refusée' } });
    return resoudre({ data: DESINSCRITS.indexOf(cherche) >= 0 ? [{ email: cherche }] : [],
                      error: null });
  };
  return c;
}

function fetch(url, opts) {
  if (url === 'https://api.resend.com/emails') {
    var corps = JSON.parse(opts.body);
    ENVOIS.push({ to: corps.to[0], lien: /Se désinscrire/.test(corps.html) });
  }
  return Promise.resolve({ ok: true, status: 200,
    json: function(){ return Promise.resolve({ id: 'x' }); } });
}

function require(nom) {
  if (nom === 'crypto') return { createHmac: function () {
    var o = { update: function () { return o; }, digest: function () { return 'abcdef0123456789abcdef0123456789ff'; } };
    return o;
  } };
  if (nom === '@supabase/supabase-js') return {
    createClient: function () { return { from: function () { return chaine(); } }; }
  };
  throw new Error('module inattendu : ' + nom);
}

var exports = {}, module = { exports: exports };
"""

VERIF = r"""
var handler = module.exports.handler || exports.handler;
var res = [];

function cas(nom, base, type, donnees) {
  ETAT_BASE = base; ENVOIS = [];
  return handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 's' },
                   body: JSON.stringify({ type: type, data: donnees }) })
    .then(function (r) {
      res.push({ nom: nom, statut: r.statusCode, envois: ENVOIS.slice() });
    })
    .catch(function (e) {
      res.push({ nom: nom, statut: 'EXCEPTION', erreur: String(e && e.message || e), envois: [] });
    });
}

var P = 'parti@example.fr', R = 'reste@example.fr';
var BILAN = { prenom: 'Marie', monthName: 'septembre',
              stats: { analyses: 3, fuites: 0, quizzes: 1, questions: 2 } };

Promise.resolve()
  // A. prospection et bilans : retenus pour qui a dit non
  .then(function () { return cas('relance J+3 — désinscrit',          'normale', 'relance_lead', { email: P, prenom: 'Marie' }); })
  .then(function () { return cas('relance J+3 — inscrit',             'normale', 'relance_lead', { email: R, prenom: 'Marie' }); })
  .then(function () { return cas('accueil (custom marqué) — désinscrit','normale', 'custom', { email: P, marketing: true, subject: 'x', html: '<p>x</p>' }); })
  .then(function () { return cas('accueil (custom marqué) — inscrit',  'normale', 'custom', { email: R, marketing: true, subject: 'x', html: '<p>x</p>' }); })
  .then(function () { return cas('bilan mensuel — désinscrit',        'normale', 'monthly_report', Object.assign({ email: P }, BILAN)); })
  .then(function () { return cas('teaser alerte gratuit — désinscrit', 'normale', 'cyber_alert_free', { email: P, prenom: 'Marie', alertTitle: 't', alertSource: 's' }); })
  .then(function () { return cas('adresse en majuscules — désinscrit', 'normale', 'relance_lead', { email: 'Parti@Example.fr', prenom: 'Marie' }); })
  // B. service : part toujours
  .then(function () { return cas('mot de passe (custom) — désinscrit', 'normale', 'custom', { email: P, subject: 'x', html: '<p>x</p>' }); })
  .then(function () { return cas('alerte payante — désinscrit',       'normale', 'cyber_alert', { email: P, prenom: 'Marie', alertTitle: 't', alertDesc: 'd', alertLink: 'l', alertSource: 's' }); })
  .then(function () { return cas('guide demandé — désinscrit',        'normale', 'guide_delivery', { email: P, prenom: 'Marie' }); })
  // Pannes
  .then(function () { return cas('table jamais créée — relance',      'absente', 'relance_lead', { email: P, prenom: 'Marie' }); })
  .then(function () { return cas('base en panne — relance',           'panne',   'relance_lead', { email: R, prenom: 'Marie' }); })
  .then(function () { return cas('base en panne — mot de passe',      'panne',   'custom', { email: R, subject: 'x', html: '<p>x</p>' }); })
  .then(function () { print(JSON.stringify(res)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

# part  : l'email doit-il partir ?
# lien  : s'il part, doit-il porter le lien visible « Se désinscrire » ?
ATTENDUS = {
    'relance J+3 — désinscrit':             dict(part=False),
    'relance J+3 — inscrit':                dict(part=True, lien=True),
    'accueil (custom marqué) — désinscrit': dict(part=False),
    'accueil (custom marqué) — inscrit':    dict(part=True, lien=True),
    'bilan mensuel — désinscrit':           dict(part=False),
    'teaser alerte gratuit — désinscrit':   dict(part=False),
    'adresse en majuscules — désinscrit':   dict(part=False),
    'mot de passe (custom) — désinscrit':   dict(part=True, lien=False),
    'alerte payante — désinscrit':          dict(part=True),
    'guide demandé — désinscrit':           dict(part=True),
    # Table absente = personne n'a jamais pu se désinscrire : on envoie.
    'table jamais créée — relance':         dict(part=True),
    # Autre panne : dans le doute, on n'écrit pas à quelqu'un qui a peut-être dit non…
    'base en panne — relance':              dict(part=False),
    # … mais le service, lui, ne dépend pas de cette table.
    'base en panne — mot de passe':         dict(part=True),
}


def banc():
    src = open(CIBLE, encoding='utf-8').read()
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(HARNAIS + '\n' + src + '\n' + VERIF)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print("ÉCHEC — send-email n'a pas pu être exécuté :")
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return False
    d = json.loads(brut.splitlines()[-1])
    if isinstance(d, dict):
        print('ÉCHEC : ' + d.get('erreur', str(d)))
        return False

    print('═' * 74)
    print("QUI REÇOIT QUOI, SELON QU'IL A DIT NON OU PAS")
    print('═' * 74)
    ok = True
    for c in d:
        a = ATTENDUS[c['nom']]
        soucis = []
        if c['statut'] != 200:
            soucis.append('HTTP %s%s' % (c['statut'], ' — ' + c['erreur'] if c.get('erreur') else ''))
        parti = len(c['envois']) > 0
        if parti != a['part']:
            soucis.append('envoyé' if parti else 'NON envoyé')
        if parti and 'lien' in a and c['envois'][0]['lien'] != a['lien']:
            soucis.append('lien visible %s' % ('présent' if c['envois'][0]['lien'] else 'absent'))
        bon = not soucis
        ok = ok and bon
        print('  %-5s %-40s %s' % ('OK' if bon else 'ÉCHEC', c['nom'],
              ' · '.join(soucis) or ('part' if parti else 'retenu')))
    return ok


def relecture():
    # Le banc ne voit que les cas qu'il joue. Cette relecture voit tous les
    # envois : un email ajouté demain à des comptes gratuits, sans la marque,
    # serait signalé ici même si aucun scénario ne passe dessus.
    print()
    print('═' * 74)
    print('AUCUN ENVOI AUX COMPTES GRATUITS QUI IGNORE LE « NON »')
    print('═' * 74)
    src = open(CIBLE, encoding='utf-8').read()
    m = re.search(r'RETENU_SI_DESINSCRIT = new Set\(\[(.*?)\]\)', src, re.S)
    retenus = set(re.findall(r'"([a-z_0-9]+)"', m.group(1))) if m else set()
    fautes = []
    for nom in sorted(os.listdir(FONCTIONS)):
        if not nom.endswith('.js') or nom == 'send-email.js':
            continue
        s = open(os.path.join(FONCTIONS, nom), encoding='utf-8').read()
        if 'send-email' not in s:
            continue
        # Écrit-il à des gens qui n'ont rien acheté ?
        if not re.search(r"\.eq\('subscribed', *false\)|\.eq\('lead', *true\)", s):
            continue
        if 'email_optouts' in s:
            continue          # il vérifie lui-même
        types = set(re.findall(r"""(?:type:\s*|sendEmail\()\s*['"]([a-z_0-9]+)['"]""", s))
        for t in sorted(types):
            if t in retenus:
                continue
            if t == 'custom' and 'marketing: true' in s:
                continue
            fautes.append('%s envoie « %s » à des comptes gratuits sans respecter le désabonnement' % (nom, t))
    for f in fautes:
        print('  ÉCHEC ' + f)
    if not fautes:
        print('  OK    tous les envois aux comptes gratuits passent par le filtre')
    return not fautes


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    ok = banc()
    ok = relecture() and ok
    print()
    print('TOUT EST BON' if ok else 'IL Y A DES ÉCHECS')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
