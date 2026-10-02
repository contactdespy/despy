#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Banc d'essai du nettoyage de données (Privacy Cleanup)
#
# Ce service envoie des lettres juridiques au nom de clients. Pendant des
# mois, il a fait moins que ce qu'il annonçait, sans que rien ne le montre :
#   · quatre destinataires sur sept dépendaient d'un email interne « 4
#     formulaires à faire » que personne n'a jamais reçu ;
#   · deux des trois lettres automatiques partaient à une adresse que
#     l'annuaire ne désigne pas pour ce type de demande ;
#   · un des sept (annuaire.com) n'existait plus.
#
# Ce banc fait tourner les VRAIS fichiers sur une fausse base et un faux
# service d'email, et vérifie ce qui compte : à QUI part chaque lettre, et
# qu'elle ne part ni zéro fois ni deux.
#
# Usage : python3 tests/test_nettoyage.py
# ════════════════════════════════════════════

import json, os, re, subprocess, sys, tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
JSC = ('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A'
       '/Helpers/jsc')

HARNAIS = r"""
var DIR = __DIR__;
var console = { log: function(){}, warn: function(){}, error: function(){} };
var process = { env: { URL: 'https://despy.fr', INTERNAL_SECRET: 's', RESEND_API_KEY: 'r',
  BRAVE_SEARCH_KEY: 'b', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' } };
var setTimeout = function (f) { f(); return 0; };

// L'horloge de la base : date posée sur chaque ligne du journal à l'insertion.
// Le banc ne dépend donc pas du jour où on le lance.
var HORLOGE = '2026-11-01T05:00:00Z';
var AVANT   = '2026-07-15T09:00:00Z';     // avant la correction des adresses

var TABLES, PANNE, MAILS, SCANS, FOND_STATUT;
function remettre() {
  TABLES = { privacy_requests: [], privacy_dispatch_log: [], privacy_findings: [] };
  PANNE = {}; MAILS = []; SCANS = []; FOND_STATUT = 202;
}
function copie(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

function Q(table) {
  var filtres = [], op = 'select', seul = false, charge = null, compte = false;
  var q = {};
  q.select = function (cols, opts) { if (opts && opts.head) compte = true; return q; };
  q.eq  = function (c, v) { filtres.push(function (r) { return r[c] === v; }); return q; };
  q.in  = function (c, vs) { filtres.push(function (r) { return vs.indexOf(r[c]) >= 0; }); return q; };
  q.order = q.limit = function () { return q; };
  q.maybeSingle = q.single = function () { seul = true; return q; };
  q.insert = function (p) { op = 'insert'; charge = p; return q; };
  q.update = function (p) { op = 'update'; charge = p; return q; };
  q.then = function (ok, ko) {
    var rep, T = TABLES[table] || (TABLES[table] = []);
    if (PANNE[table]) rep = { data: null, error: { message: 'panne ' + table } };
    else if (op === 'insert') {
      var l = copie(charge);
      if (table === 'privacy_dispatch_log' && !l.sent_at) l.sent_at = HORLOGE;
      l.id = T.length + 1; T.push(l);
      rep = { data: seul ? { id: l.id } : [l], error: null };
    } else if (op === 'update') {
      T.forEach(function (r) { if (filtres.every(function (f) { return f(r); })) for (var k in charge) r[k] = charge[k]; });
      rep = { data: null, error: null };
    } else {
      var lignes = T.filter(function (r) { return filtres.every(function (f) { return f(r); }); }).map(copie);
      rep = compte ? { count: lignes.length, data: null, error: null }
                   : { data: seul ? (lignes[0] || null) : lignes, error: null };
    }
    return Promise.resolve(rep).then(ok, ko);
  };
  return q;
}

function reponse(statut, corps) {
  return { ok: statut >= 200 && statut < 300, status: statut,
    json: function () { return Promise.resolve(corps || {}); },
    text: function () { return Promise.resolve(JSON.stringify(corps || {})); } };
}

function fetch(url, opts) {
  if (url === 'https://api.resend.com/emails') {
    var m = JSON.parse(opts.body);
    MAILS.push({ to: m.to[0], reply_to: m.reply_to, sujet: m.subject, html: m.html });
    return Promise.resolve(reponse(200, { id: 'x' }));
  }
  var fn = (url.match(/\/\.netlify\/functions\/([a-z-]+)/) || [])[1];
  if (fn === 'privacy-scan-background') { SCANS.push(JSON.parse(opts.body).user_email); return Promise.resolve(reponse(202)); }
  if (fn === 'privacy-recheck-background' && FOND_STATUT !== 202) return Promise.resolve(reponse(FOND_STATUT));
  if (fn === 'privacy-dispatch' || fn === 'privacy-recheck-background') {
    return require('./' + fn).handler({ httpMethod: 'POST', headers: opts.headers || {}, body: opts.body })
      .then(function (r) { var c = {}; try { c = JSON.parse(r.body); } catch (e) {} return reponse(r.statusCode, c); });
  }
  return Promise.resolve(reponse(200));
}

var CACHE = {};
function require(nom) {
  if (nom === '@supabase/supabase-js') return { createClient: function () { return { from: Q }; } };
  if (nom === './_auth') return { requireAuth: function () { return { ok: true }; },
                                  rateLimit: function () { return true; } };
  if (nom === './_is-scheduled') return { isScheduled: function (e) { return !!(e && e.planifie); },
                                          notScheduled: function () { return { statusCode: 200, body: '{"skipped":"not_scheduled"}' }; } };
  if (nom.indexOf('./') === 0) {
    var k = nom.slice(2).replace(/\.js$/, '');
    if (CACHE[k]) return CACHE[k].exports;
    var m = { exports: {} };
    CACHE[k] = m;
    (new Function('require', 'module', 'exports', 'process', 'console', 'fetch', 'setTimeout', read(DIR + '/' + k + '.js')))
      (require, m, m.exports, process, console, fetch, setTimeout);
    return m.exports;
  }
  throw new Error('module inattendu : ' + nom);
}
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
  return function () { remettre(); return Promise.resolve().then(f).catch(function (e) {
    R.push({ nom: nom, ok: false, attendu: '—', obtenu: 'EXCEPTION ' + (e && e.message || e) }); }); };
}
function tri(a) { return a.slice().sort(); }

var CLIENT = { user_email: 'marie@x.fr', prenom: 'Marie', nom: 'Durand', target_email: 'marie@x.fr',
               phone: '0601020304', ville: 'Strasbourg', activated_at: '2026-06-01T10:00:00Z' };
var BONNES = ['dpo@118218.fr', 'dpo@solocal.com', 'privacy@groupe-pratique.com'];
function lettres() { return MAILS.filter(function (m) { return /Article 17/.test(m.sujet); }); }
function destinataires() { return tri(lettres().map(function (m) { return m.to; })); }
function envoyer(c, secret) {
  return require('./privacy-dispatch').handler({ httpMethod: 'POST',
    headers: { 'x-internal-secret': secret === undefined ? 's' : secret }, body: JSON.stringify(c) });
}
function journal(ids, quand) {
  ids.forEach(function (id) { TABLES.privacy_dispatch_log.push({ user_email: 'marie@x.fr', broker_id: id, sent_at: quand }); });
}

Promise.resolve()
  // ── Premier envoi ───────────────────────────────────────────────────────
  .then(etape('nouveau client : 3 lettres, aux adresses officielles', function () {
    return envoyer(CLIENT).then(function (r) {
      note('nouveau client : 3 lettres, aux adresses officielles',
        { statut: 200, vers: BONNES, journal: 3 },
        { statut: r.statusCode, vers: destinataires(), journal: TABLES.privacy_dispatch_log.length }); }); }))

  .then(etape('la lettre à Solocal nomme 118712.fr', function () {
    return envoyer(CLIENT).then(function () {
      var l = lettres().filter(function (m) { return m.to === 'dpo@solocal.com'; })[0] || { html: '' };
      note('la lettre à Solocal nomme 118712.fr',
        { pagesjaunes: true, le118712: true },
        { pagesjaunes: /pagesjaunes\.fr/.test(l.html), le118712: /118712\.fr/.test(l.html) }); }); }))

  .then(etape('la réponse de l\'annuaire arrive au client ET à Despy', function () {
    return envoyer(CLIENT).then(function () {
      note('la réponse de l\'annuaire arrive au client ET à Despy',
        [['contact@despy.fr', 'marie@x.fr'], ['contact@despy.fr', 'marie@x.fr'], ['contact@despy.fr', 'marie@x.fr']],
        lettres().map(function (m) { return tri([].concat(m.reply_to)); })); }); }))

  .then(etape('le client reçoit le chemin pour Google et Infobel', function () {
    return envoyer(CLIENT).then(function () {
      var m = MAILS.filter(function (x) { return x.to === 'marie@x.fr' && !/Article 17/.test(x.sujet); })[0] || { html: '' };
      note('le client reçoit le chemin pour Google et Infobel',
        { google: true, infobel: true, renvoi: false },
        { google: /myactivity\.google\.com\/results-about-you/.test(m.html),
          infobel: /dpo\.infobel\.com/.test(m.html), renvoi: /renvoyons/.test(m.html) }); }); }))

  .then(etape('le mail interne ne demande plus rien', function () {
    return envoyer(CLIENT).then(function () {
      var m = MAILS.filter(function (x) { return x.to === 'contact.despy@gmail.com'; })[0] || { sujet: 'ABSENT', html: '' };
      note('le mail interne ne demande plus rien',
        { formulaires: false, aFaire: false },
        { formulaires: /formulaire/i.test(m.sujet + m.html), aFaire: /à faire à la main|reste à faire/i.test(m.html) }); }); }))

  // ── Ni deux fois, ni zéro ───────────────────────────────────────────────
  .then(etape('second appel : plus rien ne part, aucun email', function () {
    return envoyer(CLIENT).then(function () { MAILS = []; return envoyer(CLIENT); }).then(function (r) {
      note('second appel : plus rien ne part, aucun email',
        { statut: 200, emails: 0, journal: 3 },
        { statut: r.statusCode, emails: MAILS.length, journal: TABLES.privacy_dispatch_log.length }); }); }))

  .then(etape('client d\'avant la correction : tout repart, et on le lui dit', function () {
    journal(['solocal', '118218', '118000'], AVANT);
    return envoyer(CLIENT).then(function () {
      var m = MAILS.filter(function (x) { return x.to === 'marie@x.fr' && !/Article 17/.test(x.sujet); })[0] || { html: '' };
      note('client d\'avant la correction : tout repart, et on le lui dit',
        { vers: BONNES, renvoi: true }, { vers: destinataires(), renvoi: /renvoyons/.test(m.html) }); }); }))

  .then(etape('une seule lettre manquante : une seule part', function () {
    journal(['solocal', '118000'], HORLOGE); journal(['118218'], AVANT);
    return envoyer(CLIENT).then(function () {
      note('une seule lettre manquante : une seule part', ['dpo@118218.fr'], destinataires()); }); }))

  .then(etape('journal illisible : on n\'envoie rien plutôt que risquer le doublon', function () {
    PANNE.privacy_dispatch_log = true;
    return envoyer(CLIENT).then(function (r) {
      note('journal illisible : on n\'envoie rien plutôt que risquer le doublon',
        { statut: 503, lettres: 0 }, { statut: r.statusCode, lettres: lettres().length }); }); }))

  .then(etape('informations corrigées par le client : tout repart', function () {
    journal(['solocal', '118218', '118000'], HORLOGE);
    var c = copie(CLIENT); c.force = true; c.phone = '0699999999';
    return envoyer(c).then(function () {
      var l = lettres();
      note('informations corrigées par le client : tout repart',
        { vers: BONNES, nouveauNumero: true },
        { vers: destinataires(), nouveauNumero: l.length > 0 && l.every(function (m) { return /0699999999/.test(m.html); }) }); }); }))

  .then(etape('sans le secret interne : refusé, rien ne part', function () {
    return envoyer(CLIENT, 'faux').then(function (r) {
      note('sans le secret interne : refusé, rien ne part', { statut: 401, emails: 0 },
           { statut: r.statusCode, emails: MAILS.length }); }); }))

  // ── L'activation ────────────────────────────────────────────────────────
  .then(etape('réactivation sans changement : pas de seconde salve', function () {
    var h = require('./privacy-request').handler;
    var ev = function (c) { return { httpMethod: 'POST', headers: {}, body: JSON.stringify(c) }; };
    var n1, n2;
    return h(ev(CLIENT)).then(function () { n1 = lettres().length; return h(ev(CLIENT)); })
      .then(function () { n2 = lettres().length;
        var c = copie(CLIENT); c.phone = '0611111111'; return h(ev(c)); })
      .then(function () {
        note('réactivation sans changement : pas de seconde salve',
          { premiere: 3, memeInfos: 3, numeroChange: 6 },
          { premiere: n1, memeInfos: n2, numeroChange: lettres().length }); }); }))

  // ── Le passage mensuel ──────────────────────────────────────────────────
  .then(etape('passage mensuel : chacun reçoit ce qui lui manque, pas plus', function () {
    var base = { prenom: 'P', nom: 'N', phone: '06', ville: 'V', status: 'in_progress', activated_at: '2026-06-01T10:00:00Z' };
    function demande(mail, plus) { var d = copie(base); d.user_email = mail; d.target_email = mail; for (var k in (plus || {})) d[k] = plus[k]; TABLES.privacy_requests.push(d); }
    demande('jamais@x.fr');                               // jamais traité
    demande('ajour@x.fr');                                // tout est parti, à la bonne adresse
    demande('ancien@x.fr');                               // parti avant la correction
    demande('incomplet@x.fr', { phone: '' });             // ancien formulaire
    demande('annule@x.fr', { status: 'cancelled' });
    ['solocal', '118218', '118000'].forEach(function (id) {
      TABLES.privacy_dispatch_log.push({ user_email: 'ajour@x.fr', broker_id: id, sent_at: HORLOGE });
      TABLES.privacy_dispatch_log.push({ user_email: 'ancien@x.fr', broker_id: id, sent_at: AVANT });
    });
    return require('./privacy-recheck').handler({ planifie: true, body: '{}' }).then(function () {
      var par = {};
      lettres().forEach(function (m) { var c = [].concat(m.reply_to).filter(function (a) { return a !== 'contact@despy.fr'; })[0].split('@')[0];
        par[c] = (par[c] || 0) + 1; });
      note('passage mensuel : chacun reçoit ce qui lui manque, pas plus',
        { lettres: { jamais: 3, ancien: 3 }, recherches: ['ajour@x.fr', 'ancien@x.fr', 'incomplet@x.fr', 'jamais@x.fr'] },
        { lettres: par, recherches: tri(SCANS) }); }); }))

  .then(etape('passage mensuel appelé par URL, sans planification : rien', function () {
    TABLES.privacy_requests.push({ user_email: 'jamais@x.fr', prenom: 'P', nom: 'N', target_email: 'j@x.fr', phone: '06', ville: 'V' });
    return require('./privacy-recheck').handler({ body: '{}' }).then(function () {
      return require('./privacy-recheck-background').handler({ httpMethod: 'POST', headers: {}, body: '{}' }); })
      .then(function (r) {
        note('passage mensuel appelé par URL, sans planification : rien',
          { statut: 401, emails: 0 }, { statut: r.statusCode, emails: MAILS.length }); }); }))

  .then(etape('passage mensuel qui ne démarre pas : un email le dit', function () {
    FOND_STATUT = 500;
    return require('./privacy-recheck').handler({ planifie: true, body: '{}' }).then(function () {
      note('passage mensuel qui ne démarre pas : un email le dit', 1,
        MAILS.filter(function (m) { return m.to === 'contact.despy@gmail.com' && /non lancé/.test(m.sujet); }).length); }); }))

  // ── La liste elle-même ──────────────────────────────────────────────────
  .then(etape('chaque adresse porte sa source officielle et sa date', function () {
    var B = require('./_privacy-brokers');
    note('chaque adresse porte sa source officielle et sa date', [],
      B.EMAIL_BROKERS.filter(function (b) {
        return !(/^[^@\s]+@[^@\s]+\.[a-z]+$/.test(b.email) && /^https:\/\//.test(b.source || '') &&
                 /^\d{4}-\d{2}-\d{2}$/.test(b.verifie || '') && !isNaN(new Date(b.depuis).getTime()));
      }).map(function (b) { return b.id; })); }))

  .then(function () { print(JSON.stringify(R)); })
  .catch(function (e) { print(JSON.stringify({ erreur: String(e && e.message || e) })); });
"""

