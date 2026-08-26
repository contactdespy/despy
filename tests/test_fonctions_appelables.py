#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Les fonctions appelées par les pages existent-elles vraiment ?
#
# Ce banc est né d'une panne qui a duré près de trois mois sans qu'aucun signal
# ne l'annonce. Le bouton « Vérifier mon email » de l'appli — première étape du
# parcours Protection, argument de vente de l'abonnement — appelait
# `hibp-check`, une fonction déclarée avec un `schedule` dans netlify.toml.
#
# Or Netlify REFUSE au bord tout appel HTTP vers une fonction planifiée : il
# répond 403 avec un corps vide, sans jamais exécuter notre code. Donc :
#   • aucun log côté serveur, puisque le serveur n'a rien exécuté ;
#   • aucune erreur côté client autre qu'un « Erreur réseau » générique ;
#   • et le code de la fonction, lui, était parfaitement correct — le lire
#     cent fois n'aurait rien révélé.
#
# On vérifie donc, sans réseau, trois choses sur chaque `fetch` vers une
# fonction Netlify écrit dans une page :
#   A. la fonction existe (sinon 404 silencieux) ;
#   B. elle n'est pas planifiée (sinon 403 au bord, invisible) ;
#   C. ce n'est pas un module partagé `_xxx` (jamais un endpoint).
#
# Usage : python3 tests/test_fonctions_appelables.py
# ════════════════════════════════════════════

import io, os, re, sys

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')

# Les pages servies au navigateur. Tout ce qui est en .html à la racine est
# public (netlify.toml publie le dépôt entier) : on les prend toutes, plutôt
# qu'une liste à tenir à jour et qui se périmerait au premier fichier ajouté.
def pages_html():
    return sorted(f for f in os.listdir(RACINE)
                  if f.endswith('.html') and not f.startswith('_'))


def fonctions_planifiees():
    """Les noms déclarés `[functions.X] schedule = …` dans netlify.toml,
    en ignorant les blocs mis en commentaire."""
    toml = io.open(os.path.join(RACINE, 'netlify.toml'), encoding='utf-8').read()
    planifiees, courante = set(), None
    for ligne in toml.splitlines():
        nue = ligne.strip()
        if nue.startswith('#'):
            continue
        m = re.match(r'^\[functions\.([A-Za-z0-9_-]+)\]', nue)
        if m:
            courante = m.group(1)
            continue
        if nue.startswith('['):
            courante = None
            continue
        if courante and re.match(r'^schedule\s*=', nue):
            planifiees.add(courante)
            courante = None
    return planifiees


def appels(page):
    """Chaque `/.netlify/functions/NOM` cité dans la page, avec sa ligne."""
    src = io.open(os.path.join(RACINE, page), encoding='utf-8').read()
    trouves = []
    for i, ligne in enumerate(src.splitlines(), 1):
        for nom in re.findall(r'/\.netlify/functions/([A-Za-z0-9_-]+)', ligne):
            trouves.append((nom, i))
    return trouves


def main():
    planifiees = fonctions_planifiees()
    existantes = set(f[:-3] for f in os.listdir(FONCTIONS) if f.endswith('.js'))

    print('═' * 74)
    print('A. CE QUE NETLIFY.TOML PLANIFIE (%d fonctions)' % len(planifiees))
    print('═' * 74)
    print('        %s' % ', '.join(sorted(planifiees)))
    orphelines = sorted(planifiees - existantes)
    if orphelines:
        print('  ÉCHEC un cron est planifié sur une fonction absente : %s'
              % ', '.join(orphelines))
    ok = not orphelines

    print()
    print('═' * 74)
    print('B. CE QUE LES PAGES APPELLENT')
    print('═' * 74)

    total = 0
    for page in pages_html():
        liste = appels(page)
        if not liste:
            continue
        soucis = []
        vus = set()
        for nom, ligne in liste:
            total += 1
            if nom in vus:
                continue
            vus.add(nom)
            if nom.startswith('_'):
                soucis.append((nom, ligne, 'module partagé, pas un endpoint'))
            elif nom not in existantes:
                soucis.append((nom, ligne, 'aucun fichier %s.js' % nom))
            elif nom in planifiees:
                soucis.append((nom, ligne,
                               'fonction PLANIFIÉE → Netlify répond 403 au bord'))
        ok = ok and not soucis
        print('  %-5s %-30s %d appel(s), %d fonction(s)'
              % ('OK' if not soucis else 'ÉCHEC', page, len(liste), len(vus)))
        for nom, ligne, quoi in soucis:
            print('        ligne %-6d %s : %s' % (ligne, nom, quoi))

    print('        %d appels examinés au total' % total)

    print()
    print('═' * 74)
    print('C. LES DEUX MODES NE PEUVENT PAS COHABITER')
    print('═' * 74)
    # Une fonction planifiée qui contient un bloc « appel manuel » authentifié
    # entretient l'illusion d'un endpoint accessible. Le code est mort : il
    # vaut mieux qu'il n'existe pas plutôt qu'il rassure à tort.
    doubles = []
    for nom in sorted(planifiees & existantes):
        src = io.open(os.path.join(FONCTIONS, nom + '.js'), encoding='utf-8').read()
        if 'requireAuth' in src:
            doubles.append(nom)
    if doubles:
        print('  ÉCHEC %s contien(nen)t un bloc authentifié inatteignable :'
              % ', '.join(doubles))
        print('        Netlify bloque l\'appel HTTP avant d\'exécuter le code.')
        print('        Déplacer ce bloc dans une fonction SANS `schedule`.')
        ok = False
    else:
        print('  OK    aucune fonction planifiée ne prétend servir un appel client')

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
