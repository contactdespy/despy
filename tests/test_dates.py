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

import datetime, io, json, os, re, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

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


SIMULATION = r"""
var MOISN = {'janvier':1,'février':2,'mars':3,'avril':4,'mai':5,'juin':6,
             'juillet':7,'août':8,'septembre':9,'octobre':10,'novembre':11,
             'décembre':12};
// Liste de référence recopiée À LA MAIN (service-public.fr, régime
// Alsace-Moselle : Vendredi saint et 26 décembre en plus). La recalculer avec
// la formule qu'on teste ne vérifierait rigoureusement rien.
var FERIES = {
 2026: ['1-1','4-3','4-6','5-1','5-8','5-14','5-25','7-14','8-15','11-1','11-11','12-25','12-26'],
 2027: ['1-1','3-26','3-29','5-1','5-6','5-8','5-17','7-14','8-15','11-1','11-11','12-25','12-26'] };
var pb = [], ecarts = {}, n = 0;
for (var i = 0; i < 400; i++) {
  // Des dates construites jour par jour, JAMAIS par ajout de millisecondes :
  // au passage à l'heure d'hiver, 86 400 000 ms ne font plus une journée et
  // la première version de ce banc a accusé la page à tort pendant 130 jours.
  var jour = new Date(2026, 7, 27 + i);
  JOUR = jour; POSE = []; run(); n++;
  var t = POSE[0] || '';
  var m = t.match(/^dès le \w+ (\d{1,2})(?:er)? (\S+)$/);
  if (!m) { pb.push(jour.toDateString() + ' : texte illisible « ' + t + ' »'); continue; }
  var J = parseInt(m[1], 10), M = MOISN[m[2]];
  if (!M) { pb.push(jour.toDateString() + ' : mois inconnu « ' + t + ' »'); continue; }
  var an = (M < jour.getMonth() + 1) ? jour.getFullYear() + 1 : jour.getFullYear();
  if ((FERIES[an] || []).indexOf(M + '-' + J) !== -1)
    pb.push('FÉRIÉ ANNONCÉ : ' + jour.toDateString() + ' → ' + t);
  var ecart = Math.round((new Date(an, M - 1, J) - jour) / 86400000);
  ecarts[ecart] = (ecarts[ecart] || 0) + 1;
  if (ecart < 3 || ecart > 6)
    pb.push('délai de ' + ecart + ' j : ' + jour.toDateString() + ' → ' + t);
}
print(JSON.stringify({ n: n, pb: pb.slice(0, 8), total: pb.length, ecarts: ecarts }));
"""


def simuler_creneau():
    """Rejoue le script de la page sur 400 jours consécutifs.

    Une date calculée ne peut pas être relue à l'œil : elle est juste
    aujourd'hui et fausse dans trois mois, exactement comme la date figée
    qu'elle remplace. La seule vérification qui vaille est de faire défiler le
    calendrier."""
    page = os.path.join(RACINE, 'visite-domicile.html')
    src = io.open(page, encoding='utf-8').read()
    m = re.search(r'<script>\n(/\* ── La prochaine.*?)</script>', src, re.S)
    if not m:
        print('  ÉCHEC le script de calcul du créneau est introuvable dans '
              'visite-domicile.html')
        return False
    corps = (m.group(1)
             .replace('(function () {', 'var JOUR; var POSE=[]; function run() {')
             .replace('})();', '}')
             .replace('var d = new Date();',
                      'var d = new Date(JOUR.getFullYear(), JOUR.getMonth(), JOUR.getDate());'))
    harnais = ('var document={querySelectorAll:function(){'
               'return [{set textContent(v){POSE.push(v)}}];}};\n')

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais + corps + SIMULATION)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('  ÉCHEC le script de la page n\'a pas pu être exécuté :')
        print('        ' + ((r.stderr or '').strip()[:400] or brut[:400]))
        return False
    d = json.loads(brut.splitlines()[-1])

    if d['total']:
        print('  ÉCHEC %d jour(s) sur %d produisent une annonce fautive'
              % (d['total'], d['n']))
        for l in d['pb']:
            print('        %s' % l)
        return False
    delais = '  ·  '.join('%s j ×%d' % (k, v)
                          for k, v in sorted(d['ecarts'].items(), key=lambda x: int(x[0])))
    print('  OK    %d jours simulés : jamais un férié, jamais un texte cassé' % d['n'])
    print('        délais annoncés : %s' % delais)
    return True


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

    ok = not fautes

    print()
    print('═' * 74)
    print('LA DATE QUE LA PAGE DE PUB CALCULE ELLE-MÊME')
    print('═' * 74)
    ok = simuler_creneau() and ok

    print()
    print('RÉSULTAT : ' + ('rien de périmé à l\'affiche.' if ok
                           else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
