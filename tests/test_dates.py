#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Aucune page publique n'annonce une date passée
#
# La page où atterrissent les publicités Meta a affiché « Disponible à partir
# du jeudi 23 juillet » pendant plus d'un mois APRÈS le 23 juillet. Écrit un
# jour où c'était vrai, jamais relu ensuite. Un prospect qui paie un clic pour
# arriver là lit une date passée et en conclut que le service s'est arrêté.
#
# Rien ne pouvait le signaler : la page se chargeait parfaitement, aucune
# erreur nulle part. C'est la même famille que les autres pannes silencieuses
# du service — du contenu qui cesse d'être vrai sans cesser de fonctionner.
# Le seul contrôle qui l'attrape, c'est de comparer ce qui est écrit à la date
# du jour. Personne ne le fait à la main toutes les semaines ; une machine, si.
#
# Ce banc lit les pages publiques, repère les dates en toutes lettres, et
# refuse celles qui sont derrière nous.
#
# Usage : python3 tests/test_dates.py
# ════════════════════════════════════════════

import datetime, io, os, re, sys

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

MOIS = {'janvier': 1, 'février': 2, 'fevrier': 2, 'mars': 3, 'avril': 4,
        'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8, 'aout': 8,
        'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12,
        'decembre': 12}

# « 23 juillet », « 1er octobre 2026 », « jeudi 3 septembre »
MOTIF = re.compile(
    r'(\d{1,2})\s*(?:er)?\s+(%s)\s*(\d{4})?' % '|'.join(MOIS), re.I)

# Les pages sont DÉCOUVERTES, pas listées. Une liste écrite à la main se
# périme exactement comme la date qu'elle surveille : la première version de
# ce banc citait une page qui n'existe pas et en oubliait deux qui existent.
# Une page d'atterrissage créée demain sera couverte sans que personne y pense.
HORS_SUJET = {
    'despy_app_v23.html',   # l'appli membre : ses dates viennent de la base
    'admin.html',           # console interne, aucun prospect ne la voit
    '_mail_preview.html',   # outil de développement
}


def pages_publiques(racine):
    return sorted(f for f in os.listdir(racine)
                  if f.endswith('.html')
                  and f not in HORS_SUJET
                  and not f.startswith('google'))  # vérification de propriété

# Une date peut être passée à bon droit : « supprimé le 14 mars », « fondée en
# 2019 », un article de loi. Ce qui n'a pas le droit de l'être, c'est une
# PROMESSE — ce qui est annoncé comme à venir.
PROMESSE = re.compile(
    r'à partir du|dès le|disponible|prochaine?s?\s|créneaux?|rendez-vous '
    r'du|jusqu\'au|prévue? le|réserv', re.I)


def sans_commentaires(texte):
    """Neutralise les commentaires, en gardant les numéros de ligne intacts.

    Un commentaire qui CITE une ancienne date — « annonçait le 15 avril » —
    n'est pas une promesse faite au visiteur : il ne s'affiche nulle part.
    Sans ce filtre, le banc rougirait sur l'explication du correctif, et le
    plus sûr moyen de le faire taire serait d'effacer l'explication."""
    def blanchir(m):
        return re.sub(r'[^\n]', ' ', m.group(0))
    texte = re.sub(r'<!--.*?-->', blanchir, texte, flags=re.S)
    texte = re.sub(r'/\*.*?\*/', blanchir, texte, flags=re.S)
    return texte


def main():
    aujourdhui = datetime.date.today()
    print('═' * 74)
    print('LES DATES ANNONCÉES AUX PROSPECTS  (nous sommes le %s)'
          % aujourdhui.strftime('%d/%m/%Y'))
    print('═' * 74)

    fautes = []
    examinees = 0
    pages = pages_publiques(RACINE)
    for page in pages:
        chemin = os.path.join(RACINE, page)
        lignes = sans_commentaires(
            io.open(chemin, encoding='utf-8').read()).splitlines()
        for i, ligne in enumerate(lignes):
            if ligne.lstrip().startswith('//') or ligne.lstrip().startswith('*'):
                continue
            for m in MOTIF.finditer(ligne):
                jour, mois, annee = int(m.group(1)), MOIS[m.group(2).lower()], m.group(3)
                # Sans année écrite, on lit la date comme le ferait un
                # visiteur : celle de cette année.
                try:
                    d = datetime.date(int(annee) if annee else aujourdhui.year,
                                      mois, jour)
                except ValueError:
                    continue
                examinees += 1
                if d >= aujourdhui:
                    continue
                # Une date passée sans promesse autour = un fait historique.
                contexte = ligne[max(0, m.start() - 90):m.end() + 40]
                if not PROMESSE.search(contexte):
                    continue
                fautes.append((page, i + 1, d, contexte.strip()[:74]))

    # Les pages sont nommées : c'est ce qui permet de voir d'un coup d'œil
    # qu'une nouvelle page d'atterrissage est bien surveillée — ou qu'elle a
    # atterri dans les exclusions par mégarde.
    print('  %d date(s) en toutes lettres examinée(s) dans %d page(s) :'
          % (examinees, len(pages)))
    print('  %s' % ', '.join(p[:-5] for p in pages))
    print()
    if not fautes:
        print('  OK    aucune promesse ne porte une date déjà passée')
    for page, n, d, ctx in fautes:
        print('  ÉCHEC %s ligne %d — %s est passé' % (page, n, d.strftime('%d/%m/%Y')))
        print('        « %s »' % ctx)

    print()
    print('RÉSULTAT : ' + ('rien de périmé à l\'affiche.' if not fautes
                           else 'au moins une page annonce une date passée.'))
    return 0 if not fautes else 1


if __name__ == '__main__':
    sys.exit(main())
