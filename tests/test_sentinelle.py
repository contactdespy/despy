#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai de la sentinelle
#
# Une sentinelle qu'on n'a jamais mise à l'épreuve ne vaut rien : elle se
# contente de ne rien dire, ce qui est exactement ce qu'elle ferait si elle
# était cassée. On lui présente donc des pannes inventées et on vérifie
# qu'elle crie — et, tout aussi important, qu'elle se tait quand tout va bien.
#
# Trois parties :
#   A. ce que la sentinelle voit AUJOURD'HUI sur les vrais flux ;
#   B. dix situations fabriquées : source morte, format changé, base muette…
#   C. son décompte, sur un flux de synthèse : ce qu'elle ANNONCE retenu doit
#      être ce que la chaîne GARDE vraiment.
#
# Usage : python3 tests/test_sentinelle.py
# ════════════════════════════════════════════

import email.utils, io, json, os, subprocess, sys, tempfile, time
import urllib.request

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


def jsc(code):
    """Exécute un bout de JS et renvoie le résultat du processus."""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(code)
        chemin = f.name
    try:
        return subprocess.run([JSC, chemin], capture_output=True, text=True,
                              timeout=90)
    finally:
        os.unlink(chemin)


# Ce que jsc n'a pas, pour charger le module seul (sans la sentinelle).
def socle(corpus_json='{}'):
    return """
var __CORPUS__ = %s;
var console = { error: function(){}, log: function(){}, warn: function(){} };
var AbortSignal = { timeout: function(){ return null; } };
function fetch(url) {
  var xml = __CORPUS__[url];
  var vivant = typeof xml === 'string' && xml.length > 0;
  return Promise.resolve({
    ok: vivant, status: vivant ? 200 : 599,
    text: function(){ return Promise.resolve(xml || ''); }
  });
}
var module = { exports: {} };
var exports = module.exports;
""" % corpus_json


def sources_du_module(src):
    """Demande au module ses sources, au lieu de les deviner à la regex.

    Ce banc lisait les URL à `url:\\s*'([^']+)'`. Les deux flux de presse sont
    construits par concaténation (`'…?q=' + encodeURIComponent(…)`) : la regex
    s'arrêtait au premier apostrophe et rendait « …/rss/search?q= », qui répond
    404. La partie A téléchargeait donc une page d'erreur pour les DEUX sources
    de presse, les affichait « HTTP 599 » et annonçait qu'elles déclencheraient
    un email — alors qu'elles se portaient bien.

    Autrement dit, la seule partie du banc qui regarde les vraies sources était
    aveugle précisément là où vit le filtre de territoire. C'est ce trou qui a
    laissé passer le décompte gonflé que vérifie la partie C.
    (Même correction que dans tests/test_alertes.py, pour la même raison.)"""
    r = jsc(socle() + '\n' + src + '\n'
            + 'print(JSON.stringify(module.exports.SOURCES.map(function(s){'
            + ' return { nom: s.nom, url: s.url, confiance: s.confiance,'
            + ' exige: s.exige || null }; })));')
    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        sys.exit('ERREUR : le module ne se charge pas :\n'
                 + ((r.stderr or '').strip()[:1500] or brut[:1500]))
    return json.loads(brut.splitlines()[-1])


# ── Le décompte de la sentinelle, sur un flux écrit à la main ────────────────
# La partie A ne prouve rien : elle lit l'actualité du jour, et un décompte
# faux n'y saute aux yeux que s'il se trouve qu'un article le trahit. Le
# 10 septembre 2026, la presse locale annonçait 16 articles retenus quand la
# chaîne n'en gardait que 2 — huit fois trop, et pourtant « en bonne santé ».
#
# Les cinq articles ci-dessous fixent le décor une fois pour toutes. Ils
# couvrent les trois façons dont une entrée peut finir écartée, dont les deux
# que `diagnostiquer` oubliait de compter :
#   — hors territoire mais parfaitement dans le sujet (n° 2 et 4) : c'est là
#     tout le gonflement, ces articles passent le tri et rien d'autre ;
#   — sur le territoire mais hors sujet (n° 5) : le tri doit continuer de
#     s'appliquer, l'exigence de territoire ne le remplace pas.
#
# Aucun des deux articles retenus ne partage assez de mots rares avec l'autre
# pour être regroupé : c'est ce qui permet à la partie C d'exiger l'égalité
# STRICTE entre le décompte annoncé et ce que la chaîne rend. Ajouter ici deux
# dépêches sur la même affaire casserait cette égalité — pour une bonne raison
# (le regroupement), mais le banc, lui, crierait à tort.
ARTICLES_LOCAUX = [
    # Le Bas-Rhin raconté par une chaîne nationale. RETENU.
    ('Dans le Bas-Rhin, une arnaque au faux conseiller bancaire vise '
     'les retraités', 'BFM', True),
    # Le journal s'appelle « L'Alsace », le sujet est national. ÉCARTÉ — et
    # c'est un des deux que l'ancien décompte comptait quand même.
    ('Impôts : un faux courriel de remboursement piège des milliers '
     'de contribuables', "L'Alsace", False),
    # « Strasbourg » dans le titre. RETENU.
    ('À Strasbourg, une escroquerie au faux coursier vide les comptes '
     'de plusieurs seniors', '20 Minutes', True),
    # Vraie alerte, mais nationale : rien à voir avec le Bas-Rhin. ÉCARTÉ.
    ("Faux SMS de La Poste : une vague d'hameçonnage frappe toute la France",
     'Le Parisien', False),
    # Sur le territoire, mais ce n'est pas une alerte : Google le remonte
    # parce que le mot « arnaque » est dans le corps de l'article. ÉCARTÉ.
    ('Foire aux vins de Colmar 2026 : les organisateurs alertent sur '
     'les faux billets', 'Actu.fr', False),
]


