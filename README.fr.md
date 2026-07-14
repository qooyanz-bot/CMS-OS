# CMS-OS

Un système de gestion de contenu natif pour les agents IA et les entreprises multi-catégories.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS gère sur une seule plateforme les informations d’entreprise, le recrutement, les relations publiques, les relations investisseurs, les blogs et les portails de prestataires. Les agents IA peuvent proposer des sujets, planifier par position, rédiger et réviser, traduire, vérifier les faits, auditer le SEO, demander une validation et publier via l’API et MCP.

CMS-OS est actuellement développé comme logiciel open source.

## Fonctionnalités principales

- Propositions de sujets, planification par rôle, brouillons, révision, traduction, vérification des faits et audits SEO assistés par IA
- Autorisations par rôle et par catégorie pour `user`, `orderer`, `provider` et `recruiter`
- Portails de prestataires et guides externes pour les catégories juridiques, professionnelles, beauté et recrutement
- Relecture, validation, publication, dépublication et historique des versions
- Gestion des images, vidéos et PDF avec texte alternatif, données structurées, liens internes et audits SEO
- Génération de sites statiques avec BuilderOS Adapter et publication sur Cloudflare Pages
- Toutes les opérations via REST API et MCP, avec OpenAPI comme contrat de référence
- Webhooks signés, secrets chiffrés, outbox de livraison et nouvelles tentatives avec backoff exponentiel

## Rôles et vues par catégorie

| Rôle | Visibilité et actions principales |
|---|---|
| Utilisateur | Contenu public, guides, prestataires publics et demandes |
| Donneur d’ordre | Recherche de prestataires, demandes, état des demandes et informations d’acheteur |
| Prestataire | Fiches propres, offres, demandes, candidats, contenus IA et workflow de publication |
| Recruteur | Recherche d’emplois, candidatures, état et historique personnel |

La visibilité et les actions sont définies par catégorie. Les données d’une autre catégorie ou d’un autre prestataire ne sont pas exposées.

## Workflow de contenu

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

Les contenus générés par IA passent par la vérification des faits, la relecture et la validation avant publication. Les contenus sensibles, notamment IR et juridiques, conservent leurs sources et leur historique de vérification.

## API / MCP

CMS-OS expose ses opérations via des API REST versionnées et MCP. L’authentification, les contenus, les médias, la publication, les portails, les webhooks et les audits SEO utilisent les mêmes services métier, avec des tests de parité sur les entrées, les droits et les résultats.

- OpenAPI : [`docs/openapi.json`](docs/openapi.json)
- Spécification API/MCP : [`docs/API-MCP.md`](docs/API-MCP.md)
- Registre des catégories : [`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- Persistance : [`docs/STORAGE.md`](docs/STORAGE.md)

## Publication statique

CMS-OS convertit le contenu approuvé en HTML, CSS, JavaScript, médias et JSON-LD statiques via BuilderOS Adapter, puis peut le publier sur Cloudflare Pages.

## Développement

Pré-requis : Node.js 22 ou plus récent

```bash
npm ci
npm test
npm run dev
```

Consultez [`CONTRIBUTING.md`](CONTRIBUTING.md) pour les règles de développement.

## Licence

La licence sera définie après la finalisation de la politique de développement open source.
