#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Le banc de la provenance
#
#   python3 tests/test_provenance.py
#
# Ce qu'il garde : la capacité de répondre à « est-ce que la publicité a
# rapporté un client ? ». Cette capacité tenait à rien — une seule page du site
# lisait `fbclid`, et ce n'était pas celle qui encaisse. Zéro abonné et zéro
# mesure se ressemblent exactement : dans les deux cas on ne voit rien.
#
# Le banc exécute la VRAIE fonction extraite d'index.html dans un bac à sable
# JavaScriptCore, avec une fausse adresse, un faux référent et un faux
# localStorage. Pas de copie de la logique : une copie resterait verte le jour
# où l'originale se casserait.
# ════════════════════════════════════════════

import re
import subprocess
import sys
import json
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework'
       '/Versions/A/Helpers/jsc')

VERT, ROUGE, GRIS, RAZ = '\033[32m', '\033[31m', '\033[90m', '\033[0m'
_bilan = {'ok': 0, 'ko': 0}


def verifier(intitule, condition, detail=''):
    if condition:
        _bilan['ok'] += 1
        print(f'  {VERT}✓{RAZ} {intitule}')
    else:
        _bilan['ko'] += 1
        print(f'  {ROUGE}✗{RAZ} {intitule}')
        if detail:
            print(f'    {GRIS}{detail}{RAZ}')


def lire(chemin):
    return (RACINE / chemin).read_text(encoding='utf-8')


def titre(t):
    print(f'\n{t}')
    print('─' * len(t))


# ── Extraction de la vraie fonction ─────────────────────────────────────────
INDEX = lire('index.html')

m = re.search(r'window\.despyProvenance = function \(\) \{.*?\n  \};', INDEX, re.S)
if not m:
    print(f'{ROUGE}despyProvenance introuvable dans index.html — '
          f'le banc ne peut rien vérifier.{RAZ}')
    sys.exit(1)
SOURCE_PROVENANCE = m.group(0)


def provenance(recherche='', referent='', memoire=None):
    """Exécute la vraie despyProvenance() dans jsc.

    Renvoie (canal_retourne, memoire_apres) — la mémoire compte autant que le
    retour : c'est elle qui fait survivre l'origine à la deuxième page.
    """
    socle = """
var __store = %s;
var localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; },
  setItem: function (k, v) { __store[k] = String(v); }
};
var document = { referrer: %s };
var window = { location: { search: %s } };

// URLSearchParams n'existe pas dans jsc : implémentation minimale, mais
// fidèle sur ce dont la fonction se sert (get + décodage des %%XX).
function URLSearchParams(qs) {
  this._m = {};
  String(qs || '').replace(/^\\?/, '').split('&').forEach(function (p) {
    if (!p) return;
    var i = p.indexOf('=');
    var k = i < 0 ? p : p.slice(0, i);
    var v = i < 0 ? '' : p.slice(i + 1);
    try { k = decodeURIComponent(k); v = decodeURIComponent(v.replace(/\\+/g, ' ')); } catch (e) {}
    if (!(k in this._m)) this._m[k] = v;
  }, this);
}
URLSearchParams.prototype.get = function (k) {
  return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null;
};

%s

var __r = window.despyProvenance();
print(JSON.stringify({ retour: __r === undefined ? null : __r, memoire: __store }));
""" % (
        json.dumps(memoire or {}),
        json.dumps(referent),
        json.dumps(recherche),
        SOURCE_PROVENANCE,
    )

    chemin = Path('/tmp/despy_provenance_test.js')
    chemin.write_text(socle, encoding='utf-8')
    r = subprocess.run([JSC, str(chemin)], capture_output=True, text=True)
    sortie = (r.stdout + r.stderr).strip().splitlines()
    if not sortie:
        raise RuntimeError('jsc muet : ' + r.stderr[:300])
    try:
        d = json.loads(sortie[-1])
    except json.JSONDecodeError:
        raise RuntimeError('sortie illisible : ' + sortie[-1][:300])
    return d['retour'], d['memoire']


# ════════════════════════════════════════════════════════════════════════════
print('\n╔══════════════════════════════════════════════╗')
print('║  DESPY — provenance des inscrits             ║')
print('╚══════════════════════════════════════════════╝')

titre("CE QUE LA FONCTION RECONNAÎT")

canal, _ = provenance(recherche='?fbclid=IwAR3xYz_abc123')
verifier("un clic publicitaire Meta (fbclid) → « facebook_ads »",
         canal == 'facebook_ads', f'reçu : {canal!r}')

canal, _ = provenance(recherche='?utm_source=facebook&utm_campaign=seniors67')
verifier("utm_source=facebook → « facebook_ads »",
         canal == 'facebook_ads', f'reçu : {canal!r}')

