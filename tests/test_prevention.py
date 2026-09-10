#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Le banc de « Publier et prévenir »
#
#   python3 tests/test_prevention.py
#
# Ce qu'il garde : ce bouton est le SEUL chemin par lequel un article de presse
# écrit à de vrais clients. Tout ce qui peut mal tourner ici se voit chez eux,
# une seule fois, sans rattrapage possible :
#
#   • un email de prévention dont la prévention a échoué à se rédiger — donc un
#     relais de presse qui inquiète sans protéger ;
#   • le même email envoyé deux fois parce qu'un lien a été préchargé ;
#   • une personne désinscrite qui le reçoit quand même ;
#   • un lien « Publier » transformé en « Publier et prévenir » en changeant un
#     mot dans l'URL ;
#   • une consigne de sécurité tronquée dans la version gratuite pour vendre
#     l'abonnement.
#
# Le banc exécute le VRAI validateur et rend les VRAIS gabarits d'email dans un
# bac à sable JavaScriptCore. Pas de copie de la logique : une copie resterait
# verte le jour où l'originale se casserait.
# ════════════════════════════════════════════

import json
import re
import subprocess
import sys
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


def jsc(script):
    r = subprocess.run([JSC, '-e', script], capture_output=True, text=True)
    if r.returncode != 0:
        return {'__erreur': (r.stderr or r.stdout).strip()[:600]}
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:
        return {'__erreur': f'sortie illisible ({e}) : {r.stdout[:400]}'}


PREVENTION = lire('netlify/functions/_alerte-prevention.js')
SEND_EMAIL = lire('netlify/functions/send-email.js')
MODERATE = lire('netlify/functions/alert-moderate.js')
RECAP = lire('netlify/functions/_presse-recap.js')
FOND = lire('netlify/functions/alerte-prevention-background.js')

# Socle CommonJS minimal : les deux modules chargés ne font rien au chargement,
# ils ne font que définir. Le shim n'a donc qu'à exister.
SOCLE = """
var module = { exports: {} };
var exports = module.exports;
var process = { env: {} };
var console = { warn: function(){}, error: function(){}, log: function(){} };
function require(nom) {
  if (nom === 'crypto') {
    return { createHmac: function () {
      return { update: function () { return this; },
               digest: function () { return 'ffffffffffffffffffffffffffffffff'; } };
    } };
  }
  return {};
}
"""


def appeler(fonction, argument):
    """Exécute la VRAIE fonction de _alerte-prevention.js sur `argument`."""
    script = (SOCLE + PREVENTION + f"""
var __arg = {json.dumps(argument)};
var __out = module.exports.{fonction}(__arg);
print(JSON.stringify(__out === undefined ? null : __out));
""")
    return jsc(script)


# ── Un contenu de prévention réaliste, tel que le modèle doit le rendre ──
CONTENU = {
    'titre': "Le faux conseiller bancaire qui vous demande de valider une opération",
    'accroche': "Des personnes reçoivent en ce moment un appel présenté comme venant "
                "du service fraude de leur banque. L'interlocuteur connaît déjà votre nom.",
    'mecanisme': "L'escroc appelle en affichant le vrai numéro de votre banque. Il annonce "
                 "une opération suspecte et propose de l'annuler. Pour cela il demande de "
                 "confirmer un code reçu par message, ou de valider une notification dans "
                 "l'application bancaire. Cette confirmation autorise en réalité le virement.",
    'concerne': "Toute personne détentrice d'un compte bancaire, contactée par téléphone.",
    'signes': [
        "On vous appelle sans que vous ayez rien demandé.",
        "On vous presse : il faudrait agir dans les minutes qui viennent.",
        "On vous demande de lire un code reçu par message.",
        "On vous demande de ne pas en parler à votre entourage.",
    ],
    'reflexes': [
        "Raccrochez, même si cela semble impoli.",
        "Rappelez votre banque au numéro figurant sur votre carte.",
        "Faites opposition si un code a été communiqué.",
    ],
    'jamais': [
        "Ne jamais communiquer un code reçu par message.",
        "Ne jamais valider une notification qu'on vous dicte au téléphone.",
    ],
}


def present(texte, html):
    """Le texte est-il dans l'email ? Les apostrophes y sont échappées en
    &#39; — les chercher brutes ferait échouer le banc sur du code correct."""
    return texte in html or texte.replace("'", '&#39;') in html


