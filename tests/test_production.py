#!/usr/bin/env python3
# ════════════════════════════════════════════
# DESPY — Qu'est-ce qui est RÉELLEMENT vivant en production ?
#
# Les autres bancs lisent le code. Celui-ci ne lit rien : il frappe à la porte
# de chaque fonction en ligne et regarde qui répond.
#
# Pourquoi ce banc existe : les pannes les plus longues du service n'étaient
# visibles NI dans le code (chaque moitié était correcte), NI dans les logs
# (le code n'était jamais atteint). La vérification des fuites a été morte
# deux mois et demi derrière un 403 de Netlify. Les tables d'alertes
# n'existaient pas alors que le code écrivait dedans depuis des mois.
#
# La seule question qui les aurait révélées : « est-ce que NOTRE code répond,
# oui ou non ? »
#   • une réponse JSON, même un refus (401, 400) → notre code s'exécute ✔
#   • 403 avec un corps vide  → Netlify bloque au bord (fonction planifiée)
#   • 404                      → la fonction n'existe pas
#   • 502 / 500 sans JSON      → elle plante au chargement (import cassé…)
#
# Aucun effet de bord : on envoie un corps VIDE. Sans email, sans action et
# sans jeton, chaque fonction s'arrête à sa première validation. Rien n'est
# envoyé, rien n'est écrit, rien n'est facturé.
#
# Usage : python3 tests/test_production.py [https://despy.fr]
# ════════════════════════════════════════════

import io, json, os, sys, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONCTIONS = os.path.join(RACINE, 'netlify', 'functions')
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://despy.fr').rstrip('/')

# Les crons : Netlify les bloque au bord par construction, et c'est VOULU.
# On les interroge quand même, pour vérifier que le blocage est bien là — un
# cron devenu joignable publiquement, c'est un envoi de masse à la demande.
from importlib import util as _u
_spec = _u.spec_from_file_location(
    'tfa', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'test_fonctions_appelables.py'))
_tfa = _u.module_from_spec(_spec)
_spec.loader.exec_module(_tfa)
PLANIFIEES = _tfa.fonctions_planifiees()


