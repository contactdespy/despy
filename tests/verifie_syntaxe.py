#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Contrôle de syntaxe JavaScript sans Node
#
# Pas de Node sur la machine, mais macOS fournit JavaScriptCore. On demande au
# moteur de COMPILER chaque fichier sans l'exécuter (new Function(src)) : une
# accolade oubliée ou une virgule en trop est détectée avant le déploiement.
#
# Compile aussi les blocs <script> des pages HTML, où une erreur casse tout le
# fichier d'un coup — et donc l'application entière.
#
# Usage : python3 tests/verifie_syntaxe.py [fichier ...]
#         (sans argument : les fichiers JS/HTML modifiés selon git)
# ════════════════════════════════════════════

import io, json, os, re, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')


def modifies_par_git():
    r = subprocess.run(['git', '-C', RACINE, 'status', '--porcelain'],
                       capture_output=True, text=True)
    out = []
    for ligne in r.stdout.splitlines():
        chemin = ligne[3:].strip().strip('"')
        if chemin.endswith('.js') or chemin.endswith('.html'):
            complet = os.path.join(RACINE, chemin)
            if os.path.exists(complet):
                out.append(complet)
    return out


def morceaux(chemin):
    """Renvoie [(intitulé, code)] à compiler pour ce fichier."""
    src = io.open(chemin, encoding='utf-8', errors='replace').read()
    nom = os.path.relpath(chemin, RACINE)
    if chemin.endswith('.js'):
        return [(nom, src)]

    out = []
    for i, m in enumerate(re.finditer(
            r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', src, re.S | re.I), 1):
        # Sauter les blocs qui ne sont pas du JavaScript (JSON-LD, templates).
        entete = m.group(0)[:200]
        if re.search(r'type=["\'](?!text/javascript|application/javascript)', entete, re.I):
            continue
        code = m.group(1)
        if code.strip():
            ligne = src[:m.start()].count('\n') + 1
            out.append(('%s <script> #%d (ligne %d)' % (nom, i, ligne), code))
    return out


def compile_ok(code):
    """True si le moteur accepte de compiler. N'exécute rien."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        # Le code est passé en littéral JSON : aucun risque d'échappement.
        f.write('var src = ' + json.dumps(code) + ';\n')
        f.write('try { new Function(src); print("OK"); }\n')
        f.write('catch (e) { print("ERREUR: " + (e && e.message)); }\n')
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)
    sortie = (r.stdout or '').strip()
    if sortie == 'OK':
        return True, ''
    return False, sortie or (r.stderr or '').strip()[:400]


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable.')

    cibles = [os.path.abspath(a) for a in sys.argv[1:]] or modifies_par_git()
    if not cibles:
        print('Rien à vérifier.')
        return 0

    total, echecs = 0, 0
    for chemin in cibles:
        for intitule, code in morceaux(chemin):
            total += 1
            bon, detail = compile_ok(code)
            print('  %-6s %s' % ('OK' if bon else 'ÉCHEC', intitule))
            if not bon:
                echecs += 1
                print('         %s' % detail)

    print('\n%d bloc(s) compilé(s), %d échec(s).' % (total, echecs))
    return 1 if echecs else 0


if __name__ == '__main__':
    sys.exit(main())