canal, _ = provenance(recherche='?utm_source=Instagram')
verifier("utm_source=Instagram, majuscule comprise → « facebook_ads »",
         canal == 'facebook_ads', f'reçu : {canal!r}')

canal, _ = provenance(recherche='?utm_source=newsletter_octobre')
verifier("un autre utm_source est conservé tel quel",
         canal == 'newsletter_octobre', f'reçu : {canal!r}')

canal, _ = provenance(referent='https://l.facebook.com/')
verifier("venu de Facebook sans publicité → « facebook_organique »",
         canal == 'facebook_organique', f'reçu : {canal!r}')

canal, memoire = provenance()
verifier("aucun indice → aucune origine inventée",
         canal is None and memoire == {}, f'reçu : {canal!r} / {memoire!r}')


titre("CE QU'ELLE REFUSE DE TRANSMETTRE")

# Le fbclid est un identifiant de clic : il permet de reconnaître UNE personne.
# On n'en a pas besoin pour compter, et le stocker changerait la nature du
# fichier — de statistique à traçage.
_, memoire = provenance(recherche='?fbclid=IwAR3xYz_abc123')
verifier("le fbclid lui-même n'est jamais mémorisé",
         'IwAR3xYz_abc123' not in json.dumps(memoire),
         f'mémoire : {memoire!r}')

canal, _ = provenance(recherche="?utm_source=" + "a<script>alert(1)</script>")
verifier("un utm_source hostile est réduit à des caractères inoffensifs",
         canal is not None and re.fullmatch(r'[a-z0-9_-]*', canal) is not None,
         f'reçu : {canal!r}')

canal, _ = provenance(recherche='?utm_source=' + 'x' * 200)
verifier("un utm_source démesuré est tronqué à 30 caractères",
         canal is not None and len(canal) <= 30, f'longueur : {len(canal or "")}')

canal, _ = provenance(recherche='?utm_source=' + '!!!!')
verifier("un utm_source sans un seul caractère utile → aucune origine",
         canal is None, f'reçu : {canal!r}')


titre("CE QUI SURVIT À LA DEUXIÈME PAGE")

# Le cœur du sujet. Entre la publicité et le paiement il y a des pages lues, un
# guide téléchargé, parfois un retour le lendemain. Sans mémoire, l'origine
# serait perdue dès le deuxième clic et TOUTES les conversions seraient
# attribuées au « direct » — exactement l'angle mort qu'on répare.
_, memoire = provenance(recherche='?fbclid=IwAR3xYz')
verifier("l'origine est mémorisée dès l'arrivée",
         memoire.get('despy_provenance') == 'facebook_ads', f'mémoire : {memoire!r}')

canal, _ = provenance(recherche='', memoire={'despy_provenance': 'facebook_ads'})
verifier("page suivante, sans paramètre → l'origine tient toujours",
         canal == 'facebook_ads', f'reçu : {canal!r}')

canal, memoire = provenance(recherche='?utm_source=newsletter',
                            memoire={'despy_provenance': 'facebook_ads'})
verifier("une origine explicite écrase la précédente",
         canal == 'newsletter' and memoire.get('despy_provenance') == 'newsletter',
         f'reçu : {canal!r} / {memoire!r}')


titre("CE QUI EST RÉELLEMENT ENVOYÉ AU SERVEUR")

# `\b` et pas seulement `provenance:` : sans la limite de mot, renommer la clé
# en `_provenance:` — ce qui la rend invisible du serveur — laissait ce banc au
# vert. Trouvé en réinjectant la panne, pas en relisant le test.
verifier("la page d'accueil transmet la provenance au paiement",
         re.search(r'create-checkout[\s\S]{0,900}?\bprovenance:', INDEX) is not None,
         'aucun `provenance:` dans le corps de l’appel à create-checkout')

verifier("la page d'accueil transmet la provenance à l'inscription gratuite",
         re.search(r'register-free[\s\S]{0,900}?\bprovenance:', INDEX) is not None,
         'aucun `provenance:` dans le corps de l’appel à register-free')

verifier("la mesure ne dépend PAS du consentement publicitaire",
         'despyAdConsent' not in SOURCE_PROVENANCE,
         'despyProvenance consulte le consentement : elle ne compterait '
         'alors que ceux qui cliquent « Accepter », soit l’angle mort actuel')

verifier("elle ne lit et ne pose aucun cookie",
         'document.cookie' not in SOURCE_PROVENANCE,
         'un cookie ici exigerait le consentement — et la mesure redeviendrait aveugle')


titre("CE QUE LE FORMULAIRE NE DEMANDE PLUS")

