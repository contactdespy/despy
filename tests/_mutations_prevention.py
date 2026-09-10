#!/usr/bin/env python3
"""Vérifie que le banc de prévention est capable d'échouer.

Réinjecte de vrais défauts, un par un, et exige que chacun fasse rougir le
banc. Un banc vert qu'on n'a jamais vu rouge ne prouve rien.

    python3 tests/_mutations_prevention.py
"""
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
VERT, ROUGE, GRIS, RAZ = '\033[32m', '\033[31m', '\033[90m', '\033[0m'

F_PREV = 'netlify/functions/_alerte-prevention.js'
F_MAIL = 'netlify/functions/send-email.js'
F_MOD = 'netlify/functions/alert-moderate.js'
F_FOND = 'netlify/functions/alerte-prevention-background.js'
F_RECAP = 'netlify/functions/_presse-recap.js'
F_NAT = 'netlify/functions/national-alerts.js'

MUTATIONS = [
    ('le validateur cesse d\'exiger le mécanisme', F_PREV,
     "  mecanisme: { min: 80, max: 700 },", "  // mecanisme retiré"),

    ('le validateur accepte une seule ligne de signes', F_PREV,
     "  signes:   { min: 3, max: 5, maxLong: 200 },",
     "  signes:   { min: 0, max: 5, maxLong: 200 },"),

    ('le validateur laisse passer un texte de 500 caractères', F_PREV,
     "if (liste.some(x => x.length > b.maxLong))",
     "if (false && liste.some(x => x.length > b.maxLong))"),

    ('le validateur ne voit plus « article trop vague »', F_PREV,
     "if (brut.impossible) return { ok: false,",
     "if (false) return { ok: false,"),

    ('l\'extraction JSON redevient naïve (coupe sur la 1re accolade)', F_PREV,
     "    if (c === '\"') { dansChaine = !dansChaine; continue; }",
     "    if (c === '\"') { continue; }"),

    ('l\'échappement HTML des emails est neutralisé', F_MAIL,
     'const esc = (txt) => String(txt == null ? "" : txt)\n'
     '  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")\n'
     '  .replace(/"/g, "&quot;").replace(/\'/g, "&#39;");',
     'const esc = (txt) => String(txt == null ? "" : txt);'),

    ('la version gratuite perd les réflexes (teaser tronqué)', F_MAIL,
     """        ${sectionTitre('Les bons réflexes')}
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:8px 20px 14px">
          ${listeCochee(c.reflexes)}
        </div>
      </div>

      <div style="background:#fff;padding:28px 32px 0">
        ${sectionTitre('À ne jamais faire')}
        <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 12px 12px 0;padding:16px 20px">
          ${listeInterdits(c.jamais)}
        </div>
      </div>

      <div style="background:#fff;padding:30px 32px 34px">
        <div style="background:#f7f9fc;border:1px solid #e6ebf2;border-radius:16px;padding:24px;text-align:center">""",
     """        <p>Abonnez-vous pour connaître les réflexes.</p>
      </div>

      <div style="background:#fff;padding:30px 32px 34px">
        <div style="background:#f7f9fc;border:1px solid #e6ebf2;border-radius:16px;padding:24px;text-align:center">"""),

    ('la version gratuite n\'a plus de lien de désinscription', F_MAIL,
     '  "relance_lead", "ia_scams_awareness", "cyber_alert_free",\n'
     '  "alerte_prevention_free"',
     '  "relance_lead", "ia_scams_awareness", "cyber_alert_free"'),

    ('le 06 personnel fuite vers les comptes gratuits', F_MAIL,
     """      ${brandFooter()}
    </div>`
    };
  },

  // Sensibilisation : arnaques générées par IA""",
     """      ${brandFooter(true)}
    </div>`
    };
  },

  // Sensibilisation : arnaques générées par IA"""),

    ('la signature ne dépend plus de la décision (lien transformable)', F_MOD,
     "if (sig !== signFinding('alerte', id, decision)) {",
     "if (sig !== signFinding('alerte', id, 'publier')) {"),

    ('« publier_prevenir » n\'écrit plus le bon statut', F_MOD,
     "  publier_prevenir: 'publie',", "  publier_prevenir: 'rejete',"),

    ('l\'idempotence saute (2e clic republie)', F_MOD,
     "      .eq('status', 'a_valider')\n      .select('id, title, source')",
     "      .select('id, title, source')"),

    ('un déclenchement raté est avalé en silence', F_MOD,
     "      if (!lance) {", "      if (false) {"),

    ('le clic ne déclenche plus rien', F_MOD,
     "/.netlify/functions/alerte-prevention-background`", "/.netlify/functions/ping`"),

    ('la réservation passe APRÈS les envois (double envoi possible)', F_FOND,
     """    // 4. Réserver AVANT d'envoyer.
    const { error: eResa } = await supabase.from('sent_alerts').insert({""",
     """    // 4. Envoyer d'abord — défaut réinjecté.
    const { abonnes, gratuits, desinscrits } = await destinataires(supabase);
    const rA = await diffuser(abonnes, 'alerte_prevention', contenu, alerte);
    const { error: eResa } = await supabase.from('sent_alerts').insert({"""),

    ('les désinscrits reçoivent quand même l\'alerte', F_FOND,
     "if (!mail || !mail.includes('@') || optout.has(mail)) continue;",
     "if (!mail || !mail.includes('@')) continue;"),

    ('on envoie même quand le contenu n\'a pas pu être rédigé', F_FOND,
     "      return ok({ envoye: 0, raison: prep.raison });",
     "      /* on continue quand même */"),

    ('la fonction s\'ouvre sans secret interne', F_FOND,
     "  if (secret && event.headers['x-internal-secret'] !== secret) {",
     "  if (false) {"),

    ('la notification renvoie vers l\'article de presse', F_FOND,
     "      url: 'https://despy.fr/app',", "      url: alerte.url,"),

    ('le troisième bouton disparaît du récapitulatif', F_RECAP,
     "  const prevenir = lien(base, a.id, 'publier_prevenir');",
     "  const prevenir = '#';"),

    ('national-alerts garde une copie de web-push', F_NAT,
     "const { envoyerPush, tagDepuis } = require('./_push');",
     "const webpush = require('web-push');\nconst { envoyerPush, tagDepuis } = require('./_push');"),
]


def main():
    attrapes, ratees = 0, 0
    for intitule, fichier, avant, apres in MUTATIONS:
        chemin = RACINE / fichier
        original = chemin.read_text(encoding='utf-8')
        if avant not in original:
            print(f'  {ROUGE}?{RAZ} {intitule}')
            print(f'    {GRIS}motif introuvable dans {fichier} — mutation non appliquée{RAZ}')
            ratees += 1
            continue
        chemin.write_text(original.replace(avant, apres, 1), encoding='utf-8')
        try:
            r = subprocess.run([sys.executable, str(RACINE / 'tests/test_prevention.py')],
                               capture_output=True, text=True)
            rouge = r.returncode != 0
        finally:
            chemin.write_text(original, encoding='utf-8')

        if rouge:
            attrapes += 1
            print(f'  {VERT}✓{RAZ} attrapé : {intitule}')
        else:
            ratees += 1
            print(f'  {ROUGE}✗{RAZ} PASSÉ INAPERÇU : {intitule}')

    print()
    total = attrapes + ratees
    if ratees == 0:
        print(f'{VERT}{attrapes}/{total} défauts réinjectés font rougir le banc.{RAZ}')
        return 0
    print(f'{ROUGE}{ratees}/{total} défauts passent inaperçus — le banc a des angles morts.{RAZ}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
