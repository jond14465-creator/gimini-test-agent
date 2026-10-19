# Preuves et rapports locaux — schéma 1.1

Le rapport JSON conserve `target`, `type`, `summary`, `sources` et `disclaimer`.
Il ajoute `schemaVersion`, `run`, `observations`, `graph`, `timeline` et `journal`.

Chaque observation possède un identifiant SHA-256 de l'URL normalisée et de
l'empreinte du titre/extrait. Le hash porte sur ces deux champs collectés, pas sur
la page distante complète. Les fragments et paramètres de suivi connus sont
retirés des URL ; les paramètres métier sont conservés. Des extraits différents
sur la même URL restent des observations distinctes, y compris contradictoires.

Une observation regroupe les provenances des fournisseurs qui ont retourné
exactement ce contenu. Chaque provenance contient fournisseur, URL de requête et
date de collecte. Cette agrégation ne garantit pas l'indépendance des sources.
Le statut reste `unverified` : aucune validation factuelle automatisée n'est revendiquée.

Le graphe relie requête, observations et fournisseurs. Ces liens sont des liens
de recherche et de provenance, jamais des identités ou des relations prouvées.
La timeline utilise `collectedAt`; `eventAt` reste null en l'absence de date
d'événement explicitement validée. Une erreur de fournisseur marque le run
`partial`, même si d'autres sources ont répondu.

## Sauvegarde

```bash
npm start -- --json --output reports --type domain example.com
```

Sous Node.js 24, si l'environnement exige un proxy HTTP configuré dans les
variables standard, préfixer la commande par `NODE_USE_ENV_PROXY=1`.

Un sous-dossier portant l'UUID de l'exécution contient :

- `report.json` : rapport intégral, données historiques et observations normalisées ;
- `report.md` : synthèse avec graphe Mermaid et chronologie des collectes ;
- `graph.json` : graphe exploitable par un autre outil ;
- `journal.jsonl` : événements structurés de l'exécution.

Les fichiers sont préparés dans un dossier temporaire puis renommés. Une
exécution déjà sauvegardée n'est pas remplacée. Les nouveaux dossiers ont le mode
0700 et les fichiers 0600 sous Unix. `reports/` est ignoré par Git ; un autre
emplacement doit être protégé par l'utilisateur. Le rapport peut contenir des
informations personnelles publiques et doit avoir une politique de conservation
adaptée. Aucun effacement automatique ni envoi distant n'est activé.

Les preuves normalisées rejettent les entrées sans titre, extrait textuel ou URL
HTTP(S) valide, ainsi que les URL contenant des identifiants. Ces entrées restent
dans `sources` pour compatibilité et diagnostic ; `rejectedFindings` les compte.
`totalFindings` conserve son sens historique (résultats bruts),
`uniqueObservations` compte les preuves dédupliquées, et `duplicateFindings` les
répétitions valides retirées.

## Suite du plan

La CLI Node constitue une mémoire locale par exécution. Le pipeline Python
ajoute maintenant LangGraph, Agents SDK, Firecrawl et Airtable ; voir
`INTEGRATIONS.md`. La validation factuelle indépendante et les essais réels
des services authentifiés restent à effectuer.

## Validation du 19 octobre 2026

25 tests automatisés réussis. Essai réel borné sur `example.com` sous Node.js 24
avec prise en compte du proxy : 18 observations, cinq sources répondantes,
crt.sh en erreur HTTP 502 et Wayback interrompu après dix secondes. Le run est
marqué `partial` et les quatre artefacts sont sauvegardés. Ce contrôle ne valide
ni l'exactitude factuelle des observations ni la disponibilité future des sources.
