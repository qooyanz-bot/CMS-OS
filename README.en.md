# CMS-OS

An AI-agent-native enterprise content platform.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS manages company information, recruitment, PR, IR, and blogs in one platform. AI agents help with planning, proposals, drafting, fact checking, polishing, SEO optimization, and static publishing.

CMS-OS is an open-source project in its early development stage.

## What CMS-OS aims to be

CMS-OS is designed for AI agents that understand verified company information and brand guidelines. Based on the purpose, audience, industry, region, and position, agents propose and produce content that is ready for review and publication.

## Core capabilities

- AI-generated content themes, briefs, outlines, drafts, and polished copy
- Position-aware recruitment content
- PR, IR, blog, company, and media asset management
- Fact checking against approved company data and sources
- SEO titles, descriptions, internal links, FAQs, and structured data
- Version history, approvals, audit logs, and scheduled publishing
- Static HTML generation and Cloudflare Pages publishing

AI agents support the editorial team; they do not bypass human approval for sensitive content such as IR, legal information, compensation, or executive data.

## Industry theme portals

CMS-OS guides visitors to providers by industry theme and changes visible data and actions according to the role: user, orderer, provider, or recruiter. The current themes cover legal services, beauty, generative AI and business transformation, labor shortages and automation, regional tourism and inbound travel, mobility DX and SDV, GX and energy/resource management, and regional revitalization, relocation, and vacant-house reuse.

- User: browse public providers, theme guides, and FAQs
- Orderer: compare providers, create requests, discuss quotes, and review request history
- Provider: manage listings, jobs, inquiries, AI content, SEO, and publishing workflows
- Recruiter: browse jobs and providers, apply, and track applications

The category list and extension procedure are maintained in the [category registry](docs/CATEGORY-REGISTRY.md).

## API/MCP-first

Every CMS-OS operation must be executable through a versioned API or MCP. There must be no business operation that exists only in the administration UI.

| Area | API and MCP coverage |
|---|---|
| Content | Create, read, update, delete, search, version, translate, archive |
| AI editing | Propose, draft, polish, fact check, summarize, translate, SEO audit |
| Workflow | Review, approve, reject, schedule, unpublish |
| Media | Register, retrieve, transform, and manage rights metadata |
| SEO | Metadata, canonical, structured data, sitemap, robots, link audits |
| Publishing | Build, preview, publish, inspect status, rollback |
| Operations | Jobs, retries, webhooks, permissions, tenant settings, audit logs |

The API is based on versioned REST/JSON and OpenAPI. MCP tools call the same domain services as the API and must not duplicate business logic. The administration UI, AI agents, CLI, and BuilderOS Adapter are all API/MCP clients.

## Cloudflare Pages static publishing

CMS-OS generates static HTML, CSS, JavaScript, images, and JSON-LD from approved content and publishes them through the BuilderOS Adapter to Cloudflare Pages.

```text
CMS-OS
  ↓ approved content
Static site build
  ↓
BuilderOS Adapter
  ↓
Cloudflare Pages
```

The CMS API, administration UI, and AI processing remain separate from the public static site. This design targets fast delivery, strong SEO, high availability, and low operating cost.

- [Cloudflare Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Deploying static HTML to Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

## Architecture

- Administration UI: Next.js, React, TypeScript
- Editor: Tiptap
- Database: PostgreSQL
- Authentication and authorization: Auth provider plus row-level access control
- AI integration: provider abstraction for multiple models
- API: versioned REST/JSON and OpenAPI
- MCP: MCP server for CMS, AI editing, SEO, and publishing operations
- Async processing: queue and workflow infrastructure
- Media: object storage
- Publishing: static HTML generation and Cloudflare Pages
- External integration: BuilderOS Adapter

## Open-source direction

CMS-OS aims to become a collaborative open-source foundation for creating, approving, publishing, and reusing enterprise content.

The project prioritizes verified facts, traceable AI output, human approval, auditability, SEO, accessibility, static delivery, and vendor-neutral extensibility.

## Development status

The planned implementation order is:

1. API/MCP contracts and content models
2. Blog, recruitment, and PR content
3. Tiptap editor
4. AI planning, drafting, and polishing agents
5. SEO audits and structured data generation
6. Approval workflows
7. Static HTML generation
8. Cloudflare Pages publishing through BuilderOS Adapter
9. IR workflows and external distribution

## Translation policy

`README.md` is the Japanese source document. Every README change must be reflected in the English, Simplified Chinese, Spanish, Korean, German, and French README files in the same change set. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The license will be selected after the initial development policy is finalized.
