# gimini-test-agent

Agent OSINT CLI minimaliste pour collecter des informations publiques sur un domaine, une organisation ou un pseudo.

## Fonctionnalités

- détection simple du type de cible (`domain`, `username`, `keyword`)
- collecte multi-source via API publiques
- nouvelles sources publiques : RDAP, Wayback Machine, GitHub Users, npm
- garde-fous basiques contre les requêtes manifestement sensibles
- sortie texte ou JSON
- preuves dédupliquées avec provenance, empreintes et journal d'exécution
- sauvegarde locale JSON/Markdown, graphe et chronologie (`--output reports`)
- exposition en API HTTP
- tests unitaires sans dépendance externe

## Sources interrogées

- Google DNS over HTTPS
- RDAP
- crt.sh
- Wayback Machine
- GitHub Search API
- GitHub Users Search API
- Wikipedia FR
- Hacker News Algolia API
- npm Search API

## Utilisation

```bash
npm test
npm start -- example.com
node src/index.js --json --type username octocat
npm start -- --json --output reports --type domain example.com
npm run api -- --port 3000
```

### API HTTP

```bash
npm run api -- --port 3000
curl "http://127.0.0.1:3000/health"
curl "http://127.0.0.1:3000/osint?target=example.com"
curl "http://127.0.0.1:3000/osint?target=octocat&type=username&format=text"
```

Routes :

- `GET /health`
- `GET /osint?target=<cible>&type=domain|username|keyword&limit=1..10&format=json|text`

## Exemple de sortie

```text
Cible: example.com
Type: domain
Sources utiles: 3/5
Résultats: 7
```

## Limites

- délai maximal de 10 secondes par source, y compris la lecture du JSON ;
  une source en échec reste signalée dans le rapport
- types, limites et formats invalides rejetés avant la collecte
- prototype déterministe : intégrations IA, Firecrawl, Airtable et vérification
  croisée à implémenter (voir `docs/AUDIT.md` et `docs/EVIDENCE.md`)
- uniquement des sources publiques
- dépend de la disponibilité réseau des API distantes
- ne contourne ni authentification ni restriction d’accès
- l’API HTTP n’accepte que des requêtes `GET`

## Usage responsable

Cet outil doit être utilisé uniquement dans un cadre légal et sur des informations librement accessibles au public.
