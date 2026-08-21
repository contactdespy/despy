#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai de la sentinelle
#
# Une sentinelle qu'on n'a jamais mise à l'épreuve ne vaut rien : elle se
# contente de ne rien dire, ce qui est exactement ce qu'elle ferait si elle
# était cassée. On lui présente donc des pannes inventées et on vérifie
# qu'elle crie — et, tout aussi important, qu'elle se tait quand tout va bien.
#
# Deux parties :
#   A. ce que la sentinelle voit AUJOURD'HUI sur les vrais flux ;
#   B. neuf situations fabriquées : source morte, format changé, base muette…
#
# Usage : python3 tests/test_sentinelle.py
# ════════════════════════════════════════════

import io, json, os, subprocess, sys, tempfile, urllib.request

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')
UA = 'Despy-Alertes/2.0 (+https://despy.fr)'


def telecharger(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read().decode('utf-8', 'replace')
    except Exception as e:
        print('  !! %s : %s' % (url, e))
        return ''


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    src_sources = io.open(os.path.join(FONCTIONS, '_alert-sources.js'),
                          encoding='utf-8').read()
    src_sentinelle = io.open(os.path.join(FONCTIONS, 'sentinelle-alertes.js'),
                             encoding='utf-8').read()

    # Les vrais flux, pour la partie A.
    import re
    urls = re.findall(r"url:\s*'([^']+)'",
                      re.sub(r'(?m)^\s*//.*$', '', src_sources))
    corpus = {u: telecharger(u) for u in urls}

    harnais = """
var __CORPUS__ = %s;
var console = { error: function(){}, log: function(){}, warn: function(){} };
var AbortSignal = { timeout: function(){ return null; } };
var process = { env: {} };
function fetch(url) {
  var xml = __CORPUS__[url];
  var vivant = typeof xml === 'string' && xml.length > 0;
  return Promise.resolve({
    ok: vivant, status: vivant ? 200 : 599,
    text: function(){ return Promise.resolve(xml || ''); }
  });
}
// Chaque fichier reçoit sa propre portée, comme le fait Node. Sans ça, tout
// se retrouve dans le même espace de noms : la sentinelle déclare
// `const { diagnostiquer } = require(...)` alors que le module a déjà une
// fonction du même nom, et le moteur refuse de charger quoi que ce soit.
var ALERTES = null;
function require(nom) {
  if (nom === './_alert-sources') return ALERTES;
  if (nom === '@supabase/supabase-js') return { createClient: function(){ return null; } };
  if (nom === './_is-scheduled') return { isScheduled: function(){ return true; },
                                          notScheduled: function(){ return {}; } };
  throw new Error('require inattendu : ' + nom);
}
""" % json.dumps(corpus)

    def enveloppe(src):
        return ('(function () {\n  var module = { exports: {} };\n'
                '  var exports = module.exports;\n' + src
                + '\n  return module.exports;\n})()')

    verif = """
var JOUR = 86400000;
function ilYA(j) { return new Date(Date.now() - j * JOUR).toISOString(); }
function ligne(created) { return [{ created_at: created, title: 'Une alerte' }]; }

// Un état de santé « tout va bien », que chaque cas vient abîmer d'une façon.
function sain() {
  return [
    { nom: 'CNIL', url: 'u1', http: 200, entrees: 30, retenues: 3, erreur: null },
    { nom: 'Cybermalveillance', url: 'u2', http: 200, entrees: 20, retenues: 2, erreur: null },
    { nom: 'ANSSI', url: 'u3', http: 200, entrees: 40, retenues: 0, erreur: null }
  ];
}
function abime(f) { var e = sain(); f(e); return e; }

var cas = [];
function essai(nom, etats, recentes, erreurBase) {
  var r = S.analyser(etats, recentes, erreurBase);
  cas.push({ nom: nom, n: r.problemes.length,
             texte: r.problemes.map(function (p) {
               return p.replace(/<[^>]+>/g, '');
             }) });
}

essai('tout va bien', sain(), ligne(ilYA(2)), null);
essai('CNIL répond 404', abime(function(e){ e[0].http = 404; }), ligne(ilYA(2)), null);
essai('CNIL injoignable', abime(function(e){ e[0].erreur = 'timeout'; e[0].http = 0; }), ligne(ilYA(2)), null);
essai('format changé (0 entrée lue)', abime(function(e){ e[1].entrees = 0; e[1].retenues = 0; }), ligne(ilYA(2)), null);
essai('ANSSI ne retient rien (normal)', sain(), ligne(ilYA(2)), null);
essai('plus rien ne passe le tri', abime(function(e){ e[0].retenues = 0; e[1].retenues = 0; }), ligne(ilYA(2)), null);
essai('base muette depuis 30 j', sain(), ligne(ilYA(30)), null);
essai('base calme depuis 10 j', sain(), ligne(ilYA(10)), null);
essai('table vide', sain(), [], null);
essai('base en panne', sain(), null, { message: 'connexion refusée' });

// L'email doit rester lisible : on vérifie qu'il se fabrique sans exploser.
var html = S.corpsHtml(['Un problème'], sain(), '18 août 2026');

ALERTES.diagnostiquer().then(function (reel) {
  print(JSON.stringify({ cas: cas, reel: reel,
                         silence: S.SILENCE_JOURS,
                         email_ok: html.indexOf('Un problème') !== -1 }));
}).catch(function (e) {
  print(JSON.stringify({ erreur: String(e && e.message || e) }));
});
"""

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais
                + '\nALERTES = ' + enveloppe(src_sources) + ';\n'
                + '\nvar S = ' + enveloppe(src_sentinelle) + ';\n'
                + verif)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=90)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — la sentinelle n\'a pas pu être exécutée :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    try:
        d = json.loads(brut.splitlines()[-1])
    except Exception:
        print('Sortie inattendue :\n' + brut[:2000])
        return 1
    if 'erreur' in d:
        print('ÉCHEC : ' + d['erreur'])
        return 1

    ok = True

    print('═' * 74)
    print('A. CE QUE LA SENTINELLE VOIT AUJOURD\'HUI')
    print('═' * 74)
    for e in d['reel']:
        etat = (e['erreur'] or ('HTTP %d' % e['http']) if (e['erreur'] or e['http'] != 200)
                else '%d entrées lues, %d retenues' % (e['entrees'], e['retenues']))
        print('  %-20s %s' % (e['nom'], etat))
        if e['erreur'] or e['http'] != 200 or e['entrees'] == 0:
            print('       !! cette source déclencherait un email')
    print()

    print('═' * 74)
    print('B. MISE À L\'ÉPREUVE (%d situations)' % len(d['cas']))
    print('═' * 74)

    # Doit-elle crier, oui ou non ?
    attendu = {
        'tout va bien': 0,
        'CNIL répond 404': 1,
        'CNIL injoignable': 1,
        'format changé (0 entrée lue)': 1,
        'ANSSI ne retient rien (normal)': 0,
        'plus rien ne passe le tri': 1,
        'base muette depuis 30 j': 1,
        'base calme depuis 10 j': 0,
        'table vide': 1,
        'base en panne': 1
    }
    for c in d['cas']:
        att = attendu.get(c['nom'])
        bon = c['n'] == att
        ok = ok and bon
        verdict = 'silence' if c['n'] == 0 else ('%d alerte(s)' % c['n'])
        print('  %-5s %-32s %s' % ('OK' if bon else 'ÉCHEC', c['nom'], verdict))
        for t in c['texte']:
            print('        → %s' % t[:96])
        if not bon:
            print('        attendu : %s' % ('silence' if att == 0 else '%d' % att))

    print()
    print('Seuil de silence : %d jours' % d['silence'])
    if not d['email_ok']:
        print('!! l\'email ne se fabrique pas correctement')
        ok = False

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
