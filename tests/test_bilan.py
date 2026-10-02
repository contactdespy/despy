#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du bilan du proche
#
# Une fois par mois, celui qui veille sur un senior reçoit ce que Despy a
# fait pour lui. Trois choses peuvent mal tourner, et aucune ne se verrait :
#   · le bilan part sans que le senior l'ait choisi ;
#   · il laisse passer le CONTENU d'un message, alors que l'écran promet au
#     senior « il ne verra rien de votre vie privée » ;
#   · il affiche un chiffre que personne n'a mesuré — un zéro né d'une lecture
#     ratée se lit « elle n'a rien fait ».
#
# Le banc fabrique un mois d'activité, y glisse un « message secret », et lit
# le bilan tel qu'il sort de send-email.
#
# Usage : python3 tests/test_bilan.py
# ════════════════════════════════════════════

import json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_nettoyage as N
import test_suivi as S

FONCTIONS = N.FONCTIONS
JSC = N.JSC

# Par-dessus les harnais existants : une base qui sait filtrer par date, une
# colonne qu'on peut « oublier de migrer », et le vrai send-email au bout.
EXTRAS = r"""
var SANS_COLONNE = false;
Q = function (table) {
  var filtres = [], op = 'select', seul = false, charge = null, cols = '', tri = null, max = 0, filtrees = [];
  var q = {};
  q.select = function (c) { cols = String(c || ''); return q; };
  q.eq  = function (c, v) { filtrees.push(c); filtres.push(function (r) { return r[c] === v; }); return q; };
  q.in  = function (c, vs) { filtres.push(function (r) { return vs.indexOf(r[c]) >= 0; }); return q; };
  q.gte = function (c, v) { filtres.push(function (r) { return r[c] != null && r[c] >= v; }); return q; };
  q.lt  = function (c, v) { filtres.push(function (r) { return r[c] != null && r[c] < v; }); return q; };
  q.order = function (c, o) { tri = { c: c, asc: !(o && o.ascending === false) }; return q; };
  q.limit = function (n) { max = n; return q; };
  q.maybeSingle = q.single = function () { seul = true; return q; };
  q.insert = function (p) { op = 'insert'; charge = p; return q; };
  q.update = function (p) { op = 'update'; charge = p; return q; };
  q.then = function (ok, ko) {
    var rep, T = TABLES[table] || (TABLES[table] = []);
    var touche = table === 'clients' && (/bilan_proche/.test(cols) || (charge && 'bilan_proche' in charge) ||
                 filtrees.indexOf('bilan_proche') >= 0);
    if (PANNE[table]) rep = { data: null, error: { message: 'panne ' + table } };
    else if (SANS_COLONNE && touche) rep = { data: null, error: { message: 'column clients.bilan_proche does not exist' } };
    else if (op === 'insert') { T.push(copie(charge)); rep = { data: null, error: null }; }
    else if (op === 'update') {
      T.forEach(function (r) { if (filtres.every(function (f) { return f(r); })) for (var k in charge) r[k] = charge[k]; });
      rep = { data: null, error: null };
    } else {
      var l = T.filter(function (r) { return filtres.every(function (f) { return f(r); }); }).map(copie);
      if (tri) l.sort(function (a, b) { return (a[tri.c] < b[tri.c] ? -1 : a[tri.c] > b[tri.c] ? 1 : 0) * (tri.asc ? 1 : -1); });
      if (max) l = l.slice(0, max);
      rep = { data: seul ? (l[0] || null) : l, error: null };
    }
    return Promise.resolve(rep).then(ok, ko);
  };
  return q;
};

var fetch1 = fetch;
fetch = function (url, opts) {
  var fn = (String(url).match(/\/\.netlify\/functions\/([a-z-]+)/) || [])[1];
  if (fn === 'send-email' || fn === 'bilan-proche-background') {
    return require('./' + fn).handler({ httpMethod: 'POST', headers: opts.headers || {}, body: opts.body })
      .then(function (r) { var c = {}; try { c = JSON.parse(r.body); } catch (e) {} return reponse(fn === 'bilan-proche-background' && r.statusCode === 200 ? 202 : r.statusCode, c); });
  }
  return fetch1(url, opts);
};
"""

