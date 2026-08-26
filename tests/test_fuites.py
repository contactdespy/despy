#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai de la vérification des fuites de données
#
# L'étape 1 du parcours Protection. Elle cumulait trois pannes silencieuses :
#
#   1. elle appelait une fonction PLANIFIÉE, que Netlify bloque au bord par un
#      403 vide → `r.json()` levait une exception → « Erreur réseau » ;
#   2. l'appli lisait `data.breaches || data.count` quand le serveur renvoyait
#      `breachCount` → toujours 0 → « Aucune fuite connue », y compris pour un
#      membre présent dans quarante fuites. Le pire mensonge possible ici ;
#   3. la branche d'erreur testait `data.unavailable`, un champ que le serveur
#      n'a jamais produit → une panne de HIBP s'affichait aussi en vert.
#
# Aucune des trois ne produisait d'erreur visible. C'est pour ça qu'elles ont
# tenu près de trois mois. On vérifie donc ici, sans réseau :
#   A. le contrat serveur (les noms de champs, des deux côtés) ;
#   B. ce que le membre lit à l'écran dans chaque situation ;
#   C. qu'aucune panne ne peut s'afficher comme une bonne nouvelle.
#
# Usage : python3 tests/test_fuites.py
# ════════════════════════════════════════════

import io, json, os, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
APPLI = os.path.join(RACINE, 'despy_app_v23.html')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

VERT = 'Aucune fuite connue'
PANNE = 'momentanément indisponible'


def extraire_fonction(src, nom):
    """Découpe une fonction du HTML par comptage d'accolades.

    Reprend le `async` qui précède : sans lui, les `await` du corps deviennent
    de simples identifiants et le fichier ne se parse même plus.
    """
    i = src.index('function ' + nom)
    if src[max(0, i - 6):i] == 'async ':
        i -= 6
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


