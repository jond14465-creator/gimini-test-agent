# gimini-test-agent

Agent OSINT CLI minimaliste pour collecter des informations publiques sur un domaine, une organisation ou un pseudo.

## Fonctionnalités

- détection simple du type de cible (`domain`, `username`, `keyword`)
- collecte multi-source via API publiques
- garde-fous basiques contre les requêtes manifestement sensibles
- sortie texte ou JSON
- tests unitaires sans dépendance externe

## Sources interrogées

- Google DNS over HTTPS
- crt.sh
- GitHub Search API
- Wikipedia FR
- Hacker News Algolia API

## Utilisation

```bash
npm test
npm start -- example.com
node src/index.js --json --type username octocat
```

## Exemple de sortie

```text
Cible: example.com
Type: domain
Sources utiles: 3/5
Résultats: 7
```

## Limites

- uniquement des sources publiques
- dépend de la disponibilité réseau des API distantes
- ne contourne ni authentification ni restriction d’accès

## Usage responsable

Cet outil doit être utilisé uniquement dans un cadre légal et sur des informations librement accessibles au public.