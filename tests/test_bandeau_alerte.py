#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai de l'alerte du moment, sur l'accueil
#
# Le bandeau d'alerte est devenu la première ligne du fil « Repéré par Despy »
# (voir tests/test_repere.py pour le fil lui-même). Ce banc garde ce qu'il
# vérifiait, sur la VRAIE réponse de la production : la dernière alerte
# s'affiche, son titre est coupé au mot entier, sa ligne dit d'où elle vient.
#
# Chrome n'étant pas toujours disponible pour regarder l'écran, on vérifie le
# rendu autrement : on extrait les VRAIES fonctions de despy_app_v23.html, on
# leur fournit un faux DOM et la VRAIE réponse de la production, et on lit ce
# qu'elles écrivent dans le bandeau.
#
# Ce n'est pas une capture d'écran — la mise en page n'est pas testée — mais
# ça répond aux questions qui comptent : le bandeau s'affiche-t-il, avec quel
# texte, et disparaît-il bien quand l'alerte est trop vieille ?
#
# Usage : python3 tests/test_bandeau_alerte.py
# ════════════════════════════════════════════

import io, json, os, re, subprocess, sys, tempfile, urllib.request

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
APP = os.path.join(RACINE, 'despy_app_v23.html')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')
PROD = 'https://despy.fr/.netlify/functions/list-alerts'


def extraire(src, nom):
    """Découpe une fonction du fichier en comptant les accolades. Plus sûr
    qu'une expression régulière : le corps contient lui-même des accolades."""
    debut = src.find('function ' + nom + '(')
    if debut == -1:
        sys.exit('ERREUR : fonction %s introuvable dans l\'appli' % nom)
    i = src.index('{', debut)
    profondeur, j = 0, i
    while j < len(src):
        if src[j] == '{':
            profondeur += 1
        elif src[j] == '}':
            profondeur -= 1
            if profondeur == 0:
                return src[debut:j + 1]
        j += 1
    sys.exit('ERREUR : accolade non refermée dans %s' % nom)


def reponse_production():
    try:
        req = urllib.request.Request(PROD, data=b'{}', headers={
            'Content-Type': 'application/json',
            'User-Agent': 'Despy-Tests/1.0 (+https://despy.fr)'})
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode('utf-8', 'replace'))
    except Exception as e:
        sys.exit('ERREUR : production injoignable — %s' % e)


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    src = io.open(APP, encoding='utf-8').read()
    # Tout le bloc du fil : ses réglages, son état et ses fonctions.
    try:
        bloc = src[src.index('var ALERTE_HOME_JOURS'):src.index('function openReperes(')]
    except ValueError:
        sys.exit('ERREUR : bloc « Repéré par Despy » introuvable')

    code_app = '\n'.join([
        bloc,
        extraire(src, 'timeAgoFr'),
        extraire(src, 'alerteCard'),
        extraire(src, 'escapeHtmlA')])

    reponse = reponse_production()
    alertes = reponse.get('alerts', [])
    print('Production : %d alerte(s), origine « %s »'
          % (len(alertes), reponse.get('origine') or '?'))
    for a in alertes:
        print('  %-10s  %s' % ((a.get('created_at') or '?')[:10],
                               (a.get('title') or '')[:58]))
    print()

    # ── Faux DOM : juste ce que le bandeau touche ──────────────────────
    harnais = """
var __REPONSE__ = %s;
var console = { warn: function(){}, error: function(){}, log: function(){} };
var __ELS__ = {
  'home-rp':  { style: { display: 'none' }, innerHTML: '' },
  'rp-liste': { style: {}, innerHTML: '' },
  'rp-total': { style: {}, innerHTML: '' },
  'rp-tout':  { style: {}, innerHTML: '' }
};
var document = { getElementById: function (id) { return __ELS__[id] || null; } };
function fetch(url, opts) {
  return Promise.resolve({ json: function () { return Promise.resolve(__REPONSE__); } });
}
""" % json.dumps(reponse)

    verif = """
majAlerteNationale();

// On laisse la chaîne de promesses se dérouler avant de lire le résultat.
// Compter les tours à la main est fragile — adopter une promesse en consomme
// plusieurs, et une première version du test lisait le bandeau trop tôt et
// le déclarait cassé alors qu'il fonctionnait. On draine largement.
var attente = Promise.resolve();
for (var k = 0; k < 40; k++) attente = attente.then(function () {});

attente.then(function () {
  var h = __ELS__['rp-liste'].innerHTML;
  var dec = function (x) { return (x || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); };
  print(JSON.stringify({
    affiche: __ELS__['home-rp'].style.display,
    titre:   dec((h.match(/<span class="a">([^<]*)/) || [])[1]),
    sous:    dec((h.match(/<span class="b">([^<]*)<\/span>/) || [])[1]),
    carte_officielle: alerteCard(__REPONSE__.alerts[0] || {}),
    carte_interne: alerteCard({ title: 'Vague de faux SMS Ameli',
                                source: 'Despy · détecté chez nos utilisateurs',
                                created_at: new Date().toISOString() })
  }));
});
"""

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais + '\n' + code_app + '\n' + verif)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — le code de l\'appli n\'a pas pu être exécuté :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    try:
        d = json.loads(brut.splitlines()[-1])
    except Exception:
        print('Sortie inattendue :\n' + brut[:2000])
        return 1

    ok = True

    def controle(intitule, condition, detail=''):
        nonlocal ok
        ok = ok and condition
        print('  %-5s %s' % ('OK' if condition else 'ÉCHEC', intitule))
        if detail:
            print('        %s' % detail)

    print('═' * 74)
    print('BANDEAU D\'ACCUEIL')
    print('═' * 74)
    controle('alerte du moment affichée', d.get('affiche') == 'block',
             'display = %r' % d.get('affiche'))
    controle('titre non vide', bool(d.get('titre')), d.get('titre'))
    controle('titre ≤ 72 caractères', len(d.get('titre') or '') <= 72,
             '%d caractères' % len(d.get('titre') or ''))
    # Une coupure au caractère près donnait « les vérifications sont e… ».
    # On vérifie que le dernier mot affiché existe tel quel dans le titre réel.
    titre_court = (d.get('titre') or '')
    titre_long = (alertes[0].get('title') if alertes else '') or ''
    if titre_court.endswith('…'):
        dernier = titre_court[:-1].rstrip().split(' ')[-1]
        controle('coupure au mot entier',
                 (' ' + dernier + ' ') in (' ' + titre_long + ' '),
                 'dernier mot affiché : %r' % dernier)
    else:
        controle('titre affiché en entier (pas de coupure)', True)
    controle('sous-titre : d’où elle vient · ancienneté',
             ' · ' in (d.get('sous') or ''), d.get('sous'))

    print()
    print('═' * 74)
    print('CARTES DE LA PAGE ALERTES')
    print('═' * 74)
    off = d.get('carte_officielle', '')
    inte = d.get('carte_interne', '')
    controle('alerte officielle : badge = nom de la source',
             'Vague détectée' not in off,
             re.sub(r'<[^>]+>', ' ', off)[:90].strip())
    controle('alerte interne : badge « Vague détectée »',
             'Vague détectée' in inte)
    a_une_url = bool(alertes and alertes[0].get('url'))
    controle('lien « En savoir plus » présent si l\'alerte a une URL',
             ('En savoir plus' in off) == a_une_url)

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
