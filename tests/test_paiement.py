#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du webhook Stripe
#
# C'est le seul endroit du code où de l'argent change de main. Et c'était,
# jusqu'ici, le moins vérifié : neuf appels à la base y étaient lancés sans
# jamais lire la réponse. Une écriture qui rate en silence, et le membre est
# débité chez Stripe tout en restant « compte gratuit » chez nous. Pire : il
# reçoit quand même son email de bienvenue, donc il ne réclame pas tout de
# suite — et nous ne voyons rien, puisqu'il n'y a ni erreur ni log.
#
# Le filet existe pourtant, et il est gratuit : Stripe REJOUE pendant 3 jours
# tout webhook qui ne répond pas 2xx. Il suffit de ne pas accuser réception
# tant que la base n'a pas enregistré ce qui a été payé.
#
# Ce banc vérifie les deux moitiés de ce contrat, sans réseau et sans base :
#   A. base en panne → HTTP 500 (Stripe rejouera) et AUCUN email envoyé ;
#   B. base normale  → HTTP 200 et les emails partent bien.
#
# Le B compte autant que le A : un garde-fou qui bloque aussi les cas normaux
# ne protège personne, il casse les abonnements.
#
# Usage : python3 tests/test_paiement.py
# ════════════════════════════════════════════

import json, os, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CIBLE = os.path.join(RACINE, 'netlify', 'functions', 'stripe-webhook.js')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

HARNAIS = r"""
// ── Le monde extérieur, en toc ──────────────────────────────────────────────
var PANNE = false;        // la base refuse-t-elle les écritures ?
var ECRITURES = [];       // ce qui a été écrit
var EMAILS = [];          // ce qui a été envoyé
var EVENEMENT = null;     // ce que Stripe nous raconte
var SIGNATURE_OK = true;

var console = { log: function(){}, warn: function(){}, error: function(){} };

var process = { env: {
  URL: 'https://despy.fr',
  INTERNAL_SECRET: 's',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_KEY: 'k',
  STRIPE_PRICE_MONTHLY: 'price_m',
  STRIPE_PRICE_ANNUAL: 'price_a'
} };

var AbortSignal = { timeout: function(){ return null; } };

// Le membre existe déjà en base avec la formule mensuelle : c'est ce qui rend
// « price_a » (annuel) détectable comme un VRAI changement de formule.
var LIGNE = { plan: 'monthly', payment_issue_at: null };

function chaine(table) {
  var op = null;
  var c = {};
  ['upsert', 'update', 'insert', 'delete'].forEach(function (n) {
    c[n] = function () { op = n; return c; };
  });
  c.select = function () { op = 'select'; return c; };
  c.eq = function () { return c; };
  c.maybeSingle = function () { return c; };
  c.single = function () { return c; };
  // `await requete` passe par ici.
  c.then = function (resoudre) {
    if (op === 'select') return resoudre({ data: LIGNE, error: null });
    if (PANNE) return resoudre({ data: null, error: { message: 'connexion refusée' } });
    ECRITURES.push(table + '.' + op);
    return resoudre({ data: [{}], error: null });
  };
  return c;
}

function fetch(url, opts) {
  var corps = {};
  try { corps = JSON.parse(opts.body); } catch (e) {}
  EMAILS.push(corps.type || url);
  return Promise.resolve({ ok: true, status: 200,
                           text: function(){ return Promise.resolve(''); } });
}

function require(nom) {
  if (nom === 'stripe') return function () {
    return {
      webhooks: { constructEvent: function () {
        if (!SIGNATURE_OK) throw new Error('No signatures found matching');
        return EVENEMENT;
      } },
      customers: { retrieve: function () {
        return Promise.resolve({ email: 'marie@example.fr', name: 'Marie Durand' });
      } }
    };
  };
  if (nom === '@supabase/supabase-js') return {
    createClient: function () { return { from: function (t) { return chaine(t); } }; }
  };
  if (nom === 'crypto') return { createHash: function () {
    var o = { update: function () { return o; }, digest: function () { return 'h'; } };
    return o;
  } };
  throw new Error('module inattendu : ' + nom);
}

var exports = {}, module = { exports: exports };
"""

