-- ════════════════════════════════════════════
-- DESPY — Le bilan du proche
--
-- Le senior choisit de partager, une fois par mois, un bilan chiffré avec
-- celui qui veille sur lui (personne de confiance, ou payeur de la formule
-- Famille). FALSE par défaut : rien n'est partagé tant qu'il n'a pas dit oui.
-- Le choix est remis à FALSE quand il change de personne de confiance.
--
-- Sans cette colonne, rien ne casse : l'écran ne propose pas le bilan, et
-- l'envoi mensuel signale la migration manquante par email au lieu d'envoyer.
-- ════════════════════════════════════════════

ALTER TABLE clients ADD COLUMN IF NOT EXISTS bilan_proche BOOLEAN DEFAULT FALSE;
