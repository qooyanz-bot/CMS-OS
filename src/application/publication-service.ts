import { randomUUID } from "node:crypto";
import { ContentService } from "./content-service.js";
import type { PortalService } from "./portal-service.js";
import { PublicationStore } from "../domain/publication-store.js";
import type { AuthenticatedPrincipal, CategorySlug, ContentRecord, DirectoryGuide, PublicationBuildResult, PublicationDeploymentRecord, PublicationHistorySummary, VisibleProvider } from "../domain/types.js";
import { BuilderOSAdapter, BuilderOSAdapterError, type CloudflarePagesDeployOptions, type CloudflarePagesDeploymentResult } from "../integrations/builderos-adapter.js";

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

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  return line.includes("|") && tableCells(line).length >= 2;
}

function renderTable(header: string, rows: string[]): string {
  const headerCells = tableCells(header).map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("");
  const bodyRows = rows.map((row) => `<tr>${tableCells(row).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (isTableRow(line) && isTableSeparator(nextLine)) {
      flushParagraph();
      flushList();
      const rows: string[] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        rows.push(lines[index] ?? "");
        index += 1;
      }
      index -= 1;
      output.push(renderTable(line, rows));
      continue;
    }

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

function deploymentRecord(deployment: CloudflarePagesDeploymentResult): PublicationDeploymentRecord {
  return {
    status: deployment.status,
    provider: deployment.provider,
    projectName: deployment.projectName,
    requestId: deployment.requestId,
    fileCount: deployment.fileCount,
    uploadedFileCount: deployment.uploadedFileCount,
    ...(deployment.deploymentId ? { deploymentId: deployment.deploymentId } : {}),
    ...(deployment.deploymentUrl ? { deploymentUrl: deployment.deploymentUrl } : {}),
    ...(deployment.environment ? { environment: deployment.environment } : {}),
  };
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

function routeFor(content: ContentRecord): string {
  const route = content.seo.canonicalPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return route || `content/${content.slug}`;
}

function categoryRoute(category: CategorySlug): string {
  return `categories/${category}`;
}

function providerRoute(category: CategorySlug, providerId: string): string {
  const safeId = providerId.replace(/[^a-zA-Z0-9._~-]/g, "-");
  return `${categoryRoute(category)}/providers/${safeId}`;
}

function relatedContentsFor(content: ContentRecord, contents: ContentRecord[]): ContentRecord[] {
  const keywords = new Set(content.seo.keywords.map((keyword) => keyword.toLocaleLowerCase("ja-JP")).filter(Boolean));
  return contents
    .filter((candidate) => candidate.id !== content.id && candidate.category === content.category)
    .map((candidate) => ({
      candidate,
      score: candidate.seo.keywords.reduce((score, keyword) => score + (keywords.has(keyword.toLocaleLowerCase("ja-JP")) ? 1 : 0), 0),
    }))
    .sort((left, right) => right.score - left.score || right.candidate.updatedAt.localeCompare(left.candidate.updatedAt))
    .slice(0, 4)
    .map(({ candidate }) => candidate);
}

function jsonLdString(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function articleJsonLd(content: ContentRecord, categoryLabel: string, canonical: string): Record<string, unknown> {
  const article: Record<string, unknown> = {
    "@type": content.seo.jsonLdType,
    "@id": `${canonical}#article`,
    headline: content.title,
    name: content.title,
    description: content.summary,
    url: canonical,
    mainEntityOfPage: canonical,
    datePublished: content.createdAt,
    dateModified: content.updatedAt,
    inLanguage: "ja-JP",
    articleSection: categoryLabel,
    keywords: content.seo.keywords,
    isAccessibleForFree: true,
    author: { "@type": "Organization", name: "CMS-OS編集チーム" },
    publisher: { "@type": "Organization", name: "CMS-OS" },
  };
  if (content.seo.jsonLdType === "JobPosting") {
    article.datePosted = content.createdAt;
    article.employmentType = "OTHER";
    article.hiringOrganization = { "@type": "Organization", name: "掲載事業者" };
  }
  return article;
}

