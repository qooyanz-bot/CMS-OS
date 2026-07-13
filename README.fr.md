# CMS-OS

Une plateforme de contenu d’entreprise native pour les agents d’IA.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS gère les informations d’entreprise, le recrutement, les relations publiques, les relations investisseurs et les blogs dans une seule plateforme. Les agents d’IA assistent la planification, les propositions, les brouillons, la vérification des faits, la réécriture finale, l’optimisation SEO et la publication statique.

CMS-OS est un projet open source actuellement en phase initiale de développement.

## Objectif de CMS-OS

CMS-OS est conçu pour des agents d’IA capables de comprendre les informations d’entreprise vérifiées et les règles de marque. Selon l’objectif, le public, le secteur, la région et le poste, les agents proposent et produisent des contenus prêts à être relus et publiés.

## Fonctionnalités principales

- Proposition de thèmes, briefs, plans, brouillons et textes finalisés par l’IA
- Contenus de recrutement adaptés à chaque poste
- Gestion des contenus PR, IR, Blog, entreprise et médias
- Vérification des faits à partir des données et sources approuvées
- Titres SEO, descriptions, liens internes, FAQ et données structurées
- Historique des versions, validations, journaux d’audit et publication planifiée
- Génération de HTML statique et publication sur Cloudflare Pages

Les agents d’IA assistent l’équipe éditoriale. Les contenus sensibles, notamment l’IR, les informations juridiques, les rémunérations et les données des dirigeants, nécessitent une validation humaine.

## API/MCP en priorité

Toutes les opérations de CMS-OS doivent être exécutables par une API versionnée ou par MCP. Aucune opération métier ne doit être disponible uniquement dans l’interface d’administration.

| Domaine | Couverture API et MCP |
|---|---|
| Contenu | Créer, consulter, modifier, supprimer, rechercher, versionner, traduire, archiver |
| Édition IA | Proposer, rédiger, reformuler, vérifier les faits, résumer, traduire, auditer le SEO |
| Workflow | Relire, approuver, rejeter, planifier, retirer de la publication |
| Médias | Enregistrer, consulter, transformer et gérer les métadonnées de droits |
| SEO | Métadonnées, canonical, données structurées, sitemap, robots et audit des liens |
| Publication | Construire, prévisualiser, publier, consulter l’état, restaurer une version |
| Exploitation | Tâches, nouvelles tentatives, webhooks, permissions, paramètres de tenant et audits |

L’API repose sur REST/JSON versionné et OpenAPI. Les outils MCP utilisent les mêmes services de domaine que l’API et ne dupliquent pas la logique métier. L’interface, les agents d’IA, la CLI et BuilderOS Adapter sont tous des clients API/MCP.

## Publication statique avec Cloudflare Pages

CMS-OS génère le HTML, le CSS, le JavaScript, les images et le JSON-LD statiques à partir des contenus approuvés, puis les publie sur Cloudflare Pages via BuilderOS Adapter.

L’API CMS, l’administration et le traitement IA restent séparés du site public statique afin de privilégier la rapidité, le SEO, la disponibilité et un faible coût d’exploitation.

## Orientation open source

CMS-OS vise à devenir une base open source collaborative pour créer, approuver, publier et réutiliser les contenus d’entreprise.

Le projet privilégie les faits vérifiés, la traçabilité des productions IA, la validation humaine, l’auditabilité, le SEO, l’accessibilité, la diffusion statique et l’extensibilité indépendante des fournisseurs.

## État du développement

L’ordre prévu est le suivant :

1. Contrats API/MCP et modèles de contenu
2. Contenus Blog, recrutement et PR
3. Éditeur Tiptap
4. Agents IA de planification, rédaction et réécriture finale
5. Audits SEO et génération de données structurées
6. Workflows de validation
7. Génération de HTML statique
8. Publication Cloudflare Pages via BuilderOS Adapter
9. Workflows IR et distribution externe

## Politique de traduction

`README.md` est le document source en japonais. Chaque mise à jour du README doit être répercutée dans les versions anglaise, chinoise simplifiée, espagnole, coréenne, allemande et française dans le même changement. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

La licence sera choisie après la finalisation de la politique initiale de développement.

