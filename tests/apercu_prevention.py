#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Voir l'email de prévention avant qu'un client le reçoive
#
#   python3 tests/apercu_prevention.py
#
# Écrit deux fichiers dans /tmp et les ouvre : la version abonné et la version
# compte gratuit, rendues par les VRAIS gabarits de send-email.js.
#
# Le contenu ci-dessous imite ce que le modèle produit à partir d'un article de
# presse — c'est l'exemple qui sert à juger la mise en page et le ton. Le jour
# du vrai clic, seul le texte change ; la structure est celle-ci.
# ════════════════════════════════════════════

import json
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework'
       '/Versions/A/Helpers/jsc')

SOCLE = """
var module = { exports: {} };
var exports = module.exports;
var process = { env: {} };
var console = { warn: function(){}, error: function(){}, log: function(){} };
function require(nom) {
  if (nom === 'crypto') {
    return { createHmac: function () {
      return { update: function () { return this; },
               digest: function () { return 'ffffffffffffffffffffffffffffffff'; } };
    } };
  }
  return {};
}
"""

EXEMPLE = {
    'titre': "Le faux conseiller bancaire qui vous fait valider le virement vous-même",
    'accroche': "Des personnes reçoivent en ce moment un appel présenté comme venant du "
                "service anti-fraude de leur banque. L'interlocuteur connaît déjà votre nom, "
                "et le numéro qui s'affiche est bien celui de votre agence.",
    'mecanisme': "L'escroc appelle en faisant apparaître le vrai numéro de votre banque, "
                 "ce qui est techniquement simple. Il annonce qu'une opération suspecte "
                 "vient d'être détectée sur votre compte et propose de l'annuler tout de "
                 "suite. Pour cela, il vous demande de lui lire un code reçu par message, "
                 "ou de valider une notification qui s'affiche dans votre application "
                 "bancaire. Ce que vous validez alors n'est pas une annulation : c'est le "
                 "virement lui-même, que la banque considérera comme autorisé par vous.",
    'concerne': "Toute personne détentrice d'un compte bancaire, contactée par téléphone, "
                "le plus souvent en fin de journée ou le week-end.",
    'signes': [
        "On vous appelle sans que vous ayez rien signalé à votre banque.",
        "On vous presse : il faudrait agir dans les minutes qui viennent.",
        "On vous demande de lire à voix haute un code reçu par message.",
        "On vous demande de valider une notification pendant qu'on vous parle.",
        "On vous suggère de ne pas en parler autour de vous pour l'instant.",
    ],
    'reflexes': [
        "Raccrochez, même si cela vous semble impoli. Une vraie banque ne le prendra jamais mal.",
        "Rappelez votre banque au numéro inscrit au dos de votre carte, jamais à celui qui vous a appelé.",
        "Attendez cinq minutes avant de rappeler, le temps que la ligne se libère vraiment.",
        "Si un code a déjà été communiqué, demandez l'opposition immédiate et faites-le constater.",
    ],
    'jamais': [
        "Ne jamais communiquer un code reçu par message, à personne.",
        "Ne jamais valider une notification qu'on vous dicte au téléphone.",
        "Ne jamais rappeler le numéro affiché par l'appel entrant.",
    ],
}


def rendre():
    src = (RACINE / 'netlify/functions/send-email.js').read_text(encoding='utf-8')
    script = SOCLE + src + f"""
var __arg = {{ prenom: 'Jeanne', contenu: {json.dumps(EXEMPLE)},
              alertSource: 'Dernières Nouvelles d\\'Alsace',
              alertLink: 'https://www.dna.fr/exemple' }};
print(JSON.stringify({{
  abonne:  templates.alerte_prevention(__arg),
  gratuit: templates.alerte_prevention_free(__arg)
}}));
"""
    r = subprocess.run([JSC, '-e', script], capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr or r.stdout)
        sys.exit(1)
    return json.loads(r.stdout.strip().splitlines()[-1])


def main():
    rendu = rendre()
    chemins = []
    for cle, etiquette in [('abonne', 'abonné'), ('gratuit', 'compte gratuit')]:
        objet = rendu[cle]['subject']
        f = Path(f'/tmp/despy-prevention-{cle}.html')
        f.write_text(
            '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
            f'<title>{objet}</title></head>'
            '<body style="margin:0;background:#e8ecf3;padding:24px 0">'
            '<div style="max-width:600px;margin:0 auto 14px;font:13px -apple-system,'
            'Helvetica,Arial,sans-serif;color:#5b6572">'
            f'<strong>Version {etiquette}</strong><br>Objet : {objet}</div>'
            + rendu[cle]['html'] + '</body></html>',
            encoding='utf-8')
        chemins.append(f)
        print(f'  {etiquette:<15} {f}')
        print(f'  {"":<15} objet : {objet}')

    subprocess.run(['open'] + [str(c) for c in chemins])


if __name__ == '__main__':
    main()
