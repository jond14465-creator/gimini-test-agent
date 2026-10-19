# Audit initial — gimini-test-agent et PR nº 1

Date : 2026-10-19. Révision examinée : `65378cf55e92f17a8fbe129640a3ba7b157ab607`.
La PR nº 1 (`copilot/code-osint-agent`) est fusionnée dans `main`.
Tous les fichiers applicatifs et les tests ont été lus avant modification.
Ce document décrit un audit technique ; ce n'est pas une certification de sécurité.

## État observé

Application CommonJS Node.js sans dépendances : CLI, API HTTP locale, neuf
fournisseurs publics, rapports texte/JSON. Les sources désactivées figurent aussi
dans le rapport. Les données ne sont pas persistées. L'exécution est un agrégateur
déterministe, sans modèle IA ni orchestration LangGraph/Agents SDK.

## Validation

`npm test` : **14 tests réussis sur 14**, après autorisation réseau nécessaire
à l'écoute HTTP locale dans cet environnement. Le premier essai restreint échouait
sur `listen EPERM`, sans démontrer une régression applicative.
Les appels fournisseurs sont simulés : disponibilité réelle et quotas non testés.
Un contrôle complémentaire a confirmé qu'un type `invalid` et une limite `-1`
sont acceptés directement par `runOsintAgent`; cinq requêtes simulées sont lancées.
Un fetch simulé qui ne termine jamais garde le traitement en attente ; lecture du
code confirme l'absence de timeout/AbortSignal.

## Écarts et priorités

| Priorité | Observation | Conséquence / correction proposée |
| --- | --- | --- |
| P1 | `src/agent.js` ne borne pas la durée de fetch/lecture JSON | Une source bloquée retient tout `Promise.all`; annulation et délai total par source |
| P1 | `src/server.js` valide la limite mais pas le type/format avant collecte | Options invalides acceptées; validation commune avant tout accès réseau |
| P1 | L'API accepte des requêtes concurrentes sans limite applicative | Surconsommation possible si exposée; conserver localhost, ajouter quotas avant exposition |
| P1 | `.gitignore` ignore `.env` uniquement | `.env.local` peut être ajouté par inadvertance; ignorer les variantes et préserver un exemple sans secrets |
| P2 | Pas de déduplication ni de provenance par observation | Ajouter identifiants stables, URL source, horodatage de collecte et hash du contenu |
| P2 | Tout résultat est présenté comme un résultat, sans vérification | Distinguer observation, corroboration et inférence; aucune identité déduite d'un pseudo seul |
| P2 | JSON malformé toléré partiellement, pas de schéma strict | Rejeter les enregistrements incomplets; distinguer erreur fournisseur et résultat vide |
| P2 | Résultats plafonnés à cinq en amont malgré une limite autorisée de dix | Documenter ou harmoniser la pagination et la limite effective |
| P2 | Détection de domaines à suffixes peu courants ambiguë | Permettre le type explicite et documenter l'heuristique |
| P2 | Pas d'historique, de graphe, de timeline ni de journal durable | Introduire une mémoire et des rapports reproductibles |
| P3 | URL du dépôt dans package.json pointe vers localhost | Remplacer par l'URL GitHub canonique |

Les expressions régulières des garde-fous constituent un filtre lexical limité,
pas une validation juridique ou une garantie de respect de la vie privée.
La présence d'un résultat sur plusieurs plateformes ne prouve pas l'identité d'une personne.

## Plan d'intégration

1. **Fiabiliser le socle existant** : délais, validation commune, protection des
   fichiers secrets, tests de non-régression. Conserver CLI et API compatibles.
2. **Structurer les preuves** : contrats de données versionnés, source, date,
   empreinte, déduplication, statuts de vérification et journal d'exécution.
3. **Ajouter l'orchestrateur Python demandé**, séparé de l'application Node :
   LangGraph pour les transitions recherche → collecte → analyse → vérification
   → mémoire → rapport ; Agents SDK pour l'analyse bornée avec sorties structurées.
   Le collecteur Node reste réutilisable via son contrat JSON. Vérifier les API
   officielles et verrouiller les versions lors de l'intégration.
4. **Firecrawl** : recherche et collecte limitées par budget/pages/domaines;
   contenu web traité comme données non fiables, jamais comme instructions.
5. **Airtable** : tables Runs, Sources, Observations, Claims et EvidenceLinks;
   upsert par identifiant stable, lots bornés et reprise après erreur. Aucune
   fusion d'identités sur simple ressemblance de nom.
6. **Rapports** : Markdown/JSON, graphe des relations avec preuves, timeline
   distinguant date de l'événement et date de collecte, limites et contradictions.
7. **Vérification complète** : doubles de fournisseurs puis essai réel borné,
   quotas, erreurs 429, interruption, reprise et documentation locale.

## Dépendances opérationnelles

La création sécurisée d'une clé OpenAI a échoué dans cet environnement : aucun
utilitaire local fourni par le plugin n'a été trouvé. La clé exposée précédemment
ne doit pas être utilisée. Les accès runtime Firecrawl et la base Airtable de
destination restent à configurer; les connecteurs de cette conversation ne
constituent pas automatiquement des identifiants disponibles pour l'application.
Le déploiement ou l'exposition publique exige la validation humaine prévue par
le plan utilisateur. Aucune publication ni écriture Airtable pendant cet audit.
