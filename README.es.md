# CMS-OS

Un sistema de operaciones de contenido nativo para agentes de IA y negocios de múltiples categorías.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS gestiona en una sola plataforma la información corporativa, la contratación, las relaciones públicas, las relaciones con inversores, los blogs y los portales de proveedores. Los agentes de IA pueden proponer temas, planificar por posición, redactar, editar, traducir, verificar hechos, auditar SEO, solicitar aprobación y publicar mediante API y MCP.

CMS-OS se desarrolla actualmente como software de código abierto.

## Funciones principales

- Propuestas de temas, planificación por rol, borradores, edición final, traducción, verificación de hechos y auditorías SEO con IA
- Permisos por rol y categoría para `user`, `orderer`, `provider` y `recruiter`
- Portales de proveedores y guías externas para categorías como servicios jurídicos, profesionales, belleza y contratación
- Revisión, aprobación, publicación, retirada y versiones de contenido
- Gestión de imágenes, vídeo y PDF con texto alternativo, datos estructurados, enlaces internos y auditorías SEO
- Generación de sitios estáticos mediante BuilderOS Adapter y publicación en Cloudflare Pages
- Portal Planning Agent para generar intenciones de búsqueda, propuestas de contenido y páginas SEO por tema, región y audiencia
- Todas las operaciones disponibles mediante REST API y MCP, con OpenAPI como contrato principal
- Webhooks firmados, secrets cifrados, outbox de entregas y reintentos con backoff exponencial
- Trabajos asíncronos de creación de contenido, estado de trabajos, ejecución desde planificadores externos y claves de idempotencia

## Roles y vistas por categoría

| Rol | Visibilidad y acciones principales |
|---|---|
| Usuario | Contenido público, guías, proveedores públicos y consultas |
| Ordenante | Búsqueda de proveedores, solicitudes, estado de solicitudes e información del comprador |
| Proveedor | Sus fichas, ofertas, consultas, candidatos, contenidos de IA y flujo de publicación |
| Reclutador | Búsqueda de empleos, candidaturas, estado e historial personal |

La visibilidad y los permisos se definen por categoría. No se exponen datos de otra categoría o proveedor.

## Flujo de contenido

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

El contenido generado por IA pasa por verificación, revisión y aprobación antes de publicarse. La información sensible, como IR y asuntos legales, conserva sus fuentes y el historial de verificación.

## API / MCP

CMS-OS ofrece sus operaciones mediante REST versionado y MCP. Autenticación, contenidos, medios, publicación, portales, webhooks y SEO comparten los mismos servicios de dominio, con pruebas de paridad para entradas, permisos y resultados.

- OpenAPI: [`docs/openapi.json`](docs/openapi.json)
- Especificación API/MCP: [`docs/API-MCP.md`](docs/API-MCP.md)
- Registro de categorías: [`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- Persistencia: [`docs/STORAGE.md`](docs/STORAGE.md)

## Publicación estática

CMS-OS convierte el contenido aprobado en HTML, CSS, JavaScript, medios y JSON-LD estáticos mediante BuilderOS Adapter, y puede publicarlo en Cloudflare Pages.

## Desarrollo

Requisito: Node.js 22 o posterior

```bash
npm ci
npm test
npm run dev
```

Consulta [`CONTRIBUTING.md`](CONTRIBUTING.md) para las reglas de desarrollo.

## Licencia

La licencia se decidirá cuando finalice la política de desarrollo de código abierto.