# Ce qui ne doit plus apparaître nulle part : un annuaire disparu, une
# catégorie de tâches manuelles, et les anciennes adresses.
BANNIS = [
    (r'annuaire\.com', "annuaire.com n'existe plus (annuaire d'entreprises)"),
    (r'FORM_BROKERS', 'la catégorie « formulaire à remplir par l\'équipe » est supprimée'),
    (r'formulaires? à faire', 'plus aucune tâche manuelle dans un email interne'),
    (r'service-client@118218\.fr', "ancienne adresse 118 218 (la bonne : dpo@118218.fr)"),
    (r'contact@118000\.fr', "ancienne adresse 118 000 (la bonne : privacy@groupe-pratique.com)"),
]


def banc(dossier):
    src = HARNAIS.replace('__DIR__', json.dumps(dossier)) + '\n' + VERIF
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


def relecture():
    print()
    print('═' * 74)
    print('RIEN DE PÉRIMÉ DANS LE CODE NI SUR LA PAGE')
    print('═' * 74)
    fautes = []
    cibles = [os.path.join(FONCTIONS, n) for n in sorted(os.listdir(FONCTIONS)) if n.endswith('.js')]
    cibles += [os.path.join(RACINE, n) for n in ('index.html', 'despy_app_v23.html')]
    for chemin in cibles:
        s = open(chemin, encoding='utf-8').read()
        # Les commentaires peuvent raconter l'histoire ; le code et le texte, non.
        if chemin.endswith('.js'):
            s = re.sub(r'//[^\n]*', '', s)
        else:
            s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
        for motif, raison in BANNIS:
            if re.search(motif, s):
                fautes.append('%s : %s' % (os.path.basename(chemin), raison))
    # La page ne doit pas présenter comme envoyé par Despy ce que seul le client peut faire.
    page = open(os.path.join(RACINE, 'index.html'), encoding='utf-8').read()
    if re.search(r'envoie[^.]{0,260}(Infobel|à Google)', re.sub(r'<[^>]+>', '', page)):
        fautes.append("index.html : la page dit encore que Despy écrit à Infobel ou à Google")
    for f in fautes:
        print('  ÉCHEC ' + f)
    if not fautes:
        print('  OK    ni annuaire disparu, ni tâche manuelle cachée, ni ancienne adresse')
    return not fautes


def main():
    if not os.path.exists(JSC):
        sys.exit('ERREUR : JavaScriptCore introuvable — test impossible')
    print('═' * 74)
    print('À QUI PART CHAQUE LETTRE, ET COMBIEN DE FOIS')
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
    ok = relecture() and ok
    print()
    print('TOUT EST BON' if ok else 'IL Y A DES ÉCHECS')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