function breadcrumbJsonLd(items: Array<{ name: string; url: string }>): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function pageHtml(content: ContentRecord, relatedContents: ContentRecord[], categoryLabel: string, baseUrl: string): string {
  const canonical = absoluteUrl(baseUrl, `/${routeFor(content)}/`);
  const categoryUrl = absoluteUrl(baseUrl, `/${categoryRoute(content.category)}/`);
  const graph: Record<string, unknown>[] = [
    articleJsonLd(content, categoryLabel, canonical),
    breadcrumbJsonLd([
      { name: "ホーム", url: absoluteUrl(baseUrl, "/") },
      { name: categoryLabel, url: categoryUrl },
      { name: content.title, url: canonical },
    ]),
  ];
  if (content.seo.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      mainEntity: content.seo.faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }
  const jsonLd = jsonLdString({ "@context": "https://schema.org", "@graph": graph });
  const relatedLinks = relatedContents.map((related) => `<li><a href="${escapeHtml(absoluteUrl(baseUrl, `/${routeFor(related)}/`))}">${escapeHtml(related.title)}</a><span>${escapeHtml(related.summary)}</span></li>`).join("");
  const faqHtml = content.seo.faq.length > 0
    ? `<section class="faq-section" aria-labelledby="faq-heading"><h2 id="faq-heading">よくある質問</h2>${content.seo.faq.map((item) => `<div class="faq-item"><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p></div>`).join("")}</section>`
    : "";

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(content.seo.title)}</title>
    <meta name="description" content="${escapeHtml(content.seo.description)}">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <meta name="author" content="CMS-OS編集チーム">
    <meta property="og:site_name" content="CMS-OS">
    <meta property="og:locale" content="ja_JP">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <link rel="alternate" hreflang="ja" href="${escapeHtml(canonical)}">
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}">
    <link rel="sitemap" type="application/xml" href="${escapeHtml(absoluteUrl(baseUrl, "/sitemap.xml"))}">
    <meta property="og:type" content="article">
    <meta property="og:title" content="${escapeHtml(content.seo.ogTitle)}">
    <meta property="og:description" content="${escapeHtml(content.seo.ogDescription)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapeHtml(content.seo.ogTitle)}">
    <meta name="twitter:description" content="${escapeHtml(content.seo.ogDescription)}">
    <link rel="stylesheet" href="/assets/cms-os.css">
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body>
    <main class="page-shell">
      <nav class="breadcrumbs" aria-label="パンくず"><ol><li><a href="${escapeHtml(absoluteUrl(baseUrl, "/"))}">ホーム</a></li><li><a href="${escapeHtml(categoryUrl)}">${escapeHtml(categoryLabel)}</a></li><li aria-current="page">${escapeHtml(content.title)}</li></ol></nav>
      <p class="eyebrow">CMS-OS / ${escapeHtml(content.contentType)}</p>
      <article>
        <header class="article-header">
          <h1>${escapeHtml(content.title)}</h1>
          <p class="summary">${escapeHtml(content.summary)}</p>
          <p class="meta"><time datetime="${escapeHtml(content.updatedAt)}">最終更新日: ${escapeHtml(content.updatedAt.slice(0, 10))}</time> · ${escapeHtml(categoryLabel)}</p>
        </header>
        <div class="article-body">${renderMarkdown(content.body)}</div>
        ${faqHtml}
      </article>
      ${relatedContents.length > 0 ? `<section class="related-section" aria-labelledby="related-heading"><h2 id="related-heading">関連する公開情報</h2><ul class="content-index">${relatedLinks}</ul></section>` : ""}
    </main>
  </body>