VERIF = r"""
var R = [];
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}
function note(nom, attendu, obtenu) { R.push({ nom: nom, ok: canon(attendu) === canon(obtenu), attendu: attendu, obtenu: obtenu }); }
function etape(nom, f) {
  return function () { remettre(); SANS_COLONNE = false; RESEND_KO = false; MAINT = '2026-10-01T06:00:00Z';
    TABLES.clients = []; TABLES.family_members = []; TABLES.email_optouts = [];
    TABLES.analyses_history = []; TABLES.quiz_history = []; TABLES.training_tests = []; TABLES.sos_requests = [];
    return Promise.resolve().then(f).catch(function (e) {
      R.push({ nom: nom, ok: false, attendu: '—', obtenu: 'EXCEPTION ' + (e && e.message || e) }); }); };
}

var SECRET = 'MESSAGE SECRET DE MARIE 0611223344';
function marie(plus) {
  var c = { email: 'marie@x.fr', prenom: 'Marie', name: 'Marie Durand', subscribed: true, plan: 'monthly',
            trusted_contact_name: 'Sophie', trusted_contact_email: 'sophie@x.fr',
            chat_period: '2026-09', chat_period_used: 3, bilan_proche: true };
  for (var k in (plus || {})) c[k] = plus[k];
  TABLES.clients.push(c); return c;
}
function septembre() {
  ['2026-09-03T10:00:00Z', '2026-09-10T10:00:00Z', '2026-09-18T10:00:00Z'].forEach(function (d) {
    TABLES.analyses_history.push({ email: 'marie@x.fr', created_at: d, verdict: 'safe', content: SECRET }); });
  TABLES.analyses_history.push({ email: 'marie@x.fr', created_at: '2026-09-25T10:00:00Z', verdict: 'scam', content: SECRET });
  TABLES.analyses_history.push({ email: 'marie@x.fr', created_at: '2026-08-14T10:00:00Z', verdict: 'safe', content: SECRET });   // août : hors bilan
  TABLES.analyses_history.push({ email: 'autre@x.fr', created_at: '2026-09-12T10:00:00Z', verdict: 'scam', content: SECRET });   // quelqu'un d'autre
  TABLES.quiz_history.push({ email: 'marie@x.fr', created_at: '2026-09-20T10:00:00Z' });
  TABLES.training_tests.push({ email: 'marie@x.fr', sent_at: '2026-09-05T10:00:00Z', clicked_at: null });
  TABLES.training_tests.push({ email: 'marie@x.fr', sent_at: '2026-09-19T10:00:00Z', clicked_at: '2026-09-19T11:00:00Z' });
}
function passage(secret) {
  return require('./bilan-proche-background').handler({ httpMethod: 'POST',
    headers: { 'x-internal-secret': secret === undefined ? 's' : secret }, body: '{}' });
}
function bilans() { return MAILS.filter(function (m) { return /^Le bilan de/.test(m.sujet); }); }
function texte(m) { return (m ? m.html : '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '); }
function confiance(corps) {
  var b = { email: 'marie@x.fr' }; for (var k in corps) b[k] = corps[k];
  return require('./trusted-contact').handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b) })
    .then(function (r) { return JSON.parse(r.body); });
}

Promise.resolve()
  // ── Le contenu ──────────────────────────────────────────────────────────
  .then(etape('le proche reçoit les vrais chiffres du mois, pas ceux d\'août ni d\'un autre', function () {
    marie(); septembre();
    return passage().then(function () {
      var m = bilans()[0], t = texte(m);
      note('le proche reçoit les vrais chiffres du mois, pas ceux d\'août ni d\'un autre',
        { a: 'sophie@x.fr', sujet: 'Le bilan de Marie — septembre 2026', verifies: true, arnaque: true, questions: true, entrainement: true, quiz: true },
        { a: m && m.to, sujet: m && m.sujet, verifies: /4 messages vérifiés/.test(t), arnaque: /dont 1 arnaque repérée/.test(t),
          questions: /3 questions posées/.test(t), entrainement: /2 faux messages d'entraînement reçus : 1 clic/.test(t), quiz: /1 quiz terminé/.test(t) }); }); }))

  .then(etape('jamais le contenu d\'un message', function () {
    marie(); septembre();
    return passage().then(function () {
      var h = (bilans()[0] || { html: SECRET }).html;
      note('jamais le contenu d\'un message', { secret: false, numero: false, annonce: true },
        { secret: /MESSAGE SECRET/.test(h), numero: /0611223344/.test(h), annonce: /que des nombres/.test(h) }); }); }))

  .then(etape('le bilan porte le lien pour ne plus le recevoir, et la vraie raison de l\'envoi', function () {
    marie(); septembre();
    return passage().then(function () { var h = (bilans()[0] || {}).html || '';
      note('le bilan porte le lien pour ne plus le recevoir, et la vraie raison de l\'envoi',
        { lien: true, raison: true, fausse: false },
        { lien: /Se désinscrire/.test(h), raison: /parce que Marie a choisi de le partager avec vous/.test(h), fausse: /vous avez laissé votre adresse/.test(h) }); }); }))

  .then(etape('mois calme, compteur de questions illisible : on ne dit pas « aucune question »', function () {
    marie({ chat_period: '2026-10', chat_period_used: 2 });
    return passage().then(function () { var t = texte(bilans()[0]);
      note('mois calme, compteur de questions illisible : on ne dit pas « aucune question »',
        { inactif: true, questions: false }, { inactif: /n'a pas utilisé Despy/.test(t), questions: /aucune question/.test(t) }); }); }))

  // ── Les accords ─────────────────────────────────────────────────────────
  .then(etape('le senior n\'a pas dit oui : rien ne part', function () {
    marie({ bilan_proche: false }); septembre();
    return passage().then(function () { note('le senior n\'a pas dit oui : rien ne part', 0, MAILS.length); }); }))

  .then(etape('le proche s\'est désinscrit : plus de bilan, et ce n\'est pas une panne', function () {
    marie(); septembre(); TABLES.email_optouts.push({ email: 'sophie@x.fr' });
    return passage().then(function (r) { var b = JSON.parse(r.body);
      note('le proche s\'est désinscrit : plus de bilan, et ce n\'est pas une panne',
        { emails: 0, arretes: 1, erreurs: 0 }, { emails: MAILS.length, arretes: b.arretes, erreurs: b.erreurs }); }); }))

  .then(etape('ni personne de confiance ni famille : rien', function () {
    marie({ trusted_contact_email: null, trusted_contact_name: null }); septembre();
    return passage().then(function () { note('ni personne de confiance ni famille : rien', 0, MAILS.length); }); }))

  .then(etape('proche d\'une formule Famille, sans personne de confiance : le bilan va au payeur', function () {
    marie({ trusted_contact_email: null, trusted_contact_name: null, subscribed: false, plan: 'free' }); septembre();
    TABLES.clients.push({ email: 'fils@x.fr', prenom: 'Karim', subscribed: true, plan: 'family_monthly' });
    TABLES.family_members.push({ member_email: 'marie@x.fr', owner_email: 'fils@x.fr', status: 'active' });
    return passage().then(function () { var m = bilans()[0];
      note('proche d\'une formule Famille, sans personne de confiance : le bilan va au payeur',
        { a: 'fils@x.fr', pourquoi: true, invitation: false },
        { a: m && m.to, pourquoi: /qui lui offrez sa protection/.test(texte(m)), invitation: /Vous aussi, vous recevez/.test(texte(m)) }); }); }))

  .then(etape('un proche qui n\'est pas client est invité à essayer', function () {
    marie(); septembre();
    return passage().then(function () { note('un proche qui n\'est pas client est invité à essayer', true, /Vous aussi, vous recevez des messages douteux/.test(texte(bilans()[0]))); }); }))

  // ── Aucun chiffre inventé ───────────────────────────────────────────────
  .then(etape('mois sans activité : on le dit, avec la vraie dernière date', function () {
    marie({ chat_period: '2026-09', chat_period_used: 0 });
    TABLES.analyses_history.push({ email: 'marie@x.fr', created_at: '2026-08-14T10:00:00Z', verdict: 'safe', content: SECRET });
    return passage().then(function () { var t = texte(bilans()[0]);
      note('mois sans activité : on le dit, avec la vraie dernière date',
        { inactif: true, date: true, chiffre: false },
        { inactif: /Marie n'a pas utilisé Despy en septembre 2026/.test(t), date: /14 août/.test(t), chiffre: /messages? vérifiés? avec/.test(t) }); }); }))

  .then(etape('lecture impossible : ni « rien fait », ni chiffre', function () {
    marie(); septembre(); PANNE.analyses_history = true; PANNE.quiz_history = true; PANNE.training_tests = true; PANNE.sos_requests = true;
    TABLES.clients[0].chat_period = '2026-10';
    return passage().then(function () { var t = texte(bilans()[0]);
      note('lecture impossible : ni « rien fait », ni chiffre',
        { honnete: true, inactif: false, chiffre: false },
        { honnete: /pas pu réunir tous les chiffres/.test(t), inactif: /n'a pas utilisé/.test(t), chiffre: /vérifié/.test(t) }); }); }))

  .then(etape('compteur de questions déjà passé au mois suivant : la ligne disparaît', function () {
    marie({ chat_period: '2026-10', chat_period_used: 7 }); septembre();
    return passage().then(function () { var t = texte(bilans()[0]);
      note('compteur de questions déjà passé au mois suivant : la ligne disparaît',
        { questions: false, reste: true }, { questions: /questions? posées?/.test(t), reste: /4 messages vérifiés/.test(t) }); }); }))

  // ── Les pannes ──────────────────────────────────────────────────────────
  .then(etape('migration non faite : rien ne part, et l\'équipe le sait', function () {
    marie(); septembre(); SANS_COLONNE = true;
    return passage().then(function () {
      note('migration non faite : rien ne part, et l\'équipe le sait', { bilans: 0, alerte: 1 },
        { bilans: bilans().length, alerte: MAILS.filter(function (m) { return m.to === 'contact.despy@gmail.com'; }).length }); }); }))

  .then(etape('sans le secret interne : refusé', function () {
    marie(); septembre();
    return passage('faux').then(function (r) { note('sans le secret interne : refusé', { statut: 401, emails: 0 }, { statut: r.statusCode, emails: MAILS.length }); }); }))

  .then(etape('le déclencheur du 1er lance bien le travail', function () {
    marie(); septembre();
    return require('./bilan-proche').handler({ planifie: true, body: '{}' }).then(function () {
      note('le déclencheur du 1er lance bien le travail', 1, bilans().length); }); }))

  // ── Le choix du senior ──────────────────────────────────────────────────
  .then(etape('dire oui : c\'est enregistré, et le proche est prévenu avant le premier bilan', function () {
    marie({ bilan_proche: false });
    return confiance({ action: 'set_bilan', bilan: true }).then(function (r) {
      var m = MAILS.filter(function (x) { return x.to === 'sophie@x.fr'; })[0];
      note('dire oui : c\'est enregistré, et le proche est prévenu avant le premier bilan',
        { ok: true, base: true, annonce: true, nombres: true },
        { ok: r.ok, base: TABLES.clients[0].bilan_proche, annonce: !!m && /partage désormais son bilan/.test(m.sujet), nombres: !!m && /Des nombres seulement/.test(m.html) }); }); }))

  .then(etape('changer de personne de confiance remet le choix à zéro', function () {
    marie();
    return confiance({ action: 'set', contact_name: 'Paul', contact_email: 'paul@x.fr' }).then(function (r) {
      note('changer de personne de confiance remet le choix à zéro', { base: false, reponse: false },
        { base: TABLES.clients[0].bilan_proche, reponse: r.bilan }); }); }))

  .then(etape('garder la même personne ne remet rien à zéro', function () {
    marie();
    return confiance({ action: 'set', contact_name: 'Sophie D.', contact_email: 'sophie@x.fr' }).then(function () {
      note('garder la même personne ne remet rien à zéro', true, TABLES.clients[0].bilan_proche); }); }))

  .then(etape('dire oui sans avoir de proche : refusé', function () {
    marie({ bilan_proche: false, trusted_contact_email: null, trusted_contact_name: null });
    return confiance({ action: 'set_bilan', bilan: true }).then(function (r) {
      note('dire oui sans avoir de proche : refusé', { ok: false, raison: 'pas_de_proche', base: false },
        { ok: r.ok, raison: r.raison, base: TABLES.clients[0].bilan_proche }); }); }))

  .then(etape('migration non faite : désigner un proche marche toujours', function () {
    marie({ bilan_proche: undefined }); SANS_COLONNE = true;
    return confiance({ action: 'set', contact_name: 'Paul', contact_email: 'paul@x.fr' }).then(function (r) {
      return confiance({}).then(function (g) {
        note('migration non faite : désigner un proche marche toujours',
          { ok: true, enregistre: 'paul@x.fr', propose: false },
          { ok: r.ok, enregistre: TABLES.clients[0].trusted_contact_email, propose: g.bilan_dispo }); }); }); }))

  .then(function () { print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""


def banc(dossier):
    src = N.HARNAIS.replace('__DIR__', json.dumps(dossier)) + '\n' + S.EXTRAS + '\n' + EXTRAS + '\n' + VERIF
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(src)
        chemin = f.name
    try:
        r = subprocess.run([JSC, chemin], capture_output=True, text=True, timeout=60)
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
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    print('═' * 74)
    print('LE BILAN DU PROCHE : CE QUI PART, À QUI, ET CE QUI NE PART JAMAIS')
    print('═' * 74)
    d, err = banc(FONCTIONS)
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