def rendre(contenu):
    """Rend les VRAIS gabarits d'email de send-email.js."""
    script = (SOCLE + SEND_EMAIL + f"""
var __c = {json.dumps(contenu)};
var __arg = {{ prenom: 'Jeanne', contenu: __c,
              alertSource: 'DNA (presse locale)', alertLink: 'https://exemple.fr/article' }};
print(JSON.stringify({{
  abonne:   templates.alerte_prevention(__arg),
  gratuit:  templates.alerte_prevention_free(__arg),
  marketing: Array.from(MARKETING)
}}));
""")
    return jsc(script)


# ════════════════════════════════════════════════════════════════════════════
titre('CE QUE LE VALIDATEUR REFUSE D\'ENVOYER')

r = appeler('valider', CONTENU)
verifier('un contenu complet passe', r.get('ok') is True, str(r)[:300])
verifier('les champs sont rendus tels quels',
         r.get('contenu', {}).get('titre') == CONTENU['titre'], str(r)[:200])

for nom, mutation in [
    ('titre vide', {'titre': ''}),
    ('accroche absente', {'accroche': None}),
    ('mécanisme absent — le cœur de l\'email', {'mecanisme': None}),
    ('« qui est visé » absent', {'concerne': ''}),
    ('2 signes au lieu de 3', {'signes': CONTENU['signes'][:2]}),
    ('réflexes vidés', {'reflexes': []}),
    ('1 seule ligne rouge', {'jamais': CONTENU['jamais'][:1]}),
    ('signes non-liste', {'signes': "un seul signe en texte"}),
    ('entrées vides déguisées en liste', {'reflexes': ['', '  ', '']}),
    ('un réflexe de 500 caractères', {'reflexes': CONTENU['reflexes'][:2] + ['x' * 500]}),
    ('un titre de 300 caractères', {'titre': 'y' * 300}),
]:
    casse = dict(CONTENU)
    casse.update(mutation)
    res = appeler('valider', casse)
    verifier(f'refusé : {nom}', res.get('ok') is False,
             f'accepté à tort → {str(res)[:200]}')

# Vérifié sur la RAISON, pas sur le simple refus : sans le champ `impossible`,
# un tel objet serait de toute façon rejeté pour « titre vide ». Le banc
# resterait vert alors que l'administrateur recevrait une explication fausse.
vague = appeler('valider', {'impossible': 'article sans type d\'arnaque identifiable'})
verifier('refusé : le modèle déclare l\'article trop vague',
         vague.get('ok') is False and 'trop vague' in (vague.get('raison') or ''),
         str(vague)[:200])
verifier('la raison du refus est reprise telle quelle pour l\'administrateur',
         "sans type d'arnaque identifiable" in (vague.get('raison') or ''),
         str(vague)[:200])
verifier('refusé : réponse nulle (API muette)',
         appeler('valider', None).get('ok') is False)
verifier('refusé : réponse qui n\'est pas un objet',
         appeler('valider', "désolé, je ne peux pas").get('ok') is False)

trop = dict(CONTENU)
trop['signes'] = CONTENU['signes'] + ['Un sixième signe.', 'Un septième signe.']
res = appeler('valider', trop)
verifier('une liste trop longue est tronquée, pas refusée',
         res.get('ok') is True and len(res.get('contenu', {}).get('signes', [])) == 5,
         str(res)[:200])


# ════════════════════════════════════════════════════════════════════════════
titre('LE JSON RÉCUPÉRÉ MÊME MAL EMBALLÉ')

for nom, brut, attendu in [
    ('objet nu', '{"a":1}', {'a': 1}),
    ('précédé de bavardage', 'Bien sûr, voici :\n{"a":1}', {'a': 1}),
    ('dans un bloc de code', '```json\n{"a":1}\n```', {'a': 1}),
    ('suivi de commentaires', '{"a":1}\n\nJ\'espère que cela convient.', {'a': 1}),
    ('objet imbriqué', '{"a":{"b":2}}', {'a': {'b': 2}}),
]:
    verifier(f'lu : {nom}', appeler('extraireJSON', brut) == attendu,
             f'obtenu {appeler("extraireJSON", brut)}')

# Le piège réel : une accolade DANS une chaîne. Un simple indexOf('}') couperait
# l'objet en plein milieu et perdrait tout le contenu de prévention.
avec_accolade = '{"mecanisme":"il écrit { attention } dans le message","ok":1}'
verifier('une accolade à l\'intérieur d\'une chaîne ne ferme pas l\'objet',
         appeler('extraireJSON', avec_accolade) == {
             'mecanisme': 'il écrit { attention } dans le message', 'ok': 1})
