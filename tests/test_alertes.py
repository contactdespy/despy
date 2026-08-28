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

import io, json, os, re, subprocess, sys, tempfile, unicodedata, urllib.request

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MODULE = os.path.join(RACINE, 'netlify', 'functions', '_alert-sources.js')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')
UA = 'Despy-Alertes/2.0 (+https://despy.fr)'


def jsc(code):
    """Exécute un bout de JS et renvoie la dernière ligne imprimée."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(code)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=90)
    finally:
        os.unlink(chemin)
    return r


# Ce que jsc n'a pas : fetch, console, AbortSignal, module.
def socle(corpus_json='{}'):
    return """
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
""" % corpus_json


def sources_du_module(src):
    """Demande au module lui-même ses URL, au lieu de les deviner.

    La version précédente les lisait à la regex `url:\\s*'([^']+)'`. Ça marchait
    tant que chaque URL tenait dans une seule chaîne littérale. Les deux flux de
    presse sont construits par concaténation :

        url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(…)

    La regex s'arrêtait donc au premier apostrophe et rendait
    « https://news.google.com/rss/search?q= », qui répond 404. Le banc
    téléchargeait consciencieusement une page d'erreur, la déclarait vide, et
    ne testait EN RIEN les sources de presse — tout en affichant « tout est
    vert ». Un banc qui ne teste pas doit le dire ; celui-ci mentait.

    En interrogeant le module, la question ne se repose plus : si demain une
    URL est construite autrement, le test suit sans qu'on y touche."""
    r = jsc(socle() + '\n' + src + '\n'
            + 'print(JSON.stringify(module.exports.SOURCES.map(function(s){'
            + ' return { nom: s.nom, url: s.url, confiance: s.confiance }; })));')
    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        sys.exit('ERREUR : le module ne se charge pas :\n'
                 + ((r.stderr or '').strip()[:1500] or brut[:1500]))
    return json.loads(brut.splitlines()[-1])


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
    sources = sources_du_module(src)

    print('Flux déclarés dans le module : %d' % len(sources))
    corpus = {}
    joignables = 0
    for s in sources:
        code, xml = telecharger(s['url'])
        corpus[s['url']] = xml
        if code == 200 and xml:
            joignables += 1
        print('  %-22s %-9s %s  %6d octets'
              % (s['nom'][:22], s.get('confiance') or '?', code or 'KO', len(xml)))
    print()

    verif = """
var M = module.exports;
var sortie = { charge: true, fonctions: Object.keys(M) };

// Contrôles unitaires sur les briques délicates.
sortie.decodage = M.decoder("Remboursement d&rsquo;imp&ocirc;t &amp; <b>TVA</b>");

// Google Actualités envoie son résumé en HTML ÉCHAPPÉ. Tant que le décodage
// se faisait en une passe, l'identifiant base64 du lien restait dans le texte
// et le tri y trouvait au hasard des mots interdits. Contrôle direct : il ne
// doit RIEN rester du lien.
sortie.decodage_echappe = M.decoder(
  '&lt;a href="https://news.google.com/rss/articles/CBMi0AFBVV95cUxQYXhwc3BvcnQ' +
  'UFBVV95cUxQ"&gt;Arnaque au faux conseiller bancaire&lt;/a&gt;&nbsp;' +
  '&lt;font color="#6f6f6f"&gt;Actu.fr&lt;/font&gt;');

sortie.accents  = M.aplatir("Hameçonnage ÉLECTRIQUE");
sortie.tri_oui  = M.pertinentPourSenior("Piratage des impôts", "");
sortie.tri_non  = M.pertinentPourSenior("Multiples vulnérabilités dans Zabbix", "");
sortie.tri_corps = M.pertinentPourSenior("Le refus de crédit en questions",
                                         "votre banque peut refuser");

// Le suffixe « - Journal » n'est retiré que s'il correspond vraiment.
sortie.suffixe_oui = M.sansSuffixe("Deux seniors arnaqués - Actu.fr", "Actu.fr");
sortie.suffixe_non = M.sansSuffixe("Arnaque au faux conseiller - mode d'emploi", "Actu.fr");

// Regroupement : deux dépêches sur le même fait ne doivent compter qu'une fois,
// mais deux arnaques différentes ne doivent PAS être confondues.
sortie.histoire_oui = M.memeHistoire(
  "Il perd 24 000 euros après une arnaque au faux conseiller bancaire",
  "Arnaque au faux conseiller : un restaurateur escroqué de 24 000 euros");
sortie.histoire_non = M.memeHistoire(
  "Arnaque au faux conseiller bancaire",
  "Arnaque à la taxe foncière");

// Le montant compte comme signature, l'année NON : sinon tout ce qui porte
// « 2026 » dans son titre serait confondu en un seul article.
sortie.histoire_montant = M.memeHistoire(
  "Il perd 24 000 \u20ac apr\u00e8s une arnaque en ligne",
  "\u00ab Je n\u2019y croyais pas \u00bb : arnaqu\u00e9 de 24 000 euros, ce restaurateur");
sortie.histoire_annee = M.memeHistoire(
  "Foire aux vins de Colmar 2026 : attention aux arnaques",
  "Imp\u00f4ts 2026 : gare au faux courriel de remboursement");

Promise.all([M.collecterAlertes(400), M.collecterPresse(400)])
 .then(function (r) {
  function resumer(liste) {
    return liste.map(function (a) {
      return { titre: a.title, source: a.source, date: a.published,
               url: a.url, confiance: a.confiance,
               resume: (a.body || '').slice(0, 90) };
    });
  }
  sortie.retenues = resumer(r[0]);
  sortie.presse   = resumer(r[1]);
  print(JSON.stringify(sortie));
}).catch(function (e) {
  print(JSON.stringify({ erreur: String(e && e.message || e) }));
});
"""

    r = jsc(socle(json.dumps(corpus)) + '\n' + src + '\n' + verif)
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
    controle('HTML échappé de Google Actualités nettoyé',
             d.get('decodage_echappe'),
             'Arnaque au faux conseiller bancaire Actu.fr')
    controle('accents aplatis', d.get('accents'), 'hameconnage electrique')
    controle('« Piratage des impôts » retenu', d.get('tri_oui'), True)
    controle('bulletin technique écarté', d.get('tri_non'), False)
    controle('mot-clé présent seulement dans le corps → écarté',
             d.get('tri_corps'), False)
    controle('suffixe « - Actu.fr » retiré',
             d.get('suffixe_oui'), 'Deux seniors arnaqués')
    controle('tiret légitime préservé', d.get('suffixe_non'),
             "Arnaque au faux conseiller - mode d'emploi")
    controle('même fait → regroupé', d.get('histoire_oui'), True)
    controle('faits différents → non regroupés', d.get('histoire_non'), False)
    controle('même montant volé → regroupé', d.get('histoire_montant'), True)
    controle('même année ≠ même histoire', d.get('histoire_annee'), False)

    # Toutes les sources doivent répondre. Un 404 silencieux, c'est une source
    # qui meurt sans que personne ne l'apprenne — le défaut d'origine.
    controle('toutes les sources joignables', joignables, len(sources))

    retenues = d.get('retenues', [])
    presse = d.get('presse', [])

    def lister(intitule, liste):
        nonlocal ok
        print()
        print('═' * 74)
        print('%s (%d)' % (intitule, len(liste)))
        print('═' * 74)
        for a in liste:
            print('  %-10s  %s' % ((a.get('date') or '?')[:10], a['titre'][:58]))
            print('              %s' % a['source'])
            if not a.get('url', '').startswith('http'):
                print('              !! URL suspecte : %r' % a.get('url'))
                ok = False
            if not a.get('date'):
                print('              !! date non reconnue')
                ok = False
            # Le résumé ne doit jamais contenir de balise ni d'identifiant de
            # lien : c'est sur lui que le tri travaille.
            r = a.get('resume') or ''
            if '<' in r or 'news.google.com/rss/articles' in r:
                print('              !! résumé pollué : %r' % r[:70])
                ok = False

    lister("ALERTES OFFICIELLES SUR LES FLUX D'AUJOURD'HUI", retenues)

    if not retenues:
        print('  (aucune — vérifier que les flux sont joignables)')
        ok = False

    lister('PRESSE À VALIDER SUR LES FLUX DU JOUR', presse)

    if not presse:
        print('  (aucune — vérifier les flux Google Actualités)')
        ok = False

    print()
    print('═' * 74)
    print('ÉTANCHÉITÉ ENTRE LES DEUX CIRCUITS')
    print('═' * 74)

    # LE contrôle qui compte. `collecterAlertes` alimente les emails envoyés aux
    # clients payants (cyber-alerts.js) et le repli de list-alerts.js quand la
    # table est vide. Si de la presse non validée s'y glissait, elle partirait
    # dans une boîte mail sans que personne ne l'ait lue. La presse est donc un
    # circuit SÉPARÉ, pas un paramètre — et ce test le vérifie plutôt que de
    # faire confiance à la relecture.
    fuite = [a for a in retenues if a.get('confiance') != 'officiel']
    controle('aucune presse dans collecterAlertes', fuite, [])
    controle('la presse est bien étiquetée « presse »',
             sorted(set(a.get('confiance') for a in presse)) or ['presse'],
             ['presse'])

    # La presse locale doit parler du territoire, sinon la contrainte `exige`
    # ne sert à rien (première version : BFM Villejuif et « Plans Thaïlande »).
    locales = [a for a in presse if 'locale' in (a.get('source') or '')]
    TERRITOIRE = ('bas-rhin', 'strasbourg', 'alsace', 'haguenau', 'selestat',
                  'saverne', 'schiltigheim', 'illkirch', 'bischheim', 'obernai',
                  'molsheim', 'wissembourg', 'colmar', 'mulhouse', 'alsacien')
    hors_sol = [a['titre'] for a in locales
                if not any(k in unicodedata.normalize('NFD', a['titre'].lower())
                           .encode('ascii', 'ignore').decode() for k in TERRITOIRE)]
    controle('presse locale : %d titre(s), tous du territoire' % len(locales),
             hors_sol, [])

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