verifier("plus de champ « date de naissance » dans l'abonnement",
         "id = 'sub-dob'" not in INDEX and 'sub-dob\'; ' not in INDEX,
         'le champ date de naissance est toujours construit')

verifier("plus de refus d'abonnement faute de date de naissance",
         'Veuillez entrer votre date de naissance' not in INDEX,
         'la validation bloquante existe encore')

# Attention au piège : le formulaire d'inscription GRATUITE garde une
# vérification du téléphone, et c'est très bien — elle est facultative
# (`if (tel && …)`), elle ne bloque personne, elle attrape juste une faute de
# frappe. Ce qui devait disparaître, c'est le refus pur et simple de
# l'abonnement (`if (!tel || …)`). Chercher le message d'erreur, comme je
# l'avais d'abord écrit, confondait les deux.
verifier("plus de refus d'abonnement faute de téléphone",
         re.search(r'if \(!tel \|\|', INDEX) is None,
         'la validation bloquante existe encore dans le tunnel payant')

verifier("le formulaire gratuit, lui, valide toujours un téléphone mal saisi",
         re.search(r'if \(tel && tel\.replace', INDEX) is not None,
         'un contrôle utile et non bloquant a été retiré par erreur')

CHECKOUT = lire('netlify/functions/create-checkout.js')
# Chercher le mot `phone_number_collection` ne suffisait pas : je l'ai écrit
# trois fois dans les commentaires alentour, si bien qu'en supprimant la vraie
# ligne le banc restait vert — et le numéro de tous les abonnés était perdu en
# silence. On exige donc le réglage effectivement activé.
verifier("c'est Stripe qui demande désormais le téléphone",
         re.search(r'^\s*phone_number_collection:\s*\{\s*enabled:\s*true\s*\}',
                   CHECKOUT, re.M) is not None,
         'sans ça, le numéro est simplement perdu — et la promesse '
         '« un humain vous rappelle » avec lui')

WEBHOOK = lire('netlify/functions/stripe-webhook.js')
verifier("le webhook récupère bien le téléphone donné à Stripe",
         'customer_details?.phone' in WEBHOOK,
         'le numéro collecté par Stripe n’est jamais relu')

verifier("l'ancien numéro (métadonnée) reste accepté en second rideau",
         'despy_tel' in WEBHOOK,
         'les sessions créées avant ce changement perdraient leur numéro')


titre("SI LE SCRIPT SQL N'A PAS ENCORE ÉTÉ PASSÉ")

# Leçon déjà payée sur la veille presse : le code est déployé par Netlify en
# quelques secondes, le script SQL est passé à la main quand l'humain y pense.
# Entre les deux, la colonne n'existe pas. Rien de ce qui compte ne doit
# s'arrêter pour autant.
# `^\s*delete` : la présence de la chaîne ne suffit pas. Mettre la ligne en
# commentaire — le geste le plus banal du monde — laissait ce banc au vert
# alors que plus aucun compte ne pouvait être créé. Il faut que la ligne soit
# vivante, pas seulement écrite.
LIGNE_VIVANTE = r'^\s*delete[^\n/]*fiche\.provenance'

REGISTER = lire('netlify/functions/register-free.js')
verifier("une inscription reste possible sans la colonne `provenance`",
         re.search(LIGNE_VIVANTE, REGISTER, re.M) is not None,
         'l’insertion échouerait en entier : plus aucun compte créable')

verifier("le webhook active l'abonnement même sans la colonne",
         re.search(LIGNE_VIVANTE, WEBHOOK, re.M) is not None,
         'un client paierait sans que son abonnement soit activé')

STATS = lire('netlify/functions/admin-stats.js')
verifier("le tableau de bord interroge `provenance` à part",
         re.search(r"\.select\('provenance, subscribed, created_at'\)", STATS) is not None,
         'ajoutée à la sélection principale, une colonne absente ferait '
         'échouer TOUT le tableau de bord')

verifier("la sélection principale ne mentionne pas `provenance`",
         re.search(r"\.select\('email, prenom[^']*provenance", STATS) is None,
         'écran blanc garanti tant que le script SQL n’est pas passé')

verifier("le script SQL existe et est réexécutable",
         'ADD COLUMN IF NOT EXISTS provenance' in lire('sql_migration_provenance.sql'))


# ════════════════════════════════════════════════════════════════════════════
print()
total = _bilan['ok'] + _bilan['ko']
if _bilan['ko']:
    print(f"{ROUGE}{_bilan['ko']} échec(s) sur {total}.{RAZ}")
    sys.exit(1)
print(f"{VERT}Les {total} vérifications passent.{RAZ}")
print(f"{GRIS}Rappel : un banc vert ne prouve rien tant qu'on n'a pas vu")
print(f"une vraie panne le faire rougir.{RAZ}\n")