VERIF = r"""
var handler = module.exports.handler || exports.handler;

var ACHAT = { type: 'checkout.session.completed', data: { object: {
  id: 'cs_1', customer: 'cus_1', subscription: 'sub_1',
  metadata: { despy_email: 'marie@example.fr', despy_name: 'Marie Durand',
              despy_plan: 'monthly' } } } };

var RENOUVELLEMENT = { type: 'invoice.payment_succeeded', data: { object: {
  billing_reason: 'subscription_cycle', customer: 'cus_1',
  subscription: 'sub_1', lines: { data: [{ period: { end: 1790000000 } }] } } } };

var FORMULE = { type: 'customer.subscription.updated', data: { object: {
  customer: 'cus_1', status: 'active',
  items: { data: [{ price: { id: 'price_a' } }] } } } };

var FIN = { type: 'customer.subscription.deleted', data: { object: {
  customer: 'cus_1', cancellation_details: { reason: 'cancellation_requested' } } } };

var res = [];

function cas(nom, evenement, panne, signature) {
  EVENEMENT = evenement; PANNE = panne; SIGNATURE_OK = signature !== false;
  ECRITURES = []; EMAILS = [];
  return handler({ headers: { 'stripe-signature': 'sig' }, body: '{}' })
    .then(function (r) {
      res.push({ nom: nom, statut: r && r.statusCode,
                 emails: EMAILS.slice(), ecritures: ECRITURES.slice() });
    })
    .catch(function (e) {
      res.push({ nom: nom, statut: 'EXCEPTION', erreur: String(e && e.message || e),
                 emails: EMAILS.slice(), ecritures: ECRITURES.slice() });
    });
}

Promise.resolve()
  .then(function () { return cas('achat — base en panne',         ACHAT, true); })
  .then(function () { return cas('achat — base normale',          ACHAT, false); })
  .then(function () { return cas('renouvellement — base en panne', RENOUVELLEMENT, true); })
  .then(function () { return cas('renouvellement — base normale',  RENOUVELLEMENT, false); })
  .then(function () { return cas('changement de formule — base en panne', FORMULE, true); })
  .then(function () { return cas('changement de formule — base normale',  FORMULE, false); })
  .then(function () { return cas('résiliation — base en panne',   FIN, true); })
  .then(function () { return cas('résiliation — base normale',    FIN, false); })
  .then(function () { return cas('signature invalide',            ACHAT, false, false); })
  .then(function () { print(JSON.stringify(res)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

# Ce que chaque situation DOIT produire.
#   statut         : le code HTTP renvoyé à Stripe
#   emails         : nombre d'emails partis
#   ecritures_min  : nombre minimum d'écritures réussies
ATTENDUS = {
    'achat — base en panne':                 dict(statut=500, emails=0),
    'achat — base normale':                  dict(statut=200, emails=2, ecritures_min=2),
    'renouvellement — base en panne':         dict(statut=500, emails=0),
    'renouvellement — base normale':          dict(statut=200, ecritures_min=1),
    'changement de formule — base en panne':  dict(statut=500, emails=0),
    'changement de formule — base normale':   dict(statut=200, ecritures_min=2),
    'résiliation — base en panne':            dict(statut=500, emails=0),
    'résiliation — base normale':             dict(statut=200, emails=1, ecritures_min=2),
    'signature invalide':                     dict(statut=400, emails=0),
}


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

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
        print('ÉCHEC — le webhook n\'a pas pu être exécuté :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    d = json.loads(brut.splitlines()[-1])
    if isinstance(d, dict):
        print('ÉCHEC : ' + d.get('erreur', str(d)))
        return 1

    print('═' * 74)
    print('CE QUE STRIPE REÇOIT, ET CE QUE LE MEMBRE REÇOIT')
    print('═' * 74)
    ok = True
    for c in d:
        a = ATTENDUS[c['nom']]
        soucis = []
        if c['statut'] != a['statut']:
            soucis.append('HTTP %s au lieu de %d%s' % (
                c['statut'], a['statut'],
                ' — ' + c['erreur'] if c.get('erreur') else ''))
        if 'emails' in a and len(c['emails']) != a['emails']:
            soucis.append('%d email(s) envoyé(s) au lieu de %d : %s'
                          % (len(c['emails']), a['emails'], ', '.join(c['emails'])))
        if 'ecritures_min' in a and len(c['ecritures']) < a['ecritures_min']:
            soucis.append('%d écriture(s) seulement : %s'
                          % (len(c['ecritures']), ', '.join(c['ecritures']) or 'aucune'))
        bon = not soucis
        ok = ok and bon
        print('  %-5s %-38s %s' % ('OK' if bon else 'ÉCHEC', c['nom'],
                                   ' · '.join(soucis) or
                                   ('HTTP %s, %d email(s), %d écriture(s)'
                                    % (c['statut'], len(c['emails']), len(c['ecritures'])))))

    print()
    print('═' * 74)
    print('AUCUNE ÉCRITURE PAYANTE LAISSÉE SANS SURVEILLANCE')
    print('═' * 74)
    # Le banc ci-dessus ne voit que les chemins qu'il emprunte. Cette relecture,
    # elle, voit TOUT le fichier : une écriture ajoutée demain sans garde-fou
    # sera signalée ici même si aucun scénario ne passe dessus.
    #
    # Elle couvre les quatre fichiers où une écriture ratée coûte de l'argent à
    # quelqu'un : l'abonnement lui-même, et les trois endroits qui promettent
    # un mois offert (parrainage). Ailleurs dans le code, une écriture perdue
    # se rattrape ; ici, non — le membre a payé, ou on lui a promis.
    aveugles = []
    for nom in ('stripe-webhook', 'apply-referral', 'auth-google', 'register-free'):
        lignes = open(os.path.join(RACINE, 'netlify', 'functions', nom + '.js'),
                      encoding='utf-8').read().splitlines()
        for i, l in enumerate(lignes):
            if '.upsert(' not in l and '.update(' not in l and '.insert(' not in l:
                continue
            if 'supabase' not in l and 'supabase' not in (lignes[i - 1] if i else ''):
                continue
            # Surveillée si : passée à ecrire(), ou sa réponse est lue.
            contexte = '\n'.join(lignes[max(0, i - 3):i + 1])
            if 'ecrire(' in contexte or 'error' in contexte:
                continue
            aveugles.append((nom, i + 1, l.strip()[:56]))
    ok = ok and not aveugles
    print('  %-5s %d écriture(s) sans surveillance sur les 4 fichiers de l\'argent'
          % ('OK' if not aveugles else 'ÉCHEC', len(aveugles)))
    for f, n, l in aveugles:
        print('        %s ligne %d : %s' % (f, n, l))

    print()
    print('RÉSULTAT : ' + ('un paiement perdu est impossible.' if ok
                           else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