</html>`;
}

interface PublishedCategory {
  slug: CategorySlug;
  label: string;
}

function rootHtml(contents: ContentRecord[], categories: PublishedCategory[], baseUrl: string): string {
  const categoryLinks = categories.map((category) => {
    const url = absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`);
    return `<li><a href="${escapeHtml(url)}">${escapeHtml(category.label)}</a><span>カテゴリ別の公開情報・事業者案内</span></li>`;
  }).join("\n");
  const contentLinks = contents.map((content) => {
    const url = absoluteUrl(baseUrl, `/${routeFor(content)}/`);
    return `<li><a href="${escapeHtml(url)}">${escapeHtml(content.title)}</a><span>${escapeHtml(content.summary)}</span></li>`;
  }).join("\n");
  const itemList = [
    ...categories.map((category) => ({ name: category.label, url: absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`) })),
    ...contents.map((content) => ({ name: content.title, url: absoluteUrl(baseUrl, `/${routeFor(content)}/`) })),
  ];
  const jsonLd = jsonLdString({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "CMS-OS公開サイト", url: `${baseUrl}/`, inLanguage: "ja-JP" },
      { "@type": "ItemList", name: "CMS-OS公開ページ", itemListElement: itemList.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, url: item.url })) },
    ],
  });
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CMS-OS公開サイト</title>
    <meta name="description" content="CMS-OSで管理されたカテゴリ別の公開情報と事業者案内です。">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <meta property="og:site_name" content="CMS-OS">
    <meta property="og:type" content="website">
    <meta property="og:title" content="CMS-OS公開サイト">
    <meta property="og:description" content="CMS-OSで管理されたカテゴリ別の公開情報と事業者案内です。">
    <meta property="og:url" content="${escapeHtml(`${baseUrl}/`)}">
    <link rel="canonical" href="${escapeHtml(`${baseUrl}/`)}">
    <link rel="alternate" hreflang="ja" href="${escapeHtml(`${baseUrl}/`)}">
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(`${baseUrl}/`)}">
    <link rel="sitemap" type="application/xml" href="${escapeHtml(absoluteUrl(baseUrl, "/sitemap.xml"))}">
    <link rel="stylesheet" href="/assets/cms-os.css">
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body>
    <main class="page-shell">
      <p class="eyebrow">CMS-OS / Published content</p>
      <h1>公開コンテンツ</h1>
      <p class="lead-answer">カテゴリ、事業者、検索意図ごとに整理された公開情報を案内します。</p>
      <h2>カテゴリから探す</h2>
      <ul class="content-index">${categoryLinks}</ul>
      <h2>最新の公開情報</h2>
      <ul class="content-index">${contentLinks || "<li>公開情報は準備中です。</li>"}</ul>
    </main>
  </body>
</html>`;
}

function categoryHtml(category: PublishedCategory, contents: ContentRecord[], providers: VisibleProvider[], guides: DirectoryGuide[], baseUrl: string): string {
  const canonical = absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`);
  const providerUrl = absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/providers/`);
  const contentLinks = contents.map((content) => `<li><a href="${escapeHtml(absoluteUrl(baseUrl, `/${routeFor(content)}/`))}">${escapeHtml(content.title)}</a><span>${escapeHtml(content.summary)}</span></li>`).join("\n");
  const providerLinks = providers.slice(0, 8).map((provider) => `<li><a href="${escapeHtml(absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`))}">${escapeHtml(provider.name)}</a><span>${escapeHtml(provider.location)} · ${escapeHtml(provider.themes.join("・"))}</span></li>`).join("\n");
  const guideLinks = guides.map((guide) => `<li><a href="${escapeHtml(guide.url)}" rel="nofollow noopener noreferrer">${escapeHtml(guide.name)}</a><span>${escapeHtml(guide.description)}</span></li>`).join("\n");
  const itemList = [...contents.map((content) => absoluteUrl(baseUrl, `/${routeFor(content)}/`)), ...providers.map((provider) => absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`))];
  const jsonLd = jsonLdString({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", name: `${category.label}の案内`, description: `${category.label}に関する公開情報と事業者を案内します。`, url: canonical, inLanguage: "ja-JP", isPartOf: { "@type": "WebSite", name: "CMS-OS" } },
      { "@type": "ItemList", name: `${category.label}の公開ページ`, itemListElement: itemList.map((url, index) => ({ "@type": "ListItem", position: index + 1, url })) },
      breadcrumbJsonLd([{ name: "ホーム", url: absoluteUrl(baseUrl, "/") }, { name: category.label, url: canonical }]),
    ],
  });
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(category.label)}の事業者・公開情報案内 | CMS-OS</title>
    <meta name="description" content="${escapeHtml(category.label)}の事業者、テーマ、公開情報をカテゴリ別に案内します。">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <link rel="canonical" href="${escapeHtml(canonical)}"><link rel="alternate" hreflang="ja" href="${escapeHtml(canonical)}"><link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}">
    <link rel="sitemap" type="application/xml" href="${escapeHtml(absoluteUrl(baseUrl, "/sitemap.xml"))}"><link rel="stylesheet" href="/assets/cms-os.css">
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body><main class="page-shell">
    <nav class="breadcrumbs" aria-label="パンくず"><ol><li><a href="${escapeHtml(absoluteUrl(baseUrl, "/"))}">ホーム</a></li><li aria-current="page">${escapeHtml(category.label)}</li></ol></nav>
    <p class="eyebrow">CMS-OS / Category hub</p><h1>${escapeHtml(category.label)}の事業者・公開情報案内</h1>
    <p class="lead-answer">${escapeHtml(category.label)}に関するテーマ、事業者、公開情報を、利用者の検索意図に合わせて整理しています。</p>
    <p><a class="directory-link" href="${escapeHtml(providerUrl)}">事業者一覧を見る（${providers.length}件）</a></p>
    <h2>公開情報</h2><ul class="content-index">${contentLinks || "<li>公開情報は準備中です。</li>"}</ul>
    <h2>注目の事業者</h2><ul class="content-index">${providerLinks || "<li>掲載事業者は準備中です。</li>"}</ul>
    <h2>外部の事業者案内</h2><ul class="content-index">${guideLinks || "<li>外部案内は準備中です。</li>"}</ul>
  </main></body>
</html>`;
}

function visibleProviderFields(provider: VisibleProvider): string {
  return Object.entries(provider)
    .filter(([key]) => !["id", "category", "name", "themes", "location"].includes(key))
    .slice(0, 5)
    .map(([key, value]) => `<li><strong>${escapeHtml(key)}</strong>: ${escapeHtml(Array.isArray(value) ? value.join("・") : String(value))}</li>`)
    .join("");
}

function providerDirectoryHtml(category: PublishedCategory, providers: VisibleProvider[], baseUrl: string): string {
  const canonical = absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/providers/`);
  const links = providers.map((provider) => `<li><a href="${escapeHtml(absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`))}">${escapeHtml(provider.name)}</a><span>${escapeHtml(provider.location)} · ${escapeHtml(provider.themes.join("・"))}</span></li>`).join("\n");
  const jsonLd = jsonLdString({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${category.label}の事業者一覧`,
    url: canonical,
    itemListElement: providers.map((provider, index) => ({ "@type": "ListItem", position: index + 1, url: absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`), name: provider.name })),
  });
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(category.label)}の事業者一覧 | CMS-OS</title><meta name="description" content="${escapeHtml(category.label)}の掲載事業者をテーマ・地域別に案内します。"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><link rel="canonical" href="${escapeHtml(canonical)}"><link rel="stylesheet" href="/assets/cms-os.css"><script type="application/ld+json">${jsonLd}</script></head><body><main class="page-shell"><nav class="breadcrumbs" aria-label="パンくず"><ol><li><a href="${escapeHtml(absoluteUrl(baseUrl, "/"))}">ホーム</a></li><li><a href="${escapeHtml(absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`))}">${escapeHtml(category.label)}</a></li><li aria-current="page">事業者一覧</li></ol></nav><p class="eyebrow">CMS-OS / Provider directory</p><h1>${escapeHtml(category.label)}の事業者一覧</h1><p class="lead-answer">公開情報と掲載条件を確認できる${escapeHtml(category.label)}の事業者を案内します。</p><ul class="content-index">${links || "<li>掲載事業者は準備中です。</li>"}</ul></main></body></html>`;
}

function providerDetailHtml(category: PublishedCategory, provider: VisibleProvider, baseUrl: string): string {
  const canonical = absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`);
  const categoryUrl = absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`);
  const jsonLd = jsonLdString({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: provider.name, url: canonical, address: { "@type": "PostalAddress", addressLocality: provider.location, addressCountry: "JP" }, knowsAbout: provider.themes },
      breadcrumbJsonLd([{ name: "ホーム", url: absoluteUrl(baseUrl, "/") }, { name: category.label, url: categoryUrl }, { name: provider.name, url: canonical }]),
    ],
  });
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(provider.name)} | ${escapeHtml(category.label)} | CMS-OS</title><meta name="description" content="${escapeHtml(provider.name)}の${escapeHtml(category.label)}に関する公開プロフィール、対応テーマ、地域情報です。"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><meta property="og:type" content="profile"><meta property="og:title" content="${escapeHtml(provider.name)}"><meta property="og:description" content="${escapeHtml(provider.themes.join("・"))}"><link rel="canonical" href="${escapeHtml(canonical)}"><link rel="stylesheet" href="/assets/cms-os.css"><script type="application/ld+json">${jsonLd}</script></head><body><main class="page-shell"><nav class="breadcrumbs" aria-label="パンくず"><ol><li><a href="${escapeHtml(absoluteUrl(baseUrl, "/"))}">ホーム</a></li><li><a href="${escapeHtml(categoryUrl)}">${escapeHtml(category.label)}</a></li><li aria-current="page">${escapeHtml(provider.name)}</li></ol></nav><p class="eyebrow">CMS-OS / Provider profile</p><h1>${escapeHtml(provider.name)}</h1><p class="lead-answer">${escapeHtml(provider.name)}は${escapeHtml(category.label)}カテゴリに掲載されている事業者です。対応テーマと公開情報を確認できます。</p><dl class="provider-facts"><dt>対応テーマ</dt><dd>${escapeHtml(provider.themes.join("・"))}</dd><dt>地域</dt><dd>${escapeHtml(provider.location)}</dd></dl>${visibleProviderFields(provider) ? `<h2>公開情報</h2><ul class="provider-facts-list">${visibleProviderFields(provider)}</ul>` : ""}</main></body></html>`;
}

const css = `:root{color-scheme:light;--ink:#17202a;--muted:#64748b;--line:#dbe3ea;--accent:#0f766e}*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.8}.page-shell{max-width:860px;margin:0 auto;padding:48px 24px}.eyebrow{color:var(--accent);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.breadcrumbs{color:var(--muted);font-size:.82rem;margin-bottom:28px}.breadcrumbs ol{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}.breadcrumbs li:not(:last-child)::after{content:"/";margin-left:8px;color:#94a3b8}.breadcrumbs a{color:var(--accent)}.article-header{border-bottom:1px solid var(--line);margin-bottom:32px;padding-bottom:24px}h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.2;margin:0 0 16px}h2{margin-top:40px;line-height:1.3}.lead-answer{background:#ecfdf5;border-left:4px solid var(--accent);margin:20px 0;padding:16px 18px}.summary{color:#334155;font-size:1.12rem}.meta{color:var(--muted);font-size:.86rem}.article-body h2{border-left:4px solid var(--accent);padding-left:12px;margin-top:40px}.article-body h3{margin-top:28px}.article-body blockquote{border-left:3px solid var(--line);color:var(--muted);margin:24px 0;padding-left:16px}.article-body li{margin:6px 0}.table-wrap{overflow-x:auto;margin:24px 0}.article-body table{border-collapse:collapse;min-width:620px;width:100%}.article-body th,.article-body td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}.article-body th{background:#ecfdf5}.content-index{list-style:none;margin:20px 0;padding:0}.content-index li{border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:4px;padding:18px 0}.content-index a{color:var(--accent);font-size:1.15rem;font-weight:700}.content-index span{color:var(--muted)}.related-section,.faq-section{border-top:1px solid var(--line);margin-top:40px;padding-top:10px}.faq-item{border-bottom:1px solid var(--line);padding:8px 0}.faq-item h3{font-size:1.05rem}.faq-item p{color:#334155}.directory-link{color:var(--accent);font-weight:700}.provider-facts{background:#fff;border:1px solid var(--line);display:grid;gap:8px;grid-template-columns:10rem 1fr;padding:18px}.provider-facts dt{color:var(--muted);font-weight:700}.provider-facts dd{margin:0}.provider-facts-list{list-style:none;padding:0}.provider-facts-list li{border-bottom:1px solid var(--line);padding:10px 0}`;

function sitemapXml(
  contents: ContentRecord[],
  categories: PublishedCategory[],
  providersByCategory: Map<CategorySlug, VisibleProvider[]>,
  baseUrl: string,
): string {
  const entries: Array<{ url: string; lastmod?: string }> = [{ url: absoluteUrl(baseUrl, "/") }];
  for (const category of categories) {
    const categoryContents = contents.filter((content) => content.category === category.slug);
    const lastmod = categoryContents.map((content) => content.updatedAt).sort().at(-1);
    entries.push({ url: absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`), ...(lastmod ? { lastmod } : {}) });
    entries.push({ url: absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/providers/`) });
    for (const provider of providersByCategory.get(category.slug) ?? []) {
      entries.push({ url: absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`) });
    }
  }
  entries.push(...contents.map((content) => ({ url: absoluteUrl(baseUrl, `/${routeFor(content)}/`), lastmod: content.updatedAt })));
  const urls = entries.map((entry) => `  <url><loc>${escapeHtml(entry.url)}</loc>${entry.lastmod ? `<lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : ""}</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function llmsText(contents: ContentRecord[], categories: PublishedCategory[], providersByCategory: Map<CategorySlug, VisibleProvider[]>, baseUrl: string): string {
  const categoryPages = categories.map((category) => `- [${category.label}](${absoluteUrl(baseUrl, `/${categoryRoute(category.slug)}/`)}): ${category.label}の公開情報と事業者案内`).join("\n");
  const providerPages = categories.flatMap((category) => (providersByCategory.get(category.slug) ?? []).map((provider) => `- [${provider.name}](${absoluteUrl(baseUrl, `/${providerRoute(category.slug, provider.id)}/`)}): ${category.label} / ${provider.location} / ${provider.themes.join("・")}`)).join("\n");
  const contentPages = contents.map((content) => `- [${content.title}](${absoluteUrl(baseUrl, `/${routeFor(content)}/`)}): ${content.summary}（最終更新: ${content.updatedAt.slice(0, 10)}）`).join("\n");
  return `# CMS-OS公開コンテンツ\n\n> 承認済みコンテンツ、カテゴリーハブ、事業者プロフィールの機械可読インデックスです。\n> 情報の利用時は各ページの最終更新日と一次情報を確認してください。\n\n## Categories\n${categoryPages || "- 準備中"}\n\n## Providers\n${providerPages || "- 準備中"}\n\n## Pages\n${contentPages || "- 準備中"}\n`;
}

export class PublicationService {
  public constructor(
    private readonly portal: PortalService,
    private readonly content: ContentService,
    private readonly builderosAdapter = new BuilderOSAdapter(),
    private readonly cloudflareOptionsProvider: () => CloudflarePagesDeployOptions = () => ({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      projectName: process.env.CLOUDFLARE_PAGES_PROJECT ?? "",
      ...(process.env.CLOUDFLARE_API_TOKEN ? { apiToken: process.env.CLOUDFLARE_API_TOKEN } : {}),
      ...(process.env.CLOUDFLARE_PAGES_BRANCH ? { branch: process.env.CLOUDFLARE_PAGES_BRANCH } : {}),
      ...(process.env.CMS_OS_CLOUDFLARE_DRY_RUN === "true" ? { dryRun: true } : {}),
    }),
    private readonly publicationStore = new PublicationStore(),
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
      : this.content.listContent(principal).filter((content) => content.status !== "archived");
    if (contents.length === 0) throw new PublicationServiceError(400, "公開対象のコンテンツがありません。");

    const publishedCategories: PublishedCategory[] = this.portal.listCategories();
    const categoryLabelBySlug = new Map(publishedCategories.map((category) => [category.slug, category.label]));
    const providersByCategory = new Map<CategorySlug, VisibleProvider[]>(
      publishedCategories.map((category) => [category.slug, this.portal.searchProviders(category.slug, null, {})]),
    );

    for (const item of contents) {
      this.portal.assertAction(principal, item.category, "publication.build");
      if (item.status !== "approved" && item.status !== "published") {
        throw new PublicationServiceError(409, `コンテンツ「${item.title}」は承認前のため公開できません。`);
      }
    }

    const providerDirectoryFiles = publishedCategories.flatMap((category) => {
      const providers = providersByCategory.get(category.slug) ?? [];
      const guides = this.portal.listDirectoryGuides(category.slug, null);
      return [
        { path: `${categoryRoute(category.slug)}/index.html`, contentType: "text/html; charset=utf-8", content: categoryHtml(category, contents.filter((content) => content.category === category.slug), providers, guides, baseUrl) },
        { path: `${categoryRoute(category.slug)}/providers/index.html`, contentType: "text/html; charset=utf-8", content: providerDirectoryHtml(category, providers, baseUrl) },
        ...providers.map((provider) => ({
          path: `${providerRoute(category.slug, provider.id)}/index.html`,
          contentType: "text/html; charset=utf-8",
          content: providerDetailHtml(category, provider, baseUrl),
        })),
      ];
    });
    const robots = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /mcp",
      ...["GPTBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Bingbot"].flatMap((bot) => [`User-agent: ${bot}`, "Allow: /"]),
      `Sitemap: ${baseUrl}/sitemap.xml`,
      "",
    ].join("\n");
    const files = [
      { path: "index.html", contentType: "text/html; charset=utf-8", content: rootHtml(contents, publishedCategories, baseUrl) },
      { path: "assets/cms-os.css", contentType: "text/css; charset=utf-8", content: css },
      ...providerDirectoryFiles,
      ...contents.map((content) => ({
        path: `${routeFor(content)}/index.html`,
        contentType: "text/html; charset=utf-8",
        content: pageHtml(content, relatedContentsFor(content, contents), categoryLabelBySlug.get(content.category) ?? content.category, baseUrl),
      })),
      { path: "sitemap.xml", contentType: "application/xml; charset=utf-8", content: sitemapXml(contents, publishedCategories, providersByCategory, baseUrl) },
      { path: "robots.txt", contentType: "text/plain; charset=utf-8", content: robots },
      { path: "llms.txt", contentType: "text/plain; charset=utf-8", content: llmsText(contents, publishedCategories, providersByCategory, baseUrl) },
    ];

    const publication: PublicationBuildResult = {
      publicationId: `publication-${randomUUID()}`,
      baseUrl,
      contentIds: contents.map((content) => content.id),
      generatedAt: new Date().toISOString(),
      files,
    };
    this.publicationStore.create({
      id: publication.publicationId,
      category: contents[0]!.category,
      providerId: contents[0]!.providerId,
      baseUrl: publication.baseUrl,
      contentIds: [...publication.contentIds],
      generatedAt: publication.generatedAt,
      status: "built",
      files: publication.files,
    });
    return publication;
  }

  public async deploy(
    principal: AuthenticatedPrincipal | null,
    contentIds?: string[],
    requestedBaseUrl?: string,
  ): Promise<{ publication: PublicationBuildResult; deployment: CloudflarePagesDeploymentResult }> {
    const publication = this.build(principal, contentIds, requestedBaseUrl);
    try {
      const deployment = await this.builderosAdapter.deployToCloudflarePages(publication, this.cloudflareOptionsProvider());
      this.publicationStore.update(publication.publicationId, {
        status: deployment.status === "submitted" ? "deployed" : "built",
        deployment: deploymentRecord(deployment),
      });
      return { publication, deployment };
    } catch (error) {
      if (error instanceof BuilderOSAdapterError) {
        throw new PublicationServiceError(502, error.message);
      }
      throw error;
    }
  }

  public async publish(
    principal: AuthenticatedPrincipal | null,
    contentIds?: string[],
    requestedBaseUrl?: string,
  ): Promise<{ publication: PublicationBuildResult; deployment: CloudflarePagesDeploymentResult; publishedContentIds: string[] }> {
    const publication = this.build(principal, contentIds, requestedBaseUrl);
    try {
      const deployment = await this.builderosAdapter.deployToCloudflarePages(publication, this.cloudflareOptionsProvider());
      const publishedContentIds = deployment.status === "submitted"
        ? publication.contentIds.map((contentId) => this.content.markPublished(principal, contentId).id)
        : [];
      this.publicationStore.update(publication.publicationId, {
        status: deployment.status === "submitted" ? "published" : "built",
        deployment: deploymentRecord(deployment),
      });
      return { publication, deployment, publishedContentIds };
    } catch (error) {
      if (error instanceof BuilderOSAdapterError) {
        throw new PublicationServiceError(502, error.message);
      }
      throw error;
    }
  }

  public listHistory(principal: AuthenticatedPrincipal | null): PublicationHistorySummary[] {
    if (!principal) throw new PublicationServiceError(401, "ログインが必要です。");
    this.portal.assertAction(principal, principal.category, "publication.history");
    if (principal.role !== "provider" || !principal.providerId) {
      throw new PublicationServiceError(403, "公開履歴は事業者だけが取得できます。");
    }
    return this.publicationStore.list(principal.category, principal.providerId).map(({ files, ...record }) => ({
      ...record,
      fileCount: files.length,
    }));
  }

  public async rollback(
    principal: AuthenticatedPrincipal | null,
    publicationId: string,
    requestedBaseUrl?: string,
  ): Promise<{ publication: PublicationBuildResult; deployment: CloudflarePagesDeploymentResult; rolledBackPublicationId: string }> {
    if (!principal) throw new PublicationServiceError(401, "ログインが必要です。");
    const target = this.publicationStore.get(publicationId);
    if (!target || target.category !== principal.category || target.providerId !== principal.providerId) {
      throw new PublicationServiceError(404, "公開履歴が見つかりません。");
    }
    this.portal.assertAction(principal, target.category, "publication.rollback");
    if (target.status === "built") {
      throw new PublicationServiceError(409, "ビルドだけで未公開の履歴はロールバックできません。");
    }

    const publication: PublicationBuildResult = {
      publicationId: `publication-${randomUUID()}`,
      baseUrl: normalizeBaseUrl(requestedBaseUrl ?? target.baseUrl),
      contentIds: [...target.contentIds],
      generatedAt: new Date().toISOString(),
      files: target.files.map((file) => ({ ...file })),
    };
    this.publicationStore.create({
      id: publication.publicationId,
      category: target.category,
      providerId: target.providerId,
      baseUrl: publication.baseUrl,
      contentIds: [...publication.contentIds],
      generatedAt: publication.generatedAt,
      status: "built",
      files: publication.files,
      rollbackOf: target.id,
    });

    try {
      const deployment = await this.builderosAdapter.deployToCloudflarePages(publication, this.cloudflareOptionsProvider());
      this.publicationStore.update(publication.publicationId, {
        status: deployment.status === "submitted" ? "rolled_back" : "built",
        deployment: deploymentRecord(deployment),
      });
      return { publication, deployment, rolledBackPublicationId: target.id };
    } catch (error) {
      if (error instanceof BuilderOSAdapterError) {
        throw new PublicationServiceError(502, error.message);
      }
      throw error;
    }
  }
}
