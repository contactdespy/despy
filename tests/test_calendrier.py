#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du calendrier des arnaques de saison
#
# Ce calendrier a une particularité dangereuse : il fonctionne tout seul,
# sans source à interroger. Rien ne peut donc échouer bruyamment. Une fenêtre
# mal écrite ne provoque aucune erreur — elle produit juste un silence, et un
# silence ressemble exactement à une année sans arnaque de saison.
#
# On vérifie donc, sans réseau et sans base :
#   A. le contenu : longueurs, fenêtres valides, couverture de l'année ;
#   B. le comportement : dédoublonnage, panne de base, une fiche à la fois ;
#   C. l'affichage : le badge ne doit PAS dire « Vague détectée ».
#
# Usage : python3 tests/test_calendrier.py
# ════════════════════════════════════════════

import io, json, os, re, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
APPLI = os.path.join(RACINE, 'despy_app_v23.html')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

# Le bandeau d'accueil coupe au-delà de 72 caractères ; au-delà de ~300, le
# corps est tronqué dans une notification push et la dernière phrase — celle
# qui dit quoi faire — saute.
TITRE_MAX = 72
CORPS_MAX = 320


def extraire_fonction(src, nom):
    """Découpe une fonction du HTML par comptage d'accolades."""
    i = src.index('function ' + nom)
    j = src.index('{', i)
    p = 0
    for k in range(j, len(src)):
        if src[k] == '{':
            p += 1
        elif src[k] == '}':
            p -= 1
            if p == 0:
                return src[i:k + 1]
    raise ValueError('fonction %s non refermée' % nom)


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    src_cal = io.open(os.path.join(FONCTIONS, '_calendrier-arnaques.js'),
                      encoding='utf-8').read()
    src_app = io.open(APPLI, encoding='utf-8').read()
    carte = extraire_fonction(src_app, 'alerteCard')

    harnais = """
var module = { exports: {} }; var exports = module.exports;
var console = { error: function(){}, log: function(){}, warn: function(){} };
function escapeHtmlA(s){ return String(s == null ? '' : s); }
function timeAgoFr(){ return 'à l\\'instant'; }
var document = { getElementById: function(){ return null; } };

// Une base factice : on lui dit à l'avance quels titres existent déjà, ou
// qu'elle est en panne. Aucun réseau, aucun Supabase.
function faireBase(titresConnus, panne) {
  return { from: function () {
    var f = { _titre: null };
    f.select = function () { return f; };
    f.eq = function (col, v) { if (col === 'title') f._titre = v; return f; };
    f.gte = function () { return f; };
    f.limit = function () {
      if (panne) return Promise.resolve({ data: null, error: { message: 'connexion refusée' } });
      var vu = titresConnus.indexOf(f._titre) !== -1;
      return Promise.resolve({ data: vu ? [{ id: 1 }] : [], error: null });
    };
    return f;
  } };
}
"""

    verif = """
var C = module.exports;
var res = { fiches: [], jours: [], cas: [], badges: [] };

C.FICHES.forEach(function (f) {
  // Les sites nommés dans le texte : si on écrit « allez sur caf.fr », le
  // bouton doit mener à caf.fr et nulle part ailleurs.
  var doms = f.corps.match(/[a-z0-9-]+\\.(?:gouv\\.fr|fr)\\b/gi) || [];
  res.fiches.push({ id: f.id, titre: f.titre, lt: f.titre.length,
                    lc: f.corps.length, debut: f.debut, fin: f.fin,
                    lien: f.lien || null, doms: doms });
});

// Couverture : un jour sans fiche est un jour où l'appli n'a rien à dire.
for (var m = 1; m <= 12; m++) {
  for (var j = 1; j <= 28; j++) {
    var d = new Date(Date.UTC(2026, m - 1, j, 12));
    res.jours.push({ d: (m < 10 ? '0' : '') + m + '-' + (j < 10 ? '0' : '') + j,
                     n: C.fichesActives(d).length });
  }
}

// La fenêtre de Noël enjambe le 31 décembre : au 3 janvier elle doit encore
// être active, sinon elle s'éteint pile pendant les fêtes.
var noel3janv = C.fichesActives(new Date(Date.UTC(2027, 0, 3, 12)))
  .filter(function (x) { return x.fiche.id === 'noel-dons'; }).length;

function essai(nom, base, quand, attendu) {
  return C.fichesAPublier(base, quand).then(function (out) {
    res.cas.push({ nom: nom, n: out.length, titre: out.length ? out[0].title : null,
                   source: out.length ? out[0].source : null, attendu: attendu });
  });
}

var LE_24_AOUT = new Date(Date.UTC(2026, 7, 24, 9));
var TOUS = C.FICHES.map(function (f) { return f.titre; });

// Le badge : la fiche vient de nous, mais elle ne décrit PAS une vague.
['Despy · Anticipation', 'Despy Community', 'CNIL · officiel'].forEach(function (s) {
  var html = alerteCard({ title: 'Un titre', body: 'Un corps', source: s,
                          created_at: new Date().toISOString() });
  res.badges.push({ source: s,
                    vague: html.indexOf('Vague détectée') !== -1,
                    saison: html.indexOf('Arnaque de saison') !== -1 });
});

Promise.resolve()
  .then(function () { return essai('base vierge → 1 fiche', faireBase([], false), LE_24_AOUT, 1); })
  .then(function () { return essai('la 1re déjà publiée → la suivante', faireBase(['Rentrée : le faux SMS de la CAF qui promet la prime'], false), LE_24_AOUT, 1); })
  .then(function () { return essai('toutes publiées → silence', faireBase(TOUS, false), LE_24_AOUT, 0); })
  .then(function () { return essai('base en panne → silence', faireBase([], true), LE_24_AOUT, 0); })
  .then(function () {
    res.noel3janv = noel3janv;
    print(JSON.stringify(res));
  })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais + src_cal + '\n' + carte + '\n' + verif)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — le calendrier n\'a pas pu être exécuté :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    d = json.loads(brut.splitlines()[-1])
    if 'erreur' in d:
        print('ÉCHEC : ' + d['erreur'])
        return 1

    ok = True

    print('═' * 74)
    print('A. LES FICHES (%d)' % len(d['fiches']))
    print('═' * 74)
    for f in d['fiches']:
        soucis = []
        if f['lt'] > TITRE_MAX:
            soucis.append('titre %d > %d' % (f['lt'], TITRE_MAX))
        if f['lc'] > CORPS_MAX:
            soucis.append('corps %d > %d' % (f['lc'], CORPS_MAX))
        if not re.match(r'^\d{2}-\d{2}$', f['debut']) or not re.match(r'^\d{2}-\d{2}$', f['fin']):
            soucis.append('fenêtre illisible')
        # Le bouton doit faire ce que la phrase promet, sinon on enseigne
        # exactement le geste qu'on passe notre temps à déconseiller.
        if f['doms']:
            if not f['lien']:
                soucis.append('cite %s mais n\'y mène pas' % f['doms'][0])
            elif not any(dom.lower() in f['lien'].lower() for dom in f['doms']):
                soucis.append('cite %s mais mène à %s' % (f['doms'][0], f['lien']))
        if f['lien'] and not f['lien'].startswith('https://'):
            soucis.append('lien non chiffré')
        bon = not soucis
        ok = ok and bon
        print('  %-5s %s → %s  %s' % ('OK' if bon else 'ÉCHEC', f['debut'], f['fin'],
                                      f['titre'][:52]))
        if soucis:
            print('        %s' % ' · '.join(soucis))

    print()
    print('═' * 74)
    print('B. COUVERTURE DE L\'ANNÉE')
    print('═' * 74)
    trous = [j['d'] for j in d['jours'] if j['n'] == 0]
    if trous:
        print('  %d jour(s) sans aucune fiche — l\'appli n\'aurait rien à dire :' % len(trous))
        print('        %s' % ', '.join(trous[:18]) + ('…' if len(trous) > 18 else ''))
        ok = False
    else:
        print('  OK    chaque jour de l\'année est couvert par au moins une fiche')
    charge = max(j['n'] for j in d['jours'])
    print('        au plus %d fiche(s) actives en même temps' % charge)
    print('  %-5s la fenêtre de Noël tient encore le 3 janvier'
          % ('OK' if d['noel3janv'] == 1 else 'ÉCHEC'))
    ok = ok and d['noel3janv'] == 1

    print()
    print('═' * 74)
    print('C. COMPORTEMENT')
    print('═' * 74)
    for c in d['cas']:
        bon = c['n'] == c['attendu']
        ok = ok and bon
        print('  %-5s %-38s %s' % ('OK' if bon else 'ÉCHEC', c['nom'],
                                   c['titre'][:34] if c['titre'] else 'silence'))

    print()
    print('═' * 74)
    print('D. AFFICHAGE DANS L\'APPLI')
    print('═' * 74)
    for b in d['badges']:
        if 'Anticipation' in b['source']:
            bon = b['saison'] and not b['vague']
            attendu = 'Arnaque de saison'
        elif 'Despy' in b['source']:
            bon = b['vague']
            attendu = 'Vague détectée'
        else:
            bon = not b['vague'] and not b['saison']
            attendu = 'nom de la source'
        ok = ok and bon
        print('  %-5s %-24s → %s' % ('OK' if bon else 'ÉCHEC', b['source'], attendu))

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
