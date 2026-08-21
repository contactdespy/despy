#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai des alertes nationales
#
# Il n'y a pas de Node sur cette machine, mais macOS embarque JavaScriptCore :
#   /System/Library/Frameworks/JavaScriptCore.framework/.../Helpers/jsc
#
# On s'en sert pour exécuter le VRAI _alert-sources.js — pas une transposition
# qui pourrait diverger du code déployé. Python ne fait que deux choses :
# télécharger les flux réels, et fabriquer un fichier JS autonome contenant
# les quelques éléments que jsc n'a pas (fetch, console, AbortSignal, module).
#
# Ce que ça vérifie :
#   1. le module se charge sans erreur de syntaxe ;
#   2. les parseurs RSS et Atom lisent bien les flux d'aujourd'hui ;
#   3. le tri retient ce qui parle à un senior et écarte le reste ;
#   4. les dates, les accents et les entités HTML sont correctement traités.
#
# Usage : python3 tests/test_alertes.py
# ════════════════════════════════════════════

import io, json, os, re, subprocess, sys, tempfile, urllib.request

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MODULE = os.path.join(RACINE, 'netlify', 'functions', '_alert-sources.js')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')
UA = 'Despy-Alertes/2.0 (+https://despy.fr)'


def sources_du_module(src):
    """Relit la liste des sources dans le JS pour télécharger exactement ce
    que le code ira chercher en production."""
    bloc = re.search(r'const\s+SOURCES\s*=\s*\[(.*?)\n\];', src, re.S)
    if not bloc:
        sys.exit('ERREUR : SOURCES introuvable dans _alert-sources.js')
    # Ne retirer QUE les lignes entièrement commentées : un `//` en milieu de
    # ligne appartient à « https:// ». (Première version de ce test : les URL
    # ressortaient tronquées en « https: ».)
    corps = re.sub(r'(?m)^\s*//.*$', '', bloc.group(1))
    return re.findall(r"url:\s*'([^']+)'", corps)


def telecharger(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except Exception as e:
        print('  !! %s : %s' % (url, e))
        return 0, ''


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    src = io.open(MODULE, encoding='utf-8').read()
    urls = sources_du_module(src)

    print('Flux déclarés dans le module : %d' % len(urls))
    corpus = {}
    for u in urls:
        code, xml = telecharger(u)
        corpus[u] = xml
        print('  %-58s %s  %6d octets' % (u[:58], code or 'KO', len(xml)))
    print()

    # ── Le harnais : ce que jsc n'a pas ────────────────────────────────
    harnais = """
var __CORPUS__ = %s;
var console = { error: function(){}, log: function(){}, warn: function(){} };
var AbortSignal = { timeout: function(){ return null; } };
function fetch(url) {
  var xml = __CORPUS__[url];
  return Promise.resolve({
    ok: typeof xml === 'string' && xml.length > 0,
    status: (typeof xml === 'string' && xml.length) ? 200 : 599,
    text: function(){ return Promise.resolve(xml || ''); }
  });
}
var module = { exports: {} };
var exports = module.exports;
""" % json.dumps(corpus)

    verif = """
var M = module.exports;
var sortie = { charge: true, fonctions: Object.keys(M) };

// Contrôles unitaires sur les briques délicates.
sortie.decodage = M.decoder("Remboursement d&rsquo;imp&ocirc;t &amp; <b>TVA</b>");
sortie.accents  = M.aplatir("Hameçonnage ÉLECTRIQUE");
sortie.tri_oui  = M.pertinentPourSenior("Piratage des impôts", "");
sortie.tri_non  = M.pertinentPourSenior("Multiples vulnérabilités dans Zabbix", "");
sortie.tri_corps = M.pertinentPourSenior("Le refus de crédit en questions",
                                         "votre banque peut refuser");

M.collecterAlertes(400).then(function (liste) {
  sortie.retenues = liste.map(function (a) {
    return { titre: a.title, source: a.source, date: a.published,
             url: a.url, resume: (a.body || '').slice(0, 90) };
  });
  print(JSON.stringify(sortie));
}).catch(function (e) {
  print(JSON.stringify({ erreur: String(e && e.message || e) }));
});
"""

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais + '\n' + src + '\n' + verif)
        chemin = f.name

    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=90)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — le module n\'a pas pu être exécuté :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1

    try:
        d = json.loads(brut.splitlines()[-1])
    except Exception:
        print('Sortie inattendue :\n' + brut[:2000])
        return 1

    if 'erreur' in d:
        print('ÉCHEC pendant la collecte : ' + d['erreur'])
        return 1

    ok = True
    print('═' * 74)
    print('CONTRÔLES UNITAIRES')
    print('═' * 74)

    def controle(intitule, obtenu, attendu):
        nonlocal ok
        bon = obtenu == attendu
        ok = ok and bon
        print('  %-4s %-42s %r' % ('OK' if bon else 'ÉCHEC', intitule, obtenu))
        if not bon:
            print('       attendu : %r' % (attendu,))

    controle('module chargé', d.get('charge'), True)
    controle('entités HTML décodées',
             d.get('decodage'), "Remboursement d’impôt & TVA")
    controle('accents aplatis', d.get('accents'), 'hameconnage electrique')
    controle('« Piratage des impôts » retenu', d.get('tri_oui'), True)
    controle('bulletin technique écarté', d.get('tri_non'), False)
    controle('mot-clé présent seulement dans le corps → écarté',
             d.get('tri_corps'), False)

    retenues = d.get('retenues', [])
    print()
    print('═' * 74)
    print('ALERTES RETENUES SUR LES FLUX D\'AUJOURD\'HUI (%d)' % len(retenues))
    print('═' * 74)
    for a in retenues:
        print('  %-10s  %s' % ((a.get('date') or '?')[:10], a['titre'][:60]))
        print('              %s' % a['source'])
        if not a.get('url', '').startswith('http'):
            print('              !! URL suspecte : %r' % a.get('url'))
            ok = False
        if not a.get('date'):
            print('              !! date non reconnue')
            ok = False

    if not retenues:
        print('  (aucune — vérifier que les flux sont joignables)')
        ok = False

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
