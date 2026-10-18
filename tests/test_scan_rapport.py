#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Le rapport de recherche n'écrit que s'il y a quelque chose à valider
#
# Chaque 1er du mois, le passage mensuel relance la recherche d'empreinte de
# chaque client, et chaque recherche envoyait un rapport à l'équipe — même
# « 0 nouvelle action ». Un email vide par client et par mois : de ceux qui
# font négliger celui qui compte.
#
# Ce banc fait tourner le vrai privacy-scan-background.js avec une recherche
# et une classification simulées.
#
# Usage : python3 tests/test_scan_rapport.py
# ════════════════════════════════════════════

import json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_nettoyage as N
import test_suivi as S

EXTRAS = r"""
process.env.ANTHROPIC_API_KEY = 'a';
var AbortSignal = { timeout: function () { return null; } };
var BRAVE = [], CLASSES = [];
var fetch2 = fetch;
fetch = function (url, opts) {
  if (/api\.search\.brave\.com/.test(url)) return Promise.resolve(reponse(200, { web: { results: BRAVE } }));
  if (/api\.anthropic\.com/.test(url)) return Promise.resolve(reponse(200, { content: [{ text: JSON.stringify(CLASSES) }] }));
  return fetch2(url, opts);
};
"""

VERIF = r"""
var R = [];
function note(nom, attendu, obtenu) { R.push({ nom: nom, ok: JSON.stringify(attendu) === JSON.stringify(obtenu), attendu: attendu, obtenu: obtenu }); }
var C = { user_email: 'marie@x.fr', prenom: 'Marie', nom: 'Durand', target_email: 'marie@x.fr', phone: '0601020304', ville: 'Strasbourg' };
function scan() {
  return require('./privacy-scan-background').handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 's' }, body: JSON.stringify(C) });
}
function rapports() { return MAILS.filter(function (m) { return m.to === 'contact.despy@gmail.com' && /^🕵️ Scan/.test(m.sujet); }); }
function cas(nom, prep, attendu) {
  return function () {
    remettre(); BRAVE = []; CLASSES = []; prep();
    return scan().then(function () {
      var r = rapports();
      note(nom, attendu, { rapports: r.length, sujet: r[0] ? r[0].sujet.replace(/^.*: /, '') : null });
    }).catch(function (e) { R.push({ nom: nom, ok: false, attendu: attendu, obtenu: 'EXCEPTION ' + (e && e.message || e) }); });
  };
}
var UN = { url: 'https://annuaire.exemple/marie-durand', title: 'Marie Durand Strasbourg', description: '06 01 02 03 04' };

Promise.resolve()
  .then(cas('aucun résultat : pas d\'email', function () {}, { rapports: 0, sujet: null }))
  .then(cas('résultat déjà connu le mois dernier : pas d\'email', function () {
    BRAVE = [UN]; CLASSES = [{ i: 0, category: 'annuaire', action: 'formulaire', confidence: 0.9 }];
    TABLES.privacy_findings.push({ user_email: 'marie@x.fr', url: UN.url, status: 'validated' });
  }, { rapports: 0, sujet: null }))
  .then(cas('nouveau résultat sans rien à faire : pas d\'email', function () {
    BRAVE = [UN]; CLASSES = [{ i: 0, category: 'homonyme_probable', action: 'rien', confidence: 0.9 }];
  }, { rapports: 0, sujet: null }))
  .then(cas('nouveau résultat à traiter : un email', function () {
    BRAVE = [UN]; CLASSES = [{ i: 0, category: 'annuaire', action: 'formulaire', confidence: 0.9 }];
  }, { rapports: 1, sujet: '1 nouvelle(s) action(s) sur 1 résultat(s)' }))
  .then(function () { print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""


def banc(dossier):
    src = N.HARNAIS.replace('__DIR__', json.dumps(dossier)) + '\n' + S.EXTRAS + '\n' + EXTRAS + '\n' + VERIF
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(src)
        chemin = f.name
    try:
        r = subprocess.run([N.JSC, chemin], capture_output=True, text=True, timeout=60)
    finally:
        os.unlink(chemin)
    brut = (r.stdout or '').strip()
    if r.returncode != 0 or not brut:
        return None, (r.stderr or '').strip()[:2000] or brut[:2000]
    d = json.loads(brut.splitlines()[-1])
    if isinstance(d, dict):
        return None, d.get('erreur', str(d))
    return d, None


def main():
    if not os.path.exists(N.JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    print('═' * 74)
    print("LE RAPPORT DE RECHERCHE : SEULEMENT S'IL Y A QUELQUE CHOSE À VALIDER")
    print('═' * 74)
    d, err = banc(N.FONCTIONS)
    if err:
        print("ÉCHEC — le banc n'a pas pu tourner :\n" + err)
        return 1
    ok = True
    for c in d:
        ok = ok and c['ok']
        print('  %-5s %s' % ('OK' if c['ok'] else 'ÉCHEC', c['nom']))
        if not c['ok']:
            print('        attendu : %s' % json.dumps(c['attendu'], ensure_ascii=False))
            print('        obtenu  : %s' % json.dumps(c['obtenu'], ensure_ascii=False))
    print()
    print('TOUT EST BON' if ok else 'IL Y A DES ÉCHECS')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
