# CMS-OS

Una plataforma empresarial de contenidos nativa para agentes de IA.

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OS gestiona en una sola plataforma la información corporativa, la contratación, las relaciones públicas, las relaciones con inversores y los blogs. Los agentes de IA ayudan con la planificación, las propuestas, los borradores, la verificación de hechos, la edición final, la optimización SEO y la publicación estática.

CMS-OS es un proyecto de código abierto en una fase inicial de desarrollo.

## Objetivo

CMS-OS está diseñado para agentes de IA que entienden la información corporativa verificada y las directrices de marca. Según el objetivo, la audiencia, el sector, la región y el puesto, los agentes proponen y generan contenidos listos para revisión y publicación.

## Capacidades principales

- Propuestas de temas, briefs, estructuras, borradores y textos finales generados por IA
- Contenido de contratación adaptado a cada puesto
- Gestión de contenidos de PR, IR, Blog, empresa y recursos multimedia
- Verificación de hechos basada en datos corporativos y fuentes aprobadas
- Títulos SEO, descripciones, enlaces internos, preguntas frecuentes y datos estructurados
- Historial de versiones, aprobaciones, auditoría y publicación programada
- Generación de HTML estático y publicación en Cloudflare Pages

Los agentes de IA ayudan al equipo editorial. No pueden omitir la aprobación humana para contenidos sensibles como IR, información legal, remuneraciones o datos de directivos.

## API/MCP como principio fundamental

Todas las operaciones de CMS-OS deben poder ejecutarse mediante una API versionada o MCP. No debe existir ninguna operación de negocio que solo pueda realizarse desde la interfaz de administración.

| Área | Cobertura de API y MCP |
|---|---|
| Contenido | Crear, consultar, actualizar, eliminar, buscar, versionar, traducir y archivar |
| Edición con IA | Proponer, redactar, pulir, verificar hechos, resumir, traducir y auditar SEO |
| Flujo de trabajo | Revisar, aprobar, rechazar, programar y retirar publicación |
| Multimedia | Registrar, consultar, transformar y gestionar metadatos de derechos |
| SEO | Metadatos, canonical, datos estructurados, sitemap, robots y auditoría de enlaces |
| Publicación | Compilar, previsualizar, publicar, consultar estado y revertir |
| Operaciones | Trabajos, reintentos, webhooks, permisos, configuración de tenants y auditoría |

La API se basa en REST/JSON versionado y OpenAPI. Las herramientas MCP llaman a los mismos servicios de dominio que la API y no duplican la lógica de negocio. La interfaz, los agentes de IA, la CLI y BuilderOS Adapter son clientes de API/MCP.

## Publicación estática en Cloudflare Pages

CMS-OS genera HTML, CSS, JavaScript, imágenes y JSON-LD estáticos a partir del contenido aprobado y los publica mediante BuilderOS Adapter en Cloudflare Pages.

Este diseño separa la API, la administración y el procesamiento de IA del sitio público estático para priorizar velocidad, SEO, disponibilidad y bajo coste operativo.

## Dirección del proyecto OSS

CMS-OS aspira a ser una base de código abierto colaborativa para crear, aprobar, publicar y reutilizar contenidos empresariales.

El proyecto prioriza los hechos verificables, la trazabilidad de la salida de IA, la aprobación humana, la auditoría, el SEO, la accesibilidad, la entrega estática y la extensibilidad independiente de proveedores.

## Estado de desarrollo

El orden previsto es:

1. Contratos API/MCP y modelos de contenido
2. Contenidos de Blog, contratación y PR
3. Editor Tiptap
4. Agentes de IA para planificación, borradores y edición final
5. Auditorías SEO y datos estructurados
6. Flujos de aprobación
7. Generación de HTML estático
8. Publicación en Cloudflare Pages mediante BuilderOS Adapter
9. Flujos de IR y distribución externa

## Política de traducción

`README.md` es el documento fuente en japonés. Cada actualización del README debe actualizar también, en el mismo cambio, las versiones en inglés, chino simplificado, español, coreano, alemán y francés. Consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

La licencia se decidirá cuando se finalice la política inicial de desarrollo.