def sans_commentaires(js):
    """Le code seul. Un commentaire qui CITE un ancien champ ne doit pas
    compter comme une lecture de ce champ."""
    return '\n'.join(l for l in js.splitlines()
                     if not l.lstrip().startswith('//'))


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    src_app = io.open(APPLI, encoding='utf-8').read()
    src_srv = io.open(os.path.join(FONCTIONS, '_hibp.js'), encoding='utf-8').read()

    ok = True

    print('═' * 74)
    print('A. LE CONTRAT ENTRE L\'APPLI ET LE SERVEUR')
    print('═' * 74)
    # Les deux moitiés doivent parler des mêmes champs. Si l'une est renommée
    # sans l'autre, la lecture ne casse pas : elle renvoie `undefined`, et
    # `undefined` fuite se lit « aucune fuite ».
    contrat = [
        ('breachCount', 'le nombre de fuites'),
        ('breaches', 'la liste des fuites'),
    ]
    appel = sans_commentaires(extraire_fonction(src_app, 'runDarkWeb'))
    code_srv = sans_commentaires(src_srv)
    for champ, quoi in contrat:
        cote_serveur = ('%s,' % champ) in code_srv or ('%s:' % champ) in code_srv
        cote_appli = ('data.%s' % champ) in appel
        bon = cote_serveur and cote_appli
        ok = ok and bon
        print('  %-5s %-14s %s' % ('OK' if bon else 'ÉCHEC', champ, quoi)
              + ('' if bon else '  — serveur:%s appli:%s' % (cote_serveur, cote_appli)))

    # Un champ jamais produit par le serveur = une branche morte dans l'appli.
    mort = 'data.unavailable' in appel or 'data.count' in appel
    ok = ok and not mort
    print('  %-5s aucune lecture d\'un champ que le serveur ne produit pas'
          % ('ÉCHEC' if mort else 'OK'))

    print()
    print('═' * 74)
    print('B. CE QUE LE MEMBRE LIT À L\'ÉCRAN')
    print('═' * 74)

    harnais = r"""
var ECRAN = {};
var TOASTS = [];
var APPELE = null;
var REPONSE = null;

function escapeHtmlA(s){ return String(s == null ? '' : s); }
function toast(m){ TOASTS.push(m); }
function openSheet(){}
function closeSheet(){}
function openConseiller(){}
var session = { get: function(){ return SESSION; } };
function authHeaders(){ return { 'Authorization': 'Bearer jeton' }; }
var document = { getElementById: function (id) {
  return { set innerHTML(v) { ECRAN[id] = v; }, get innerHTML() { return ECRAN[id] || ''; },
           value: '' };
} };

// Le serveur, tel qu'il répond vraiment. `corps` null = corps illisible
// (c'est exactement ce que renvoie Netlify sur une fonction planifiée : 403
// avec content-length 0).
function fetch(url, opts) {
  APPELE = url;
  return Promise.resolve({
    ok: REPONSE.statut >= 200 && REPONSE.statut < 300,
    status: REPONSE.statut,
    json: function () {
      return REPONSE.corps === null
        ? Promise.reject(new Error('Unexpected end of JSON input'))
        : Promise.resolve(REPONSE.corps);
    }
  });
}
"""

    verif = r"""
var SESSION = { email: 'marie@example.fr', token: 'jeton' };
var res = { cas: [], appele: null, fiche: null };

function cas(nom, reponse) {
  REPONSE = reponse;
  ECRAN = {};
  return runDarkWeb().then(function () {
    var h = ECRAN['hibp-result'] || '';
    res.cas.push({ nom: nom, vert: h.indexOf('Aucune fuite connue') !== -1,
                   panne: h.indexOf('momentanément indisponible') !== -1,
                   compte: (h.match(/dans (\d+) fuite/) || [])[1] || null,
                   nomme: h.indexOf('Adobe') !== -1,
                   annee: h.indexOf('2013') !== -1,
                   vide: h.length < 40 });
  });
}

var TROIS = { breachCount: 3, emailSent: true, breaches: [
  { name: 'Adobe', date: '2013-10-04' },
  { name: 'LinkedIn', date: '2012-05-05' },
  { name: 'Dropbox', date: '2012-07-01' } ] };

Promise.resolve()
  .then(function () { return cas('aucune fuite', { statut: 200, corps: { breachCount: 0, breaches: [], emailSent: false } }); })
  .then(function () { return cas('trois fuites', { statut: 200, corps: TROIS }); })
  .then(function () { return cas('HIBP muet (200 + error)', { statut: 200, corps: { error: 'unavailable', breachCount: null } }); })
  .then(function () { return cas('403 vide (fonction planifiée)', { statut: 403, corps: null }); })
  .then(function () { return cas('session expirée (401)', { statut: 401, corps: { error: 'Session expirée.', code: 'AUTH_REQUIRED' } }); })
  .then(function () {
    res.appele = APPELE;
    // La fiche d'ouverture : l'adresse doit être MONTRÉE, pas saisissable.
    ECRAN = {};
    var capt = null;
    openSheet = function (titre, html) { capt = html; };
    openDarkWeb();
    res.fiche = { html: capt || '', };
    print(JSON.stringify(res));
  })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

    morceaux = [extraire_fonction(src_app, n)
                for n in ('runDarkWeb', 'openDarkWeb', 'dwGesteHtml', 'dwGeste')]

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais + '\n'.join(morceaux) + '\n' + verif)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — l\'outil n\'a pas pu être exécuté :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    d = json.loads(brut.splitlines()[-1])
    if 'erreur' in d:
        print('ÉCHEC : ' + d['erreur'])
        return 1

    # Ce que chaque situation DOIT afficher.
    attendus = {
        'aucune fuite':                 dict(vert=True,  panne=False, compte=None),
        'trois fuites':                 dict(vert=False, panne=False, compte='3'),
        'HIBP muet (200 + error)':      dict(vert=False, panne=True,  compte=None),
        '403 vide (fonction planifiée)': dict(vert=False, panne=True, compte=None),
        'session expirée (401)':        dict(vert=False, panne=True,  compte=None),
    }
    for c in d['cas']:
        a = attendus[c['nom']]
        soucis = []
        if c['vert'] != a['vert']:
            soucis.append('« Aucune fuite connue » %s' % ('manquant' if a['vert'] else 'affiché à tort'))
        if c['panne'] != a['panne']:
            soucis.append('message de panne %s' % ('manquant' if a['panne'] else 'affiché à tort'))
        if c['compte'] != a['compte']:
            soucis.append('compte affiché : %s au lieu de %s' % (c['compte'], a['compte']))
        if c['vide']:
            soucis.append('écran resté vide')
        bon = not soucis
        ok = ok and bon
        print('  %-5s %-32s %s' % ('OK' if bon else 'ÉCHEC', c['nom'],
                                   ' · '.join(soucis) or 'affichage conforme'))

    # Nommer les fuites : « 3 fuites » sans dire lesquelles ne permet aucune
    # action. C'est justement ce que la liste `breaches` apporte.
    trois = next(c for c in d['cas'] if c['nom'] == 'trois fuites')
    bon = trois['nomme'] and trois['annee']
    ok = ok and bon
    print('  %-5s les fuites sont nommées et datées, pas seulement comptées'
          % ('OK' if bon else 'ÉCHEC'))

    print()
    print('═' * 74)
    print('C. L\'ADRESSE VÉRIFIÉE')
    print('═' * 74)
    html = d['fiche']['html']
    libre = 'id="hibp-input"' in html
    montre = 'marie@example.fr' in html
    ok = ok and not libre and montre
    print('  %-5s l\'adresse du compte est affichée' % ('OK' if montre else 'ÉCHEC'))
    print('  %-5s aucun champ libre : on ne peut pas déclencher l\'envoi du'
          % ('ÉCHEC' if libre else 'OK'))
    print('        détail d\'une fuite vers l\'adresse d\'un tiers')

    print()
    print('═' * 74)
    print('D. LA FONCTION APPELÉE')
    print('═' * 74)
    appele = (d['appele'] or '').split('/')[-1]
    from importlib import util as _u
    spec = _u.spec_from_file_location(
        'tfa', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'test_fonctions_appelables.py'))
    tfa = _u.module_from_spec(spec)
    sys.argv = sys.argv[:1]
    spec.loader.exec_module(tfa)
    planifiees = tfa.fonctions_planifiees()
    existe = os.path.exists(os.path.join(FONCTIONS, appele + '.js'))
    bon = existe and appele not in planifiees
    ok = ok and bon
    print('  %-5s %s : %s' % ('OK' if bon else 'ÉCHEC', appele,
                              'existe et n\'est pas planifiée' if bon else
                              ('fichier absent' if not existe else
                               'PLANIFIÉE → 403 au bord, jamais exécutée')))

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
