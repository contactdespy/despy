#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du suivi à un mois (Privacy Cleanup)
#
# Rien ne faisait jamais passer une demande à « supprimé » : personne ne
# lisait les réponses des annuaires, l'espace client affichait « en cours »
# pour toujours, et la relance promise à 30 jours ne partait pas.
#
# Désormais, un mois après la lettre, on demande au client s'il figure encore
# dans l'annuaire, et c'est sa réponse qui fait avancer la demande. Ce banc
# fait avancer l'horloge et vérifie ce qui peut mal tourner :
#   · interroger trop tôt, ou tous les jours ;
#   · agir parce qu'une messagerie a ouvert le lien toute seule ;
#   · envoyer deux relances pour deux clics ;
#   · écrire une troisième lettre au lieu de dire la vérité au client.
#
# Usage : python3 tests/test_suivi.py
# ════════════════════════════════════════════

import json, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_nettoyage as N

FONCTIONS = N.FONCTIONS
JSC = N.JSC

# Par-dessus le harnais du banc « nettoyage » : une horloge qu'on règle, une
# signature, et un service d'email qu'on peut mettre en panne.
EXTRAS = r"""
var VraiDate = Date, MAINT = '2026-11-01T05:00:00Z';
Date = function (a) { return arguments.length ? new VraiDate(a) : new VraiDate(MAINT); };
Date.now = function () { return new VraiDate(MAINT).getTime(); };
Date.UTC = VraiDate.UTC; Date.prototype = VraiDate.prototype;

var RESEND_KO = false, fetch0 = fetch;
fetch = function (url, opts) {
  if (RESEND_KO && url === 'https://api.resend.com/emails') return Promise.resolve(reponse(500));
  return fetch0(url, opts);
};

var require0 = require;
require = function (nom) {
  if (nom === 'crypto') return { createHmac: function (alg, secret) {
    var s = '';
    return { update: function (x) { s = String(x); return this; },
             digest: function () { var h = 5381, t = secret + '|' + s, out = '';
               for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
               for (var j = 0; j < 8; j++) { h = ((h * 1103515245) + 12345) >>> 0; out += ('00000000' + h.toString(16)).slice(-8); }
               return out; } };
  } };
  return require0(nom);
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
  return function () { remettre(); RESEND_KO = false; MAINT = T0; HORLOGE = T0;
    return Promise.resolve().then(f).catch(function (e) {
      R.push({ nom: nom, ok: false, attendu: '—', obtenu: 'EXCEPTION ' + (e && e.message || e) }); }); };
}

var T0   = '2026-11-01T05:00:00Z';     // les lettres partent
var J20  = '2026-11-21T08:00:00Z';
var J31  = '2026-12-02T08:00:00Z';
var J32  = '2026-12-03T08:00:00Z';
var J64  = '2027-01-04T08:00:00Z';     // un mois après la relance du J32

function dossier(statutDemande) {
  TABLES.privacy_requests.push({ user_email: 'marie@x.fr', prenom: 'Marie', nom: 'Durand', target_email: 'marie@x.fr',
    phone: '0601020304', ville: 'Strasbourg', activated_at: '2026-06-01T10:00:00Z', status: statutDemande || 'in_progress' });
}
function ligne(id, broker, quand, statut) {
  TABLES.privacy_dispatch_log.push({ id: id, user_email: 'marie@x.fr', broker_id: broker, broker_name: 'x', status: statut || 'sent', sent_at: quand });
}
function statuts() { var o = {}; TABLES.privacy_dispatch_log.forEach(function (l) { o[l.id + ':' + l.broker_id] = l.status; }); return o; }
function passage() { return require('./privacy-suivi').handler({ planifie: true, body: '{}' }); }
function auClient() { return MAILS.filter(function (m) { return m.to === 'marie@x.fr'; }); }
function auxAnnuaires() { return MAILS.filter(function (m) { return /solocal|groupe-pratique/.test(m.to); }); }
function clic(methode, id, rep, faux) {
  var S = require('./_privacy-suivi');
  var u = S.lienReponse('https://despy.fr', 'marie@x.fr', id, rep), q = {};
  u.split('?')[1].split('&').forEach(function (p) { var kv = p.split('='); q[kv[0]] = decodeURIComponent(kv[1]); });
  if (faux) q.k = 'abcdef0123456789abcdef01';
  return require('./privacy-suivi-reponse').handler({ httpMethod: methode, queryStringParameters: q, headers: {} });
}
function espace() {
  return require('./privacy-status').handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { email: 'marie@x.fr' } })
    .then(function (r) { return JSON.parse(r.body); });
}

Promise.resolve()
  // ── Quand poser la question ─────────────────────────────────────────────
  .then(etape('à 20 jours : aucune question', function () {
    dossier(); ligne(1, 'solocal', T0); MAINT = J20;
    return passage().then(function () { note('à 20 jours : aucune question', { emails: 0, statut: 'sent' },
      { emails: MAILS.length, statut: statuts()['1:solocal'] }); }); }))

  .then(etape('à 31 jours : une question, avec où vérifier et deux boutons', function () {
    dossier(); ligne(1, 'solocal', T0); ligne(2, '118000', T0); MAINT = J31;
    return passage().then(function () {
      var m = auClient()[0] || { html: '' };
      note('à 31 jours : une question, avec où vérifier et deux boutons',
        { emails: 1, statuts: { '1:solocal': 'asked', '2:118000': 'asked' }, pagesblanches: true, le118000: true, boutons: 4 },
        { emails: MAILS.length, statuts: statuts(),
          pagesblanches: /pagesjaunes\.fr\/pagesblanches/.test(m.html), le118000: /annuaire\.118000\.fr/.test(m.html),
          boutons: (m.html.match(/privacy-suivi-reponse\?/g) || []).length }); }); }))

  .then(etape('le lendemain : pas de rappel', function () {
    dossier(); ligne(1, 'solocal', T0); MAINT = J31;
    return passage().then(function () { MAILS = []; MAINT = J32; return passage(); })
      .then(function () { note('le lendemain : pas de rappel', 0, MAILS.length); }); }))

  .then(etape('lettre partie à l\'ancienne adresse : pas de question', function () {
    dossier(); ligne(1, 'solocal', '2026-07-15T09:00:00Z'); MAINT = J31;
    return passage().then(function () { note('lettre partie à l\'ancienne adresse : pas de question', 0, MAILS.length); }); }))

  .then(etape('service annulé par le client : pas de question', function () {
    dossier('cancelled'); ligne(1, 'solocal', T0); MAINT = J31;
    return passage().then(function () { note('service annulé par le client : pas de question', 0, MAILS.length); }); }))

  .then(etape('email non parti : la question repart le lendemain', function () {
    dossier(); ligne(1, 'solocal', T0); MAINT = J31; RESEND_KO = true;
    var avant;
    return passage().then(function () { avant = statuts()['1:solocal']; RESEND_KO = false; MAILS = []; MAINT = J32; return passage(); })
      .then(function () { note('email non parti : la question repart le lendemain',
        { apresPanne: 'sent', lendemain: 1, statut: 'asked' },
        { apresPanne: avant, lendemain: auClient().length, statut: statuts()['1:solocal'] }); }); }))

  // ── La réponse du client ────────────────────────────────────────────────
  .then(etape('ouvrir le lien ne fait rien : il faut confirmer', function () {
    dossier(); ligne(1, 'solocal', T0, 'asked'); MAINT = J32;
    return clic('GET', 1, 'encore').then(function (r) {
      note('ouvrir le lien ne fait rien : il faut confirmer',
        { statut: 200, formulaire: true, emails: 0, etat: 'asked', lignes: 1 },
        { statut: r.statusCode, formulaire: /<form method="POST"/.test(r.body), emails: MAILS.length,
          etat: statuts()['1:solocal'], lignes: TABLES.privacy_dispatch_log.length }); }); }))

  .then(etape('« je n\'y suis plus » : supprimé dans l\'espace client', function () {
    dossier(); ligne(1, 'solocal', T0, 'asked'); MAINT = J32;
    return clic('POST', 1, 'ok').then(function () { return espace(); }).then(function (e) {
      note('« je n\'y suis plus » : supprimé dans l\'espace client',
        { etat: 'confirmed', affiche: 'supprime', lettres: 0 },
        { etat: statuts()['1:solocal'], affiche: (e.items[0] || {}).status, lettres: auxAnnuaires().length }); }); }))

  .then(etape('« j\'y suis encore » : une relance, à la bonne adresse', function () {
    dossier(); ligne(1, 'solocal', T0, 'asked'); MAINT = J32; HORLOGE = J32;
    return clic('POST', 1, 'encore').then(function () {
      var l = auxAnnuaires()[0] || { sujet: '', html: '', reply_to: [] };
      note('« j\'y suis encore » : une relance, à la bonne adresse',
        { vers: ['dpo@solocal.com'], relance: true, datePremiere: true, reponse: ['contact@despy.fr', 'marie@x.fr'], nouvelle: 'reminded' },
        { vers: auxAnnuaires().map(function (m) { return m.to; }), relance: /^RELANCE/.test(l.sujet),
          datePremiere: /01\/11\/2026/.test(l.html), reponse: [].concat(l.reply_to).sort(),
          nouvelle: (TABLES.privacy_dispatch_log[1] || {}).status }); }); }))

  .then(etape('deux clics : une seule relance', function () {
    dossier(); ligne(1, 'solocal', T0, 'asked'); MAINT = J32; HORLOGE = J32;
    return clic('POST', 1, 'encore').then(function () { return clic('POST', 1, 'encore'); }).then(function (r) {
      note('deux clics : une seule relance', { lettres: 1, lignes: 2, dejaPris: true },
        { lettres: auxAnnuaires().length, lignes: TABLES.privacy_dispatch_log.length, dejaPris: /déjà pris en compte/.test(r.body) }); }); }))

  .then(etape('relance sans effet : la CNIL, jamais une troisième lettre', function () {
    dossier(); ligne(1, 'solocal', T0, 'asked'); ligne(2, 'solocal', J32, 'reminded'); MAINT = J64;
    var question;
    return passage().then(function () { question = { emails: auClient().length, etat: statuts()['2:solocal'] }; MAILS = [];
        return clic('POST', 2, 'encore'); })
      .then(function () { return espace(); }).then(function (e) {
        var m = auClient()[0] || { html: '' };
        note('relance sans effet : la CNIL, jamais une troisième lettre',
          { question: { emails: 1, etat: 'asked_again' }, lettres: 0, cnil: true, deuxDates: true, etat: 'cnil', affiche: 'action' },
          { question: question, lettres: auxAnnuaires().length, cnil: /cnil\.fr\/fr\/plaintes/.test(m.html),
            deuxDates: /01\/11\/2026/.test(m.html) && /03\/12\/2026/.test(m.html),
            etat: statuts()['2:solocal'], affiche: (e.items[0] || {}).status }); }); }))

  .then(etape('signature fausse : refusé, rien ne bouge', function () {
    dossier(); ligne(1, 'solocal', T0, 'asked'); MAINT = J32;
    return clic('POST', 1, 'encore', true).then(function (r) {
      note('signature fausse : refusé, rien ne bouge', { statut: 403, emails: 0, etat: 'asked' },
        { statut: r.statusCode, emails: MAILS.length, etat: statuts()['1:solocal'] }); }); }))

  .then(etape('dossier incomplet : pas de lettre devinée, l\'équipe est prévenue', function () {
    TABLES.privacy_requests.push({ user_email: 'marie@x.fr', prenom: 'Marie', nom: 'Durand', target_email: 'marie@x.fr', phone: '', ville: 'Strasbourg', activated_at: '2026-06-01T10:00:00Z' });
    ligne(1, 'solocal', T0, 'asked'); MAINT = J32;
    return clic('POST', 1, 'encore').then(function () {
      note('dossier incomplet : pas de lettre devinée, l\'équipe est prévenue', { lettres: 0, alerte: 1 },
        { lettres: auxAnnuaires().length, alerte: MAILS.filter(function (m) { return m.to === 'contact.despy@gmail.com'; }).length }); }); }))

  // ── L'espace client ─────────────────────────────────────────────────────
  .then(etape('espace client : une ligne par annuaire, et plus d\'annuaire retiré', function () {
    dossier(); ligne(1, 'solocal', '2026-07-15T09:00:00Z'); ligne(2, '118218', '2026-07-15T09:00:00Z'); ligne(3, 'solocal', T0);
    return espace().then(function (e) {
      note('espace client : une ligne par annuaire, et plus d\'annuaire retiré',
        [{ name: 'PagesJaunes · PagesBlanches · 118 712', status: 'encours' }],
        e.items.map(function (i) { return { name: i.name, status: i.status }; })); }); }))

  .then(function () { print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""


def banc(dossier):
    src = N.HARNAIS.replace('__DIR__', json.dumps(dossier)) + '\n' + EXTRAS + '\n' + VERIF
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
    print("UN MOIS APRÈS LA LETTRE : QUI REÇOIT QUOI, ET CE QUE FAIT UN CLIC")
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
