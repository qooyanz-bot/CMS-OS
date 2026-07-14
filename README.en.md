# CMS-OS

An AI-agent-native content operating system for multi-category businesses.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS manages company information, recruiting, PR, IR, blogs, and business-provider portals on one platform. AI agents can propose topics, draft and polish content, translate it, verify facts, audit SEO, request approval, and publish through APIs and MCP.

CMS-OS is currently developed as open-source software.

## Key capabilities

- AI-assisted topic proposals, role-specific planning, drafting, polishing, translation, fact checking, and SEO audits
- Role- and category-aware access for `user`, `orderer`, `provider`, and `recruiter`
- Business-provider portals and external guides for categories such as legal services, professional services, beauty, and recruiting
- Review, approval, publication, unpublication, and version history
- Media management for images, video, and PDF, including alt text, structured data, internal links, and SEO audits
- Static site generation through the BuilderOS Adapter and publication to Cloudflare Pages
- Every operation exposed through REST API and MCP, with OpenAPI as the contract source of truth
- Signed webhooks with encrypted secrets, a delivery outbox, and exponential-backoff retries
- Asynchronous content-creation jobs with job status, external-scheduler execution, and idempotency keys

## Roles and category-aware views

| Role | Main visibility and actions |
|---|---|
| User | Public content, category guides, public providers, and inquiries |
| Orderer | Provider search, service requests, request status, and buyer information |
| Provider | Own listings, jobs, inquiries, applications, AI content, and publication workflow |
| Recruiter | Job search, applications, application status, and personal application history |

Visibility and actions are defined per category. Data belonging to another category or provider is not exposed.

## Content workflow

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

AI output goes through fact checking, review, and approval before publication. Accuracy-sensitive content such as IR and legal information is designed to retain evidence and verification history.

## API / MCP

CMS-OS operations are available through versioned REST APIs and MCP. Authentication, content, media, publication, portals, webhooks, and SEO audits share the same domain services, with parity tests covering inputs, authorization, and results.

- OpenAPI: [`docs/openapi.json`](docs/openapi.json)
- API/MCP specification: [`docs/API-MCP.md`](docs/API-MCP.md)
- Category registry: [`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- Storage specification: [`docs/STORAGE.md`](docs/STORAGE.md)

## Static publishing

CMS-OS converts approved content into static HTML, CSS, JavaScript, media, and JSON-LD through the BuilderOS Adapter, then can publish it to Cloudflare Pages. Operational CMS features and low-cost static delivery remain separate concerns.

## Development

Requirements: Node.js 22 or later

```bash
npm ci
npm test
npm run dev
```

`npm test` builds TypeScript and tests API/MCP parity, authentication, category access control, content, media, publication, webhooks, and persistence.

## Project direction

CMS-OS aims to be a CMS-OS that AI agents can operate safely. Generation, approval, publication, and external integrations should remain verifiable through API/MCP rather than depending on a particular editor or external service. External site construction and publishing are separated into the BuilderOS Adapter.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development rules.

## License

The license will be decided after the open-source development policy is finalized.