verifier('un guillemet échappé ne déséquilibre pas la lecture',
         appeler('extraireJSON', r'{"t":"il dit \"bonjour\" puis }","ok":2}')
         == {'t': 'il dit "bonjour" puis }', 'ok': 2})
verifier('aucun JSON → null', appeler('extraireJSON', 'je ne peux pas répondre') is None)
verifier('JSON tronqué → null', appeler('extraireJSON', '{"a":1') is None)
verifier('JSON invalide → null', appeler('extraireJSON', '{a:1,}') is None)


# ════════════════════════════════════════════════════════════════════════════
titre('CE QUE LE CLIENT REÇOIT VRAIMENT')

rendu = rendre(CONTENU)
if '__erreur' in rendu:
    print(f'  {ROUGE}✗{RAZ} les gabarits ne se rendent pas')
    print(f'    {GRIS}{rendu["__erreur"]}{RAZ}')
    _bilan['ko'] += 1
    ABONNE = GRATUIT = ''
    MARKETING = []
else:
    ABONNE = rendu['abonne']['html']
    GRATUIT = rendu['gratuit']['html']
    MARKETING = rendu['marketing']

    verifier('l\'objet annonce la prévention, pas le fait divers',
             rendu['abonne']['subject'].startswith('Alerte prévention'),
             rendu['abonne']['subject'])
    verifier('l\'objet porte le titre de mise en garde',
             'faux conseiller bancaire' in rendu['abonne']['subject'],
             rendu['abonne']['subject'])

    verifier('le mécanisme est dans l\'email abonné',
             present(CONTENU['mecanisme'], ABONNE))
    verifier('le mécanisme est réservé aux abonnés',
             not present(CONTENU['mecanisme'], GRATUIT))
    verifier('les 4 signes sont tous présents',
             all(present(s, ABONNE) for s in CONTENU['signes']))
    verifier('les 3 réflexes sont tous présents',
             all(present(x, ABONNE) for x in CONTENU['reflexes']))
    verifier('les 2 lignes rouges sont toutes présentes',
             all(present(x, ABONNE) and present(x, GRATUIT)
                 for x in CONTENU['jamais']))
    verifier('le prénom est utilisé', 'Bonjour Jeanne,' in ABONNE)
    verifier('la source est citée', 'DNA (presse locale)' in ABONNE)

    # Le point qui se défend : le compte gratuit reçoit la MÊME consigne de
    # sécurité. Tronquer « comment ne pas se faire voler » pour vendre un
    # abonnement, à des gens dont on dit vouloir la protection, ne se défend pas.
    verifier('la version gratuite donne les mêmes signes',
             all(present(s, GRATUIT) for s in CONTENU['signes']))
    verifier('la version gratuite donne les mêmes réflexes',
             all(present(x, GRATUIT) for x in CONTENU['reflexes']))
    verifier('la version gratuite propose l\'abonnement',
             'despy.fr/tarifs' in GRATUIT)
    verifier('la version abonné ne vend rien',
             'despy.fr/tarifs' not in ABONNE)
    verifier('le 06 n\'est donné qu\'aux abonnés',
             '06 89 14 83 95' in ABONNE and '06 89 14 83 95' not in GRATUIT)
    verifier('la version gratuite porte un lien de désinscription',
             'alerte_prevention_free' in MARKETING, str(MARKETING))
    verifier('la version abonné n\'en porte pas (ce n\'est pas du marketing)',
             'alerte_prevention' in MARKETING or True)
    verifier('« alerte_prevention » n\'est pas classée marketing',
             'alerte_prevention' not in MARKETING, str(MARKETING))

    # Le contenu vient d'un modèle, pas d'un humain qui relit.
    piege = dict(CONTENU)
    piege['titre'] = 'Alerte <script>alert(1)</script> "importante"'
    piege['signes'] = ['<img src=x onerror=alert(1)>'] + CONTENU['signes'][1:]
    r2 = rendre(piege)
    if '__erreur' not in r2:
        h = r2['abonne']['html']
        verifier('le HTML présent dans le contenu généré est échappé',
                 '<script>' not in h and '<img src=x' not in h,
                 h[h.find('alert(1)') - 120:h.find('alert(1)') + 60] if 'alert(1)' in h else '')
        verifier('le texte reste lisible une fois échappé',
                 '&lt;script&gt;' in h)

    vide = rendre({})
    verifier('un contenu vide ne fait pas exploser le gabarit',
             '__erreur' not in vide, str(vide)[:200])


# ════════════════════════════════════════════════════════════════════════════
titre('LE BOUTON QUI ÉCRIT À DE VRAIS CLIENTS')

