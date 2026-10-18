#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du tri de la presse, sur des titres réels
#
# La veille presse proposait deux emails de tri par jour, et le quart des
# articles ne parlait d'aucun danger qu'un habitant du Bas-Rhin puisse croiser.
# Un filtre plus strict réduit le tri ; un filtre trop strict ferait
# disparaître la bonne alerte — et ce silence-là ne se verrait pas.
#
# Ce banc tient les deux bouts avec des titres RELEVÉS sur les flux du
# 18 octobre 2026 : ceux qui doivent partir, et ceux qui doivent rester. Il
# vérifie aussi l'ordre de l'email du lundi : ce qui explique une arnaque
# passe devant ce qui la raconte.
#
# Usage : python3 tests/test_tri_presse.py
# ════════════════════════════════════════════

import json, os, subprocess, sys, tempfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

A_ECARTER = [
    "Warning Trading à la Banque mondiale contre les arnaques",
    "Arnaque au président : votre salarié a viré sur un faux ordre, comment récupérer les fonds",
    "Mulhouse. Usurpation d’identité et crédit jamais remboursé : un trentenaire condamné pour escroquerie",
    "Plainte DMCA sur Google: 9 articles dénonçant des arnaques déréférencés",
    "Nuxeros.app : analyse avis d’une arnaque",
    "Genesisarbit.expert: grosse arnaque. Notre avis.",
    "Tentative d’arnaque : Orange Money Burkina Faso invite ses clients à la vigilance",
    "Ces étranges SMS d'UBS cacheraient une arnaque liée à Twint",
    "Strasbourg. Des capitaines de Batorama jugés pour escroquerie : un préjudice évalué à 190 000 €",
    "Arnaque lorraine et 18 000 morts : il y a 501 ans, une « Guerre des paysans » secouait déjà l’Alsace",
]

A_GARDER = [
    "« Appuyez sur la touche 1 » : c’est quoi cette nouvelle arnaque bancaire qui fait un carnage en France ?",
    "Faux commissaire de justice : les 6 signes d'un message qui réclame une dette de loyer ou d'impôt",
    "Ce courrier des impôts avec un QR code et 5 euros à payer ressemble tellement à une arnaque que beaucoup le jettent",
    "Fraude bancaire par téléphone remboursement : faux conseiller, codes communiqués et recours",
    "Arnaque au faux enfant sur WhatsApp : faux nouveau numéro, virement urgent, signalement, plainte et remboursement",
    "« Votre colis est en attente » : voici ce qui se passe vraiment si vous cliquez sur le lien du SMS",
    "Arnaque au faux fichage Banque de France : comment reconnaître ce SMS",
    "L'arnaque au faux coursier en pleine recrudescence dans l'Indre",
    "Chèque énergie avancé à janvier 2027 : les 5 signes d'une arnaque avant l'envoi",
    "La justice a rendu sa décision : voici ce qu’est obligée de faire votre banque si vous êtes victime de phishing",
    # Des mots qui ressemblent à ceux qu'on écarte, et qui ne doivent PAS faire tomber l'article.
    "Arnaque au faux SMS : le risque subsiste malgré les blocages des opérateurs",
    "Une arnaque à la fausse amende de stationnement circule à Strasbourg",
]

CODE = r"""
var module={exports:{}},exports=module.exports;
var console={log:function(){},warn:function(){},error:function(){}};
var process={env:{}}; var AbortSignal={timeout:function(){return null;}};
function require(n){ if (n === './_alert-sources') return SOURCES_MOD; return {}; }
var SOURCES_MOD = (function(){ var module={exports:{}},exports=module.exports; __SOURCES__ ; return module.exports; })();
var M = SOURCES_MOD;
var veilleMod = (function(){ var module={exports:{}},exports=module.exports; __VEILLE__ ; return module.exports; })();
var R = { ecartes: A_ECARTER.filter(function(t){ return !M.pertinentPourPresse(t, ''); }),
          gardes:  A_GARDER.filter(function(t){ return M.pertinentPourPresse(t, ''); }) };
print(JSON.stringify(R));
"""


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    src = open(os.path.join(FONCTIONS, '_alert-sources.js'), encoding='utf-8').read()
    veille = open(os.path.join(FONCTIONS, 'veille-presse.js'), encoding='utf-8').read()
    # Pour juger l'ordre, on expose la fonction de score du module du lundi.
    veille = veille + "\nmodule.exports.__score = score;"
    js = ('var A_ECARTER=%s, A_GARDER=%s;\n' % (json.dumps(A_ECARTER), json.dumps(A_GARDER))
          + CODE.replace('__SOURCES__', src).replace('__VEILLE__', veille)
          + r"""
var s = veilleMod.__score;
var L = function (t) { return { title: t, source: 'Presse locale (Bas-Rhin)' }; };
var N = function (t) { return { title: t, source: 'Presse nationale' }; };
print(JSON.stringify({
  expliquee_devant_fait_divers_local: s(N("Faux commissaire de justice : les 6 signes d'un message")) > s(L("À Strasbourg, un acteur de l'hébergement d'urgence attaqué pour tentative d'escroquerie")),
  local_devant_national_a_egalite:   s(L("Une fausse amende de stationnement circule à Strasbourg : comment la reconnaître")) > s(N("Une fausse amende de stationnement circule : comment la reconnaître")),
  rappel_a_l_ordre_n_est_pas_un_appel: s(N("Arnaques bancaires : le rappel à l'ordre de la Cour de justice européenne")) === 0
}));
""")
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)
    lignes = (r.stdout or '').strip().splitlines()
    if r.returncode != 0 or len(lignes) < 2:
        print("ÉCHEC — le banc n'a pas pu tourner :\n" + ((r.stderr or '') + (r.stdout or ''))[:2000])
        return 1
    tri, ordre = json.loads(lignes[-2]), json.loads(lignes[-1])

    ok = True
    print('═' * 74)
    print('CE QUI DOIT PARTIR (titres réels du 18 octobre 2026)')
    print('═' * 74)
    for t in A_ECARTER:
        bon = t in tri['ecartes']
        ok = ok and bon
        print('  %-5s %s' % ('OK' if bon else 'ÉCHEC', t[:88]))
    print()
    print('═' * 74)
    print('CE QUI DOIT RESTER')
    print('═' * 74)
    for t in A_GARDER:
        bon = t in tri['gardes']
        ok = ok and bon
        print('  %-5s %s' % ('OK' if bon else 'ÉCHEC', t[:88]))
    print()
    print('═' * 74)
    print("L'ORDRE DE L'EMAIL DU LUNDI")
    print('═' * 74)
    for k, v in ordre.items():
        ok = ok and v
        print('  %-5s %s' % ('OK' if v else 'ÉCHEC', k.replace('_', ' ')))
    print()
    print('TOUT EST BON' if ok else 'IL Y A DES ÉCHECS')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
