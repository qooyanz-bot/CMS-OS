import { randomUUID } from "node:crypto";
import { ContentService } from "./content-service.js";
import type { PortalService } from "./portal-service.js";
import type { AuthenticatedPrincipal, ContentRecord, PublicationBuildResult } from "../domain/types.js";

export class PublicationServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "PublicationServiceError";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      output.push(`<p>${paragraph.map((line) => escapeHtml(line)).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      output.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);
    const quote = line.match(/^>\s+(.+)$/);
    if (heading && heading[1] && heading[2]) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      output.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
    } else if (item && item[1]) {
      flushParagraph();
      list.push(item[1]);
    } else if (quote && quote[1]) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${escapeHtml(quote[1])}</blockquote>`);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return output.join("\n");
}

function normalizeBaseUrl(value: string | undefined): string {
  const candidate = (value?.trim() || process.env.PUBLIC_BASE_URL || "https://example.com").replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PublicationServiceError(400, "baseUrlは有効なURLで指定してください。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PublicationServiceError(400, "baseUrlはhttpまたはhttpsで指定してください。");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

function routeFor(content: ContentRecord): string {
  const route = content.seo.canonicalPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return route || `content/${content.slug}`;
}

function pageHtml(content: ContentRecord, baseUrl: string): string {
  const canonical = absoluteUrl(baseUrl, `/${routeFor(content)}/`);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": content.seo.jsonLdType,
    headline: content.title,
    name: content.title,
    description: content.summary,
    url: canonical,
    datePublished: content.createdAt,
    dateModified: content.updatedAt,
    inLanguage: "ja-JP",
    about: content.audience,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(content.seo.title)}</title>
    <meta name="description" content="${escapeHtml(content.seo.description)}">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeHtml(content.seo.ogTitle)}">
    <meta property="og:description" content="${escapeHtml(content.seo.ogDescription)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta name="twitter:card" content="summary">
    <link rel="stylesheet" href="/assets/cms-os.css">
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body>
    <main class="page-shell">
      <p class="eyebrow">CMS-OS / ${escapeHtml(content.contentType)}</p>
      <article>
        <header class="article-header">
          <h1>${escapeHtml(content.title)}</h1>
          <p class="summary">${escapeHtml(content.summary)}</p>
          <p class="meta">更新日: ${escapeHtml(content.updatedAt.slice(0, 10))}</p>
        </header>
        <div class="article-body">${renderMarkdown(content.body)}</div>
      </article>
    </main>
  </body>
</html>`;
}

function rootHtml(contents: ContentRecord[], baseUrl: string): string {
  const links = contents.map((content) => {
    const url = absoluteUrl(baseUrl, `/${routeFor(content)}/`);
    return `<li><a href="${escapeHtml(url)}">${escapeHtml(content.title)}</a><span>${escapeHtml(content.summary)}</span></li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CMS-OS公開サイト</title>
    <meta name="description" content="CMS-OSで管理された公開コンテンツ一覧です。">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="${escapeHtml(`${baseUrl}/`)}">
    <link rel="stylesheet" href="/assets/cms-os.css">
  </head>
  <body>
    <main class="page-shell">
      <p class="eyebrow">CMS-OS / Published content</p>
      <h1>公開コンテンツ</h1>
      <ul class="content-index">${links}</ul>
    </main>
  </body>
</html>`;
}

const css = `:root{color-scheme:light;--ink:#17202a;--muted:#64748b;--line:#dbe3ea;--accent:#0f766e}*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.8}.page-shell{max-width:820px;margin:0 auto;padding:64px 24px}.eyebrow{color:var(--accent);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.article-header{border-bottom:1px solid var(--line);margin-bottom:32px;padding-bottom:24px}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.2;margin:0 0 16px}.summary{color:#334155;font-size:1.12rem}.meta{color:var(--muted);font-size:.86rem}.article-body h2{border-left:4px solid var(--accent);padding-left:12px;margin-top:40px}.article-body h3{margin-top:28px}.article-body blockquote{border-left:3px solid var(--line);color:var(--muted);margin:24px 0;padding-left:16px}.article-body li{margin:6px 0}.content-index{list-style:none;margin:32px 0;padding:0}.content-index li{border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:4px;padding:18px 0}.content-index a{color:var(--accent);font-size:1.15rem;font-weight:700}.content-index span{color:var(--muted)}`;

function sitemapXml(contents: ContentRecord[], baseUrl: string): string {
  const urls = contents.map((content) => `  <url><loc>${escapeHtml(absoluteUrl(baseUrl, `/${routeFor(content)}/`))}</loc><lastmod>${escapeHtml(content.updatedAt)}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${escapeHtml(`${baseUrl}/`)}</loc></url>\n${urls}\n</urlset>\n`;
}

function llmsText(contents: ContentRecord[], baseUrl: string): string {
  const pages = contents.map((content) => `- [${content.title}](${absoluteUrl(baseUrl, `/${routeFor(content)}/`)}): ${content.summary}`).join("\n");
  return `# CMS-OS公開コンテンツ\n\n> 承認済みコンテンツの機械可読インデックスです。\n\n## Pages\n${pages}\n`;
}

export class PublicationService {
  public constructor(
    private readonly portal: PortalService,
    private readonly content: ContentService,
  ) {}

  public build(
    principal: AuthenticatedPrincipal | null,
    contentIds?: string[],
    requestedBaseUrl?: string,
  ): PublicationBuildResult {
    if (!principal) throw new PublicationServiceError(401, "ログインが必要です。");
    const baseUrl = normalizeBaseUrl(requestedBaseUrl);
    const contents = contentIds && contentIds.length > 0
      ? contentIds.map((contentId) => this.content.getContent(principal, contentId))
      : this.content.listContent(principal);
    if (contents.length === 0) throw new PublicationServiceError(400, "公開対象のコンテンツがありません。");

    for (const item of contents) {
      this.portal.assertAction(principal, item.category, "publication.build");
      if (item.status !== "approved" && item.status !== "published") {
        throw new PublicationServiceError(409, `コンテンツ「${item.title}」は承認前のため公開できません。`);
      }
    }

    const files = [
      { path: "index.html", contentType: "text/html; charset=utf-8", content: rootHtml(contents, baseUrl) },
      { path: "assets/cms-os.css", contentType: "text/css; charset=utf-8", content: css },
      ...contents.map((content) => ({
        path: `${routeFor(content)}/index.html`,
        contentType: "text/html; charset=utf-8",
        content: pageHtml(content, baseUrl),
      })),
      { path: "sitemap.xml", contentType: "application/xml; charset=utf-8", content: sitemapXml(contents, baseUrl) },
      { path: "robots.txt", contentType: "text/plain; charset=utf-8", content: `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n` },
      { path: "llms.txt", contentType: "text/plain; charset=utf-8", content: llmsText(contents, baseUrl) },
    ];

    return {
      publicationId: `publication-${randomUUID()}`,
      baseUrl,
      contentIds: contents.map((content) => content.id),
      generatedAt: new Date().toISOString(),
      files,
    };
  }
}