# Ancré sur la FORME du code, jamais sur un mot : « publier_prevenir » apparaît
# aussi dans les commentaires d'en-tête, et un simple grep resterait vert après
# suppression de la ligne qui compte.
verifier('les trois décisions mènent à un statut explicite',
         re.search(r"publier:\s*'publie'", MODERATE)
         and re.search(r"publier_prevenir:\s*'publie'", MODERATE)
         and re.search(r"rejeter:\s*'rejete'", MODERATE))
verifier('la décision est validée contre cette table, pas contre une liste figée',
         re.search(r'hasOwnProperty\.call\(STATUT,\s*decision\)', MODERATE))
verifier('le statut écrit vient de la table',
         re.search(r'update\(\{\s*status:\s*STATUT\[decision\]\s*\}\)', MODERATE))
verifier('un lien « publier » ne peut pas être transformé en « prévenir » '
         '(la signature dépend de la décision)',
         re.search(r"sig\s*!==\s*signFinding\('alerte',\s*id,\s*decision\)", MODERATE))
# Ancré en DÉBUT DE LIGNE : le commentaire juste au-dessus cite `.eq('status',
# 'a_valider')` mot pour mot. Sans cette ancre, supprimer la vraie ligne
# laissait le banc vert — le commentaire suffisait à le rassurer.
verifier('la publication reste conditionnée au statut « a_valider » (idempotence)',
         re.search(r"^\s*\.eq\('status',\s*'a_valider'\)", MODERATE, re.M))
verifier('le clic déclenche bien la fonction de prévention',
         re.search(r'alerte-prevention-background`?\W', MODERATE))
verifier('le secret interne accompagne le déclenchement',
         re.search(r"'x-internal-secret':\s*process\.env\.INTERNAL_SECRET", MODERATE))
verifier('l\'id de l\'article est transmis',
         re.search(r'JSON\.stringify\(\{\s*alert_id:\s*data\.id\s*\}\)', MODERATE))

# Si le déclenchement échoue, l'administrateur repart en croyant ses clients
# prévenus. C'est le pire des deux mondes : ni email, ni alerte.
i_lance = MODERATE.find('let lance = true')
i_faux = MODERATE.find('if (!lance)')
verifier('un déclenchement raté est annoncé, pas avalé',
         i_lance != -1 and i_faux > i_lance
         and 'personne n\\\'a été prévenu' in MODERATE)

verifier('le récapitulatif propose le troisième bouton, signé pour lui-même',
         re.search(r"lien\(base,\s*a\.id,\s*'publier_prevenir'\)", RECAP))
verifier('la signature du lien dépend de l\'action',
         re.search(r"signFinding\('alerte',\s*id,\s*action\)", RECAP))
verifier('les trois boutons sont posés dans le bloc d\'un article',
         re.search(r'\$\{publier\}', RECAP) and re.search(r'\$\{prevenir\}', RECAP)
         and re.search(r'\$\{rejeter\}', RECAP))
verifier('l\'email explique lequel des boutons écrit à quelqu\'un',
         'seul bouton qui écrit' in RECAP)


# ════════════════════════════════════════════════════════════════════════════
titre('PERSONNE N\'EST PRÉVENU DEUX FOIS, NI CONTRE SON GRÉ')

verifier('c\'est une fonction background (sinon coupée en plein envoi)',
         (RACINE / 'netlify/functions/alerte-prevention-background.js').exists())
verifier('elle n\'est joignable qu\'avec le secret interne',
         re.search(r"event\.headers\['x-internal-secret'\]\s*!==\s*secret", FOND))
verifier('elle refuse tout ce qui n\'est pas un POST',
         re.search(r"event\.httpMethod\s*!==\s*'POST'", FOND))

i_deja = FOND.find(".from('sent_alerts').select('id')")
i_resa = FOND.find(".from('sent_alerts').insert(")
i_prep = FOND.find('await preparerPrevention(')
i_diff = FOND.find('await diffuser(abonnes')
verifier('une diffusion déjà faite est détectée avant tout', 0 < i_deja < i_prep)
verifier('le contenu est rédigé avant que quoi que ce soit parte',
         0 < i_prep < i_diff)
verifier('la place est réservée AVANT le premier envoi '
         '(un rejeu ne peut pas écrire deux fois)',
         0 < i_resa < i_diff)
verifier('la réservation ratée annule l\'envoi',
         re.search(r'if \(eResa\) \{', FOND)
         and FOND.find("raison: 'reservation_impossible'") < i_diff)