def xml_echappe(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def flux_fabrique():
    """Un RSS Google Actualités de synthèse, au format exact de l'original."""
    items = []
    for i, (titre, journal, _) in enumerate(ARTICLES_LOCAUX):
        date = email.utils.formatdate(time.time() - (i + 1) * 3600, usegmt=True)
        lien = 'https://news.google.com/rss/articles/SENTINELLE%d' % i
        # Google échappe le HTML de sa description : &lt;a href=…&gt;
        desc = ('&lt;a href="%s"&gt;%s&lt;/a&gt;&amp;nbsp;&amp;nbsp;'
                '&lt;font color="#6f6f6f"&gt;%s&lt;/font&gt;'
                % (lien, xml_echappe(titre), xml_echappe(journal)))
        items.append(
            '<item><title>%s - %s</title><link>%s</link>'
            '<guid isPermaLink="false">%s</guid><pubDate>%s</pubDate>'
            '<description>%s</description>'
            '<source url="https://exemple.fr">%s</source></item>'
            % (xml_echappe(titre), xml_echappe(journal), lien, lien, date,
               desc, xml_echappe(journal)))
    return ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
            '<title>Fabriqué</title>' + ''.join(items) + '</channel></rss>')


def controle_decompte(src, sources):
    """Ce que la sentinelle ANNONCE, et ce que la chaîne GARDE, côte à côte.

    On ne sert QUE le flux fabriqué : les autres sources répondent « vide »,
    ce qui ne gêne pas — on ne regarde que la ligne de la presse locale."""
    locale = next((s for s in sources if s.get('exige')), None)
    if not locale:
        return {'erreur': "aucune source n'a d'exigence de territoire"}
    r = jsc(socle(json.dumps({locale['url']: flux_fabrique()})) + '\n' + src
            + '\nvar M = module.exports;\n'
            + 'Promise.all([M.diagnostiquer(), M.collecterPresse(400)])\n'
            + ' .then(function (r) {\n'
            + '   var etat = r[0].filter(function (e) { return e.nom === '
            + json.dumps(locale['nom']) + '; })[0];\n'
            + '   print(JSON.stringify({ entrees: etat.entrees,\n'
            + '     retenues: etat.retenues, http: etat.http,\n'
            + '     gardes: r[1].map(function (a) { return a.title; }) }));\n'
            + ' }).catch(function (e) {\n'
            + '   print(JSON.stringify({ erreur: String(e && e.message || e) }));\n'
            + ' });')
    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        return {'erreur': (r.stderr or '').strip()[:300] or '(aucune sortie)'}
    try:
        return json.loads(brut.splitlines()[-1])
    except Exception:
        return {'erreur': 'sortie inattendue : ' + brut[:300]}


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')

    src_sources = io.open(os.path.join(FONCTIONS, '_alert-sources.js'),
                          encoding='utf-8').read()
    src_sentinelle = io.open(os.path.join(FONCTIONS, 'sentinelle-alertes.js'),
                             encoding='utf-8').read()

    # Les vrais flux, pour la partie A.
    sources = sources_du_module(src_sources)
    corpus = {s['url']: telecharger(s['url']) for s in sources}

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
    print('═' * 74)
    print('C. LE DÉCOMPTE, SUR UN FLUX FABRIQUÉ')
    print('═' * 74)

    c = controle_decompte(src_sources, sources)
    if 'erreur' in c:
        print('  ÉCHEC : ' + c['erreur'])
        ok = False
    else:
        attendus = [t for t, _, garde in ARTICLES_LOCAUX if garde]

        def controle(intitule, obtenu, attendu):
            nonlocal ok
            bon = obtenu == attendu
            ok = ok and bon
            print('  %-5s %-34s %r' % ('OK' if bon else 'ÉCHEC', intitule, obtenu))
            if not bon:
                print('        attendu : %r' % (attendu,))

        controle('entrées lues', c['entrees'], len(ARTICLES_LOCAUX))
        controle('retenues annoncées', c['retenues'], len(attendus))
        controle('gardées par la chaîne', c['gardes'], attendus)
        # LE contrôle de cette partie. Les trois précédents disent ce qui est
        # juste aujourd'hui ; celui-ci dit ce qui doit le rester : la sentinelle
        # n'a pas le droit d'annoncer plus que ce que la chaîne garde. C'est
        # cette égalité qui était fausse — 16 annoncés, 2 gardés.
        controle('annoncé = gardé', c['retenues'], len(c['gardes']))

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
