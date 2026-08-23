#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du détecteur de vagues internes
#
# Ce détecteur est le seul étage de la chaîne qui puisse aller plus vite que
# les médias. Il a aussi la particularité d'échouer EN SILENCE : ses trois
# bugs historiques ne provoquaient aucune erreur, ils produisaient juste rien
# — et rien ressemble exactement à « aucune arnaque en ce moment ».
#
# Deux risques symétriques, et le second est le pire :
#   • trop sourd  → on ne prévient personne, l'étage ne sert à rien ;
#   • trop bavard → on envoie à TOUS nos membres une notification qui désigne
#     nommément un domaine ou un numéro. Se tromper là-dessus, c'est accuser
#     publiquement quelqu'un à partir d'un seul message collé deux fois.
#
# On vérifie donc, sans réseau et sans base :
#   A. la lecture d'un message (domaines, numéros, faux positifs) ;
#   B. le comptage de PERSONNES, pas d'occurrences ;
#   C. le comportement (dédoublonnage, panne, plafond) ;
#   D. les textes envoyés aux membres ;
#   E. l'affichage : la vague reste bien rouge « Vague détectée ».
#
# Usage : python3 tests/test_vagues.py
# ════════════════════════════════════════════

import io, json, os, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
APPLI = os.path.join(RACINE, 'despy_app_v23.html')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

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

    src_vagues = io.open(os.path.join(FONCTIONS, '_vagues.js'),
                         encoding='utf-8').read()
    src_app = io.open(APPLI, encoding='utf-8').read()
    src_index = io.open(os.path.join(RACINE, 'index.html'), encoding='utf-8').read()
    carte = extraire_fonction(src_app, 'alerteCard')

    harnais = """
var module = { exports: {} }; var exports = module.exports;
var console = { error: function(){}, log: function(){}, warn: function(){} };
function escapeHtmlA(s){ return String(s == null ? '' : s); }
function timeAgoFr(){ return 'a l instant'; }
var document = { getElementById: function(){ return null; } };

// Base factice : on lui dit quels titres existent deja, ou qu'elle est en
// panne. Elle renvoie les lignes d'analyses_history qu'on lui donne.
function faireBase(lignes, titresConnus, panne) {
  return { from: function (table) {
    var f = { _table: table, _titre: null };
    f.select = function () { return f; };
    f.eq = function (col, v) { if (col === 'title') f._titre = v; return f; };
    f.gte = function () { return f; };
    f.limit = function () {
      if (panne) return Promise.resolve({ data: null, error: { message: 'connexion refusee' } });
      if (f._table === 'analyses_history') return Promise.resolve({ data: lignes, error: null });
      var vu = titresConnus.indexOf(f._titre) !== -1;
      return Promise.resolve({ data: vu ? [{ id: 1 }] : [], error: null });
    };
    return f;
  } };
}
"""

    verif = r"""
var V = module.exports;
var res = { lecture: [], comptage: [], cas: [], textes: [], badges: [], numeros: [] };

// ── A. LECTURE D'UN MESSAGE ────────────────────────────────────────────
// De vrais SMS d'arnaque, tels qu'un membre les colle dans l'analyseur.
function lire(nom, txt, attendu) {
  var s = V.extraireSignaux(txt).map(function (x) { return x.type + ':' + x.valeur; });
  res.lecture.push({ nom: nom, obtenu: s, attendu: attendu });
}

lire('SMS colis avec faux domaine',
  'Votre colis Colissimo est en attente. Regularisez 1,99 EUR sur laposte-colis24.fr avant 48h.',
  ['domaine:laposte-colis24.fr']);

lire('le vrai laposte.fr ne compte pas',
  'Bonjour, suivez votre colis sur laposte.fr comme d habitude.',
  []);

lire('un sous-domaine du vrai site ne compte pas',
  'Rendez-vous sur www.impots.gouv.fr pour votre avis.',
  []);

lire('SMS bancaire avec numero a rappeler',
  'ALERTE : un paiement de 489EUR a ete valide. Si ce n est pas vous, appelez le 07 56 91 22 40.',
  ['numero:0756912240']);

lire('le meme lien repete trois fois ne vaut qu une fois',
  'Cliquez ici http://cpf-mesdroits.icu/a puis cpf-mesdroits.icu et enfin CPF-MESDROITS.ICU',
  ['domaine:cpf-mesdroits.icu']);

lire('domaine + numero dans le meme message',
  'Compte Ameli suspendu : ameli-verification.top ou rappelez le +33 6 12 34 56 78',
  ['domaine:ameli-verification.top', 'numero:0612345678']);

lire('une initiale n est pas un domaine',
  'Message de M.Dupont, votre conseiller. Merci d appeler etc.la maison.',
  []);

lire('le 3646 officiel n est jamais denonce',
  'Votre carte Vitale expire. Contactez le 3646 pour la renouveler.',
  []);

lire('le 33700 de signalement non plus',
  'Transferez ce message au 33700 pour signaler ce spam.',
  []);

lire('un message sans rien ne produit rien',
  'Bonjour maman, j ai change de numero, reponds ici stp.',
  []);

lire('contenu vide', '', []);

// ── Normalisation des numeros ──────────────────────────────────────────
[['+33 (0)6 12 34 56 78', '0612345678'],
 ['06.12.34.56.78', '0612345678'],
 ['0033612345678', '0612345678'],
 ['06 12 34 56 78', '0612345678'],
 ['0612345678', '0612345678'],
 ['+33612345678', '0612345678'],
 ['06-12-34-56-78', '0612345678'],
 ['3646', null],
 ['06 12 34', null],
 ['1234', null]].forEach(function (p) {
  res.numeros.push({ brut: p[0], obtenu: V.normaliserNumero(p[0]), attendu: p[1] });
});

// ── B. COMPTAGE DE PERSONNES ───────────────────────────────────────────
var SMS = 'Votre colis est bloque : reglez 1,99 EUR sur suivi-colis-fr.icu';
var SMS2 = 'Colis en attente, cliquez suivi-colis-fr.icu pour payer les frais.';

function compter(nom, lignes, attendu) {
  var v = V.compterVagues(lignes);
  res.comptage.push({ nom: nom, n: v.length,
                      detail: v.map(function (x) { return x.valeur + '=' + x.personnes; }),
                      attendu: attendu });
}

// LE bug historique : une seule personne inquiete qui colle trois fois.
compter('1 personne x 3 collages -> rien',
  [{ email: 'mamie@free.fr', ip: '1.1.1.1', content: SMS },
   { email: 'mamie@free.fr', ip: '1.1.1.1', content: SMS },
   { email: 'MAMIE@FREE.FR', ip: '1.1.1.1', content: SMS2 }], 0);

compter('2 personnes distinctes -> 1 vague',
  [{ email: 'mamie@free.fr', ip: '1.1.1.1', content: SMS },
   { email: 'paul@orange.fr', ip: '2.2.2.2', content: SMS2 }], 1);

// Sans email, on retombe sur l'IP : deux collages d'une meme box ne font
// toujours qu'une personne.
compter('anonyme, meme IP x 3 -> rien',
  [{ ip: '9.9.9.9', content: SMS }, { ip: '9.9.9.9', content: SMS },
   { ip: '9.9.9.9', content: SMS2 }], 0);

compter('anonyme, 2 IP differentes -> 1 vague',
  [{ ip: '9.9.9.9', content: SMS }, { ip: '8.8.8.8', content: SMS2 }], 1);

compter('2 personnes, 2 arnaques differentes -> rien',
  [{ email: 'a@a.fr', content: 'paye sur faux-site-a.icu' },
   { email: 'b@b.fr', content: 'paye sur faux-site-b.icu' }], 0);

compter('2 personnes sur un numero -> 1 vague',
  [{ email: 'a@a.fr', content: 'rappelez le 07 56 91 22 40 svp' },
   { email: 'b@b.fr', content: 'appel manque du +33 7 56 91 22 40' }], 1);

compter('liste vide', [], 0);

// ── C. COMPORTEMENT ────────────────────────────────────────────────────
var DEUX = [{ email: 'mamie@free.fr', ip: '1.1.1.1', content: SMS },
            { email: 'paul@orange.fr', ip: '2.2.2.2', content: SMS2 }];
var TITRE = 'Vague d’arnaque détectée : le site suivi-colis-fr.icu';

// Trois arnaques distinctes, chacune vue par 2 personnes : le plafond doit
// tenir, sinon on envoie trois notifications le meme matin.
var TROIS = [];
['aaa-fraude.icu', 'bbb-fraude.top', 'ccc-fraude.xyz'].forEach(function (d, i) {
  TROIS.push({ email: 'u' + i + 'a@x.fr', content: 'payez sur ' + d });
  TROIS.push({ email: 'u' + i + 'b@x.fr', content: 'lien ' + d + ' recu par SMS' });
});

function essai(nom, base, attendu) {
  return V.detecterVagues(base, new Date(Date.UTC(2026, 7, 24, 9))).then(function (out) {
    res.cas.push({ nom: nom, n: out.length, attendu: attendu,
                   titre: out.length ? out[0].title : null,
                   source: out.length ? out[0].source : null,
                   url: out.length ? out[0].url : null });
  });
}

Promise.resolve()
  .then(function () { return essai('2 personnes, base vierge -> 1 vague', faireBase(DEUX, [], false), 1); })
  .then(function () { return essai('deja publiee il y a peu -> silence', faireBase(DEUX, [TITRE], false), 0); })
  .then(function () { return essai('base en panne -> silence', faireBase(DEUX, [], true), 0); })
  .then(function () { return essai('1 seule ligne -> silence', faireBase([DEUX[0]], [], false), 0); })
  .then(function () { return essai('3 vagues -> plafonne a 2', faireBase(TROIS, [], false), 2); })
  .then(function () {
    // ── D. TEXTES ────────────────────────────────────────────────────
    [{ type: 'numero', valeur: '0756912240', personnes: 4 },
     { type: 'domaine', valeur: 'laposte-colis24.fr', personnes: 2 }].forEach(function (v) {
      var t = V.texteVague(v);
      res.textes.push({ type: v.type, titre: t.title, corps: t.body,
                        lt: t.title.length, lc: t.body.length });
    });

    // ── E. AFFICHAGE ─────────────────────────────────────────────────
    ['Despy Community', 'Despy · Anticipation'].forEach(function (s) {
      var html = alerteCard({ title: 'Un titre', body: 'Un corps', source: s,
                              created_at: new Date().toISOString() });
      res.badges.push({ source: s,
                        vague: html.indexOf('Vague détectée') !== -1,
                        saison: html.indexOf('Arnaque de saison') !== -1 });
    });

    print(JSON.stringify(res));
  })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.stack || e) })); });
"""

    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(harnais + src_vagues + '\n' + carte + '\n' + verif)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)

    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        print('ÉCHEC — le détecteur n\'a pas pu être exécuté :')
        print((r.stderr or '').strip()[:2000] or brut[:2000])
        return 1
    d = json.loads(brut.splitlines()[-1])
    if 'erreur' in d:
        print('ÉCHEC : ' + d['erreur'])
        return 1

    ok = True

    print('═' * 74)
    print('A. CE QU\'ON LIT DANS UN MESSAGE')
    print('═' * 74)
    for l in d['lecture']:
        bon = sorted(l['obtenu']) == sorted(l['attendu'])
        ok = ok and bon
        print('  %-5s %s' % ('OK' if bon else 'ÉCHEC', l['nom']))
        if not bon:
            print('        attendu %s · obtenu %s' % (l['attendu'] or '—',
                                                      l['obtenu'] or '—'))

    print()
    print('  Numéros ramenés à une forme unique :')
    for n in d['numeros']:
        bon = n['obtenu'] == n['attendu']
        ok = ok and bon
        print('  %-5s %-22s → %s' % ('OK' if bon else 'ÉCHEC', n['brut'],
                                     n['obtenu'] or 'écarté'))

    print()
    print('═' * 74)
    print('B. ON COMPTE DES PERSONNES, PAS DES COLLAGES')
    print('═' * 74)
    for c in d['comptage']:
        bon = c['n'] == c['attendu']
        ok = ok and bon
        print('  %-5s %-38s %s' % ('OK' if bon else 'ÉCHEC', c['nom'],
                                   ', '.join(c['detail']) or 'aucune vague'))

    print()
    print('═' * 74)
    print('C. COMPORTEMENT')
    print('═' * 74)
    for c in d['cas']:
        bon = c['n'] == c['attendu']
        ok = ok and bon
        print('  %-5s %-38s %s' % ('OK' if bon else 'ÉCHEC', c['nom'],
                                   (c['titre'] or 'silence')[:32]))

    # Le bouton de la notification doit mener quelque part. L'ancienne version
    # envoyait vers « #analyseur », une ancre qui n'existe dans aucune page :
    # le membre atterrissait en haut du site commercial, sans son alerte.
    url = next((c['url'] for c in d['cas'] if c['url']), None)
    ancre = url.split('#')[1] if url and '#' in url else None
    cible_ok = bool(url) and (
        ancre is None or ('id="%s"' % ancre) in src_app or ('id="%s"' % ancre) in src_index)
    ok = ok and cible_ok
    print('  %-5s %-38s %s' % ('OK' if cible_ok else 'ÉCHEC',
                               'le lien mène à une page réelle', url or '—'))

    print()
    print('═' * 74)
    print('D. CE QUE LE MEMBRE REÇOIT')
    print('═' * 74)
    for t in d['textes']:
        soucis = []
        if t['lt'] > TITRE_MAX:
            soucis.append('titre %d > %d' % (t['lt'], TITRE_MAX))
        if t['lc'] > CORPS_MAX:
            soucis.append('corps %d > %d' % (t['lc'], CORPS_MAX))
        # Un numéro lu à voix haute par quelqu'un qui vérifie son journal
        # d'appels : par paires, sinon il ne le reconnaîtra pas.
        if t['type'] == 'numero' and '07 56 91 22 40' not in t['titre']:
            soucis.append('numéro non lisible')
        bon = not soucis
        ok = ok and bon
        print('  %-5s %s' % ('OK' if bon else 'ÉCHEC', t['titre']))
        print('        %s' % t['corps'])
        if soucis:
            print('        %s' % ' · '.join(soucis))

    print()
    print('═' * 74)
    print('E. AFFICHAGE DANS L\'APPLI')
    print('═' * 74)
    for b in d['badges']:
        if 'Anticipation' in b['source']:
            bon = b['saison'] and not b['vague']
            attendu = 'Arnaque de saison'
        else:
            bon = b['vague'] and not b['saison']
            attendu = 'Vague détectée'
        ok = ok and bon
        print('  %-5s %-24s → %s' % ('OK' if bon else 'ÉCHEC', b['source'], attendu))

    print()
    print('RÉSULTAT : ' + ('tout est vert.' if ok else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