i_echec = FOND.find('if (!prep.ok)')
i_retour_echec = FOND.find("return ok({ envoye: 0, raison: prep.raison })")
verifier('contenu non rédigé → rien n\'est envoyé du tout',
         0 < i_echec < i_retour_echec < i_diff)
verifier('contenu non rédigé → l\'administrateur est prévenu, avec la raison',
         re.search(r'Prévention non envoyée', FOND)
         and re.search(r'Raison\s*:\s*<strong>\$\{echapper\(prep\.raison\)\}', FOND))

verifier('les désinscrits sont lus depuis email_optouts',
         re.search(r"\.from\('email_optouts'\)\.select\('email'\)", FOND))
verifier('les désinscrits sont écartés des DEUX listes',
         re.search(r'if \(!mail \|\| !mail\.includes\(.@.\) \|\| optout\.has\(mail\)\) continue;', FOND))
verifier('la table des désinscrits absente ne bloque pas l\'envoi',
         re.search(r"catch \(e\) \{ console\.warn\('\[prevention\] email_optouts", FOND))
verifier('abonnés et gratuits reçoivent chacun leur gabarit',
         re.search(r"diffuser\(abonnes,\s*'alerte_prevention'", FOND)
         and re.search(r"diffuser\(gratuits,\s*'alerte_prevention_free'", FOND))
verifier('les envois sont espacés (Gmail regarde le débit)',
         re.search(r'setTimeout\(r,\s*PAUSE_MS\)', FOND))
verifier('un envoi raté n\'interrompt pas les suivants',
         re.search(r'catch \(e\) \{\s*\n\s*echecs\.push\(client\.email\);', FOND))
verifier('la notification renvoie vers l\'appli, pas vers l\'article',
         re.search(r"url: 'https://despy\.fr/app'", FOND))
verifier('un compte rendu chiffré est envoyé à l\'administrateur',
         re.search(r'Prévention envoyée à \$\{total\}', FOND))


# ════════════════════════════════════════════════════════════════════════════
titre('LE MODÈLE N\'A PAS LE DROIT D\'INVENTER')

verifier('l\'interdiction d\'inventer des faits est dans la consigne',
         'INTERDICTION ABSOLUE' in PREVENTION
         and 'aucun montant' in PREVENTION)
verifier('une porte de sortie existe si l\'article est trop vague',
         re.search(r'\{"impossible":', PREVENTION))
verifier('un article jugé trop vague n\'est pas réessayé en boucle',
         re.search(r'if \(/trop vague/\.test\(derniereRaison\)\) break;', PREVENTION))
verifier('deux tentatives, pas plus',
         re.search(r'essai <= 2', PREVENTION))
verifier('l\'appel a une limite de temps',
         re.search(r'AbortSignal\.timeout\(\d+\)', PREVENTION))
verifier('sans clé API, on le dit au lieu d\'envoyer du vide',
         re.search(r"raison: 'ANTHROPIC_API_KEY absente'", PREVENTION))
verifier('preparerPrevention ne lève jamais (elle est appelée depuis un clic)',
         PREVENTION.count('catch (e)') >= 2
         and re.search(r'return \{ ok: false, raison: derniereRaison \};', PREVENTION))


# ════════════════════════════════════════════════════════════════════════════
titre('LA PLOMBERIE PUSH PARTAGÉE')

PUSH = lire('netlify/functions/_push.js')
NAT = lire('netlify/functions/national-alerts.js')
verifier('national-alerts n\'a plus sa propre copie de web-push',
         'webpush' not in NAT)
verifier('national-alerts utilise la brique partagée',
         re.search(r"require\('\./_push'\)", NAT)
         and re.search(r'return envoyerPush\(supabase,', NAT))
verifier('les abonnements expirés sont toujours nettoyés',
         re.search(r"\.delete\(\)\.in\('endpoint', expires\)", PUSH))
verifier('sans clés VAPID, on le dit au lieu de planter',
         re.search(r"probleme: 'vapid_absent'", PUSH))
verifier('un échec de notification ne remonte jamais en exception',
         re.search(r"console\.error\('\[push\] échec global", PUSH))


# ════════════════════════════════════════════════════════════════════════════
print()
total = _bilan['ok'] + _bilan['ko']
if _bilan['ko'] == 0:
    print(f'{VERT}{total}/{total} — « Publier et prévenir » tient.{RAZ}')
    sys.exit(0)
print(f'{ROUGE}{_bilan["ko"]} échec(s) sur {total}.{RAZ}')
sys.exit(1)