def frapper(nom):
    """Un POST au corps vide. Renvoie (statut, corps, json?)."""
    req = urllib.request.Request(
        '%s/.netlify/functions/%s' % (BASE, nom),
        data=b'{}',
        headers={'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            corps = r.read(4000).decode('utf-8', 'replace')
            statut = r.status
    except urllib.error.HTTPError as e:
        corps = e.read(4000).decode('utf-8', 'replace')
        statut = e.code
    except Exception as e:
        return (0, str(e)[:80], False)
    try:
        json.loads(corps)
        est_json = True
    except Exception:
        est_json = False
    return (statut, corps, est_json)


def est_module(nom):
    """Un fichier sans `handler` n'est pas un endpoint : c'est une bibliothèque
    requise par d'autres fonctions (training-templates, par exemple). Il DOIT
    être injoignable — et son 404 est une réussite, pas une panne."""
    src = io.open(os.path.join(FONCTIONS, nom + '.js'), encoding='utf-8').read()
    return 'exports.handler' not in src and 'handler:' not in src


def a_nous(corps):
    """La réponse vient-elle de NOTRE code ? Toutes nos fonctions ne parlent
    pas JSON : celles qu'on ouvre depuis un lien d'email (désabonnement,
    confirmation, validation d'un test) renvoient une page HTML, et c'est
    normal. Ce qui les distingue d'une erreur de plateforme, c'est qu'elles
    portent notre nom ; les refus de Netlify, eux, ont un corps vide ou une
    ligne de texte brut."""
    t = corps.lower()
    return 'despy' in t or 'lang="fr"' in t


def verdict(nom, statut, corps, est_json):
    """Ce que la réponse prouve. (ok, phrase)"""
    if statut == 0:
        return (False, 'injoignable : %s' % corps)

    if nom in PLANIFIEES:
        # Attendu : bloqué au bord. Le contraire est un trou de sécurité.
        if statut == 403 and not corps.strip():
            return (True, 'cron correctement bloqué au bord')
        return (False, 'CRON JOIGNABLE PUBLIQUEMENT (HTTP %d) — déclenchable '
                       'par n\'importe qui' % statut)

    if est_module(nom):
        if statut == 404 or (est_json and statut < 500):
            return (True, 'module partagé, non exposé')
        return (False, 'module partagé JOIGNABLE (HTTP %d)' % statut)

    # Fonction de fond Netlify : elle accuse réception en 202 et travaille après.
    if nom.endswith('-background'):
        if statut == 202:
            return (True, 'fonction de fond, acceptée (202)')
        return (False, 'fonction de fond : HTTP %d au lieu de 202' % statut)

    if statut == 404:
        return (False, 'HTTP 404 — la fonction n\'existe pas en ligne')
    if statut >= 500:
        return (False, 'HTTP %d — la fonction plante : %s'
                       % (statut, corps.strip()[:60] or '(corps vide)'))
    # Un refus MOTIVÉ prouve que notre code s'est exécuté, et c'est tout ce
    # qu'on cherche ici : « email manquant », « signature Stripe absente »,
    # « session expirée » sont des réussites. Netlify, lui, refuse sans un mot :
    # 403 au corps vide pour un cron, 404 pour une fonction absente. C'est ce
    # SILENCE qui est le signal — pas le code de statut.
    if not corps.strip():
        return (False, 'HTTP %d au corps VIDE — refus muet, notre code n\'a '
                       'probablement jamais tourné' % statut)
    quoi = 'JSON' if est_json else ('page Despy' if a_nous(corps) else 'refus motivé')
    return (True, 'HTTP %d, %s' % (statut, quoi))


def main():
    endpoints = sorted(f[:-3] for f in os.listdir(FONCTIONS)
                       if f.endswith('.js') and not f.startswith('_'))

    print('═' * 78)
    print('LES %d FONCTIONS DE %s' % (len(endpoints), BASE))
    print('═' * 78)
    print('  Un corps vide : rien n\'est envoyé, rien n\'est écrit.')
    print()

    with ThreadPoolExecutor(max_workers=8) as ex:
        reponses = list(ex.map(frapper, endpoints))

    morts, crons_ouverts, vivants = [], [], []
    for nom, (statut, corps, est_json) in zip(endpoints, reponses):
        ok, phrase = verdict(nom, statut, corps, est_json)
        if ok:
            vivants.append(nom)
        elif 'CRON JOIGNABLE' in phrase:
            crons_ouverts.append((nom, phrase))
        else:
            morts.append((nom, phrase))

    print('  %-5s %d fonctions répondent normalement' % ('OK', len(vivants)))
    for nom, phrase in crons_ouverts + morts:
        print('  ÉCHEC %-28s %s' % (nom, phrase))

    print()
    print('═' * 78)
    print('LES DONNÉES QUE L\'APPLI AFFICHE')
    print('═' * 78)
    # Un tableau vide et une table absente se ressemblent comme deux gouttes
    # d'eau. C'est ce qui a fait afficher « Aucune alerte en cours. Tant
    # mieux ! » en permanence pendant des mois.
    ok_data = True
    try:
        with urllib.request.urlopen(
                '%s/.netlify/functions/list-alerts' % BASE, timeout=20) as r:
            d = json.loads(r.read().decode('utf-8'))
        alertes = d.get('alerts') or d.get('alertes') or []
        n = len(alertes)
        if n == 0:
            print('  ÉCHEC list-alerts renvoie 0 alerte — indiscernable d\'une '
                  'table absente')
            ok_data = False
        else:
            print('  OK    list-alerts renvoie %d alerte(s)' % n)
            for a in alertes[:3]:
                print('        · %-22s %s' % ((a.get('source') or '?')[:22],
                                              (a.get('title') or '')[:44]))
    except Exception as e:
        print('  ÉCHEC list-alerts : %s' % str(e)[:70])
        ok_data = False

    ok = not morts and not crons_ouverts and ok_data
    print()
    print('RÉSULTAT : ' + ('tout répond.' if ok
                           else 'au moins un contrôle a échoué.'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
