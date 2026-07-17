import { randomUUID } from "node:crypto";
import type { PortalService } from "./portal-service.js";
import { ContentStore } from "../domain/content-store.js";
import {
  categorySlugs,
  contentAudiences,
  contentLocales,
  contentTypes,
  type AuthenticatedPrincipal,
  type CategorySlug,
  type ContentAudience,
  type ContentBlock,
  type ContentEditorialActionRecord,
  type ContentJsonLdType,
  type ContentLocale,
  type ContentAuthorProfile,
  type ContentGenerationAudit,
  type ContentGenerationOperation,
  type ContentInternalRole,
  type ContentProposal,
  type ContentRecord,
  type ContentSourceEvidence,
  type ContentStructuredData,
  type ContentReviewRecord,
  type ContentSeo,
  type ContentType,
  type ContentVisibility,
  type ContentVersionRecord,
  contentVisibilityValues,
  contentWorkflowStatuses,
  type ContentWorkflowStatus,
  type FactCheckResult,
  type WebhookEventType,
  type SeoAuditResult,
  type SeoSiteAuditResult,
} from "../domain/types.js";
import { normalizeContentBlocks, renderContentBlocks } from "../domain/content-blocks.js";
import type { WebhookService } from "./webhook-service.js";
import type { MediaService } from "./media-service.js";
import { DeterministicContentAgentAdapter, type ContentAgentAdapter, type ContentAgentResult } from "../integrations/content-agent-adapter.js";

export class ContentServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ContentServiceError";
  }
}

export type ContentCreateInput = {
  category: CategorySlug;
  contentType: ContentType;
  audience: ContentAudience;
  mediaIds?: string[] | undefined;
  title: string;
  summary: string;
  body?: string;
  blocks?: ContentBlock[] | undefined;
  structuredData?: ContentStructuredData | undefined;
  sourceEvidence?: ContentSourceEvidence[] | undefined;
  slug?: string | undefined;
  sourceFacts?: string[] | undefined;
  locale?: ContentLocale | undefined;
  proposalId?: string | undefined;
  seo?: Partial<ContentSeo> | undefined;
  visibility?: ContentVisibility | undefined;
  tags?: string[] | undefined;
  series?: string | undefined;
  authors?: ContentAuthorProfile[] | undefined;
  featured?: boolean | undefined;
  expiresAt?: string | undefined;
};

export type ContentProposalCreateInput = {
  category: CategorySlug;
  contentType: ContentType;
  audience: ContentAudience;
  mediaIds?: string[] | undefined;
  topic: string;
  primaryKeyword?: string | undefined;
  relatedKeywords?: string[] | undefined;
  sourceFacts?: string[] | undefined;
};

export const contentSortValues = ["updatedAt_desc", "updatedAt_asc", "title_asc", "status"] as const;
export type ContentSort = (typeof contentSortValues)[number];

export const proposalSortValues = ["createdAt_desc", "createdAt_asc", "topic_asc"] as const;
export type ProposalSort = (typeof proposalSortValues)[number];

export type ContentListQuery = {
  search?: string | undefined;
  status?: ContentWorkflowStatus | undefined;
  audience?: ContentAudience | undefined;
  contentType?: ContentType | undefined;
  locale?: ContentLocale | undefined;
  visibility?: ContentVisibility | undefined;
  tags?: string[] | undefined;
  series?: string | undefined;
  featured?: boolean | undefined;
  sort?: ContentSort | undefined;
  limit?: number | undefined;
  cursor?: number | undefined;
};

export type ContentListPage = {
  items: ContentRecord[];
  page: { limit: number; nextCursor?: string };
};

export type ContentProposalListQuery = {
  search?: string | undefined;
  audience?: ContentAudience | undefined;
  contentType?: ContentType | undefined;
  sort?: ProposalSort | undefined;
  limit?: number | undefined;
  cursor?: number | undefined;
};

export type ContentProposalListPage = {
  items: ContentProposal[];
  page: { limit: number; nextCursor?: string };
};

const audienceLabels: Record<ContentAudience, string> = {
  customer: "顧客・発注者",
  candidate: "求職者・リクルーター",
  media: "報道・メディア",
  investor: "投資家・株主",
  beginner: "初心者・導入検討者",
  existingCustomer: "既存顧客",
};

const audienceIntents: Record<ContentAudience, string> = {
  customer: "課題を比較検討し、問い合わせ・予約・依頼の判断につなげる",
  candidate: "仕事内容、働き方、成長機会を理解し、応募判断につなげる",
  media: "ニュースとしての要点、背景、社会的な意味を短時間で理解できるようにする",
  investor: "事業の進捗、根拠、今後の見通しを確認できるようにする",
  beginner: "前提知識がない読者でも概要、選び方、最初の一歩を理解できるようにする",
  existingCustomer: "既存顧客が利用方法、変更点、次に取るべき行動を確認できるようにする",
};

const contentTypeLabels: Record<ContentType, string> = {
  company: "企業情報",
  blog: "Blog記事",
  job: "求人情報",
  pr: "プレスリリース",
  ir: "IR情報",
};

const jsonLdTypes: Record<ContentType, ContentJsonLdType> = {
  company: "Organization",
  blog: "BlogPosting",
  job: "JobPosting",
  pr: "NewsArticle",
  ir: "Article",
};

const localeLabels: Record<ContentLocale, string> = {
  ja: "日本語",
  en: "英語",
  "zh-CN": "中国語（簡体字）",
  es: "スペイン語",
  ko: "韓国語",
  de: "ドイツ語",
  fr: "フランス語",
};

function trimList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

function readingTimeMinutes(body: string): number {
  const readableLength = body.replace(/[\s`*_>#\[\](){}`]/g, "").length;
  return Math.max(1, Math.ceil(readableLength / 500));
}

function limit(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function normalizeSeoPath(value: string): string {
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/")) return "";
  const normalized = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function providerSeoPath(category: CategorySlug, providerId: string): string {
  const safeId = providerId.replace(/[^a-zA-Z0-9._~-]/g, "-");
  return `/categories/${category}/providers/${safeId}`;
}

function createOutline(audience: ContentAudience): string[] {
  const audienceSection: Record<ContentAudience, string> = {
    customer: "サービス・料金・相談方法",
    candidate: "仕事内容と成長機会",
    media: "ニュースの要点と背景",
    investor: "事業指標と今後の展望",
    beginner: "まず知っておきたい基礎",
    existingCustomer: "利用方法と次のアクション",
  };
  return [
    `${audienceLabels[audience]}が知りたいこと`,
    audienceSection[audience],
    "選ばれる理由と具体例",
    "利用・応募・問い合わせの流れ",
    "よくある質問",
  ];
}

export class ContentService {
  public constructor(
    private readonly portal: PortalService,
    private readonly store = new ContentStore(),
    private readonly webhook?: WebhookService,
    private readonly agent: ContentAgentAdapter = new DeterministicContentAgentAdapter(),
    private readonly media?: MediaService,
  ) {}

  public async createProposal(
    principal: AuthenticatedPrincipal | null,
    input: ContentProposalCreateInput,
  ): Promise<ContentProposal> {
    this.portal.assertAction(principal, input.category, "content.propose");
    this.assertProvider(principal, input.category);
    if (!principal || !principal.providerId) throw new ContentServiceError(403, "事業者情報が見つかりません。");

    const topic = input.topic.trim();
    if (topic.length < 3) throw new ContentServiceError(400, "topicは3文字以上で入力してください。");
    const mediaIds = this.normalizeMediaIds(principal, input.mediaIds);
    const primaryKeyword = (input.primaryKeyword?.trim() || topic).slice(0, 80);
    const sourceFacts = trimList(input.sourceFacts);
    const relatedKeywords = trimList([...(input.relatedKeywords ?? []), topic, audienceLabels[input.audience]]);
    const proposalSeed: Omit<ContentProposal, "id" | "createdAt"> = {
      category: input.category,
      providerId: principal.providerId!,
      contentType: input.contentType,
      audience: input.audience,
      ...(mediaIds.length > 0 ? { mediaIds } : {}),
      topic,
      searchIntent: audienceIntents[input.audience],
      primaryKeyword,
      relatedKeywords,
      outline: createOutline(input.audience),
      sourceFacts,
      rationale: `${contentTypeLabels[input.contentType]}として、${audienceLabels[input.audience]}に向けて「${topic}」を伝える企画です。${audienceIntents[input.audience]}。`,
    };
    const generated = await this.callAgent("企画", () => this.agent.propose({
      ...proposalSeed,
      audienceLabel: audienceLabels[input.audience],
      contentTypeLabel: contentTypeLabels[input.contentType],
    }));
    const outline = this.normalizeAgentList(generated.outline, "outline");
    if (outline.length === 0) throw new ContentServiceError(502, "AIエージェントが有効な企画構成を返しませんでした。");
    const proposal: Omit<ContentProposal, "id" | "createdAt"> = {
      ...proposalSeed,
      searchIntent: this.normalizeAgentText(generated.searchIntent, "searchIntent", 500),
      relatedKeywords: this.normalizeAgentList(generated.relatedKeywords, "relatedKeywords"),
      outline,
      rationale: this.normalizeAgentText(generated.rationale, "rationale", 2_000),
      generationAudit: this.createGenerationAudit("proposal", sourceFacts),
    };
    return this.store.createProposal(proposal);
  }

  public listProposals(principal: AuthenticatedPrincipal | null): ContentProposal[] {
    this.assertProvider(principal, principal?.category, "content.read");
    return this.store.listProposals(principal!.category, principal!.providerId!);
  }

  public listProposalsPage(principal: AuthenticatedPrincipal | null, query: ContentProposalListQuery = {}): ContentProposalListPage {
    this.assertProvider(principal, principal?.category, "content.read");
    const limitValue = query.limit ?? 50;
    const cursorValue = query.cursor ?? 0;
    if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      throw new ContentServiceError(400, "limitは1以上100以下で指定してください。");
    }
    if (!Number.isSafeInteger(cursorValue) || cursorValue < 0) {
      throw new ContentServiceError(400, "cursorは0以上の整数で指定してください。");
    }
    const normalizedSearch = query.search?.trim().toLocaleLowerCase();
    if (normalizedSearch && normalizedSearch.length > 200) {
      throw new ContentServiceError(400, "searchは200文字以内で指定してください。");
    }

    const proposals = this.store.listProposals(principal!.category, principal!.providerId!)
      .filter((proposal) => !query.audience || proposal.audience === query.audience)
      .filter((proposal) => !query.contentType || proposal.contentType === query.contentType)
      .filter((proposal) => {
        if (!normalizedSearch) return true;
        const searchable = [proposal.topic, proposal.primaryKeyword, proposal.rationale, ...proposal.relatedKeywords].join(" ").toLocaleLowerCase();
        return searchable.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const sort = query.sort ?? "createdAt_desc";
        if (sort === "topic_asc") return left.topic.localeCompare(right.topic, "ja") || left.id.localeCompare(right.id);
        const comparison = left.createdAt.localeCompare(right.createdAt);
        return sort === "createdAt_asc" ? comparison || left.id.localeCompare(right.id) : -comparison || left.id.localeCompare(right.id);
      });
    const items = proposals.slice(cursorValue, cursorValue + limitValue);
    const nextCursor = cursorValue + items.length < proposals.length ? String(cursorValue + items.length) : undefined;
    return { items, page: { limit: limitValue, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public createContent(
    principal: AuthenticatedPrincipal | null,
    input: ContentCreateInput,
  ): ContentRecord {
    this.portal.assertAction(principal, input.category, "content.create");
    this.assertProvider(principal, input.category);
    if (!principal || !principal.providerId) throw new ContentServiceError(403, "事業者情報が見つかりません。");
    const title = this.normalizeEditableText(input.title, "title", 160);
    const summary = this.normalizeEditableText(input.summary, "summary", 320);
    const document = this.normalizeBlocksAndBody(input.body, input.blocks);
    const structuredData = this.normalizeStructuredData(input.contentType, input.structuredData);
    const sourceEvidence = this.normalizeSourceEvidence(input.sourceEvidence);
    const sourceFacts = trimList(input.sourceFacts);
    const locale = input.locale ?? "ja";
    const visibility = this.normalizeVisibility(input.visibility);
    const tags = this.normalizeTags(input.tags);
    const series = this.normalizeSeries(input.series);
    const authors = this.normalizeAuthors(input.authors);
    const expiresAt = this.normalizeExpiresAt(input.expiresAt);
    const featured = input.featured ?? false;
    if (typeof featured !== "boolean") throw new ContentServiceError(400, "featuredは真偽値で指定してください。");
    let mediaIds = this.normalizeMediaIds(principal, input.mediaIds);
    let proposal: ContentProposal | undefined;
    if (input.proposalId !== undefined) {
      proposal = this.getOwnedProposal(principal, input.proposalId);
      if (proposal.category !== input.category || proposal.contentType !== input.contentType || proposal.audience !== input.audience) {
        throw new ContentServiceError(409, "proposalIdのカテゴリ、コンテンツ種別、対象ポジションが入力内容と一致しません。");
      }
      if (input.mediaIds === undefined) mediaIds = this.normalizeMediaIds(principal, proposal.mediaIds);
    } else {
      proposal = this.store.createProposal({
        category: input.category,
        providerId: principal.providerId,
        contentType: input.contentType,
        audience: input.audience,
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
        topic: title,
        searchIntent: audienceIntents[input.audience],
        primaryKeyword: input.seo?.keywords?.[0]?.trim() || title,
        relatedKeywords: trimList(input.seo?.keywords),
        outline: ["要点", "具体例", "次のアクション"],
        sourceFacts,
        rationale: "AIエージェントまたは外部APIから登録された検証用コンテンツです。",
      });
    }
    const slug = input.slug === undefined ? `content-${randomUUID().slice(-12)}` : this.normalizeSlug(input.slug);
    const seo = this.createSeoForContent(input.contentType, title, summary, slug, input.seo);
    const created = this.store.createContent({
      category: input.category,
      providerId: principal.providerId,
      contentType: input.contentType,
      audience: input.audience,
      ...(mediaIds.length > 0 ? { mediaIds } : {}),
      ...(document.blocks ? { blocks: document.blocks } : {}),
      ...(structuredData ? { structuredData } : {}),
      ...(sourceEvidence ? { sourceEvidence } : {}),
      title,
      slug,
      summary,
      body: document.body,
      seo,
      sourceFacts,
      proposalId: proposal.id,
      locale,
      visibility,
      tags,
      featured,
      readingTimeMinutes: readingTimeMinutes(document.body),
      createdBy: principal.accountId,
      ...(series ? { series } : {}),
      ...(authors ? { authors } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      status: "drafted",
    }, { ...(principal.accountId ? { actorId: principal.accountId } : {}) });
    this.emitContentEvent("content.created", created);
    return created;
  }

  public async createDraft(principal: AuthenticatedPrincipal | null, proposalId: string): Promise<ContentRecord> {
    const proposal = this.getOwnedProposal(principal, proposalId);
    this.portal.assertAction(principal, proposal.category, "content.draft");
    const mediaIds = this.normalizeMediaIds(principal, proposal.mediaIds);

    const generated = await this.callAgent("下書き", () => this.agent.draft({
      proposal,
      audienceLabel: audienceLabels[proposal.audience],
      audienceIntent: audienceIntents[proposal.audience],
      contentTypeLabel: contentTypeLabels[proposal.contentType],
      jsonLdType: jsonLdTypes[proposal.contentType],
    }));
    const title = this.normalizeAgentText(generated.title, "title", 160);
    const summary = this.normalizeAgentText(generated.summary, "summary", 320);
    const body = this.normalizeAgentText(generated.body, "body", 200_000);
    const slug = `content-${proposal.id.slice(-12)}`;
    const created = this.store.createContent({
      category: proposal.category,
      providerId: proposal.providerId,
      contentType: proposal.contentType,
      audience: proposal.audience,
      ...(mediaIds.length > 0 ? { mediaIds } : {}),
      ...(generated.structuredData ? { structuredData: this.normalizeStructuredData(proposal.contentType, generated.structuredData) } : {}),
      title,
      slug,
      summary,
      body,
      seo: this.createSeoForContent(proposal.contentType, title, summary, slug, generated.seo),
      sourceFacts: proposal.sourceFacts,
      proposalId: proposal.id,
      locale: "ja",
      visibility: "public",
      tags: this.normalizeTags([proposal.primaryKeyword, ...proposal.relatedKeywords]),
      featured: false,
      readingTimeMinutes: readingTimeMinutes(body),
      createdBy: principal!.accountId,
      generationAudit: this.createGenerationAudit("draft", [proposal.id, ...proposal.sourceFacts]),
      status: "drafted",
    }, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    this.emitContentEvent("content.created", created);
    return created;
  }

  public listContent(principal: AuthenticatedPrincipal | null): ContentRecord[] {
    this.assertProvider(principal, principal?.category, "content.read");
    return this.store.listContent(principal!.category, principal!.providerId!);
  }

  public listContentPage(principal: AuthenticatedPrincipal | null, query: ContentListQuery = {}): ContentListPage {
    this.assertProvider(principal, principal?.category, "content.read");
    const limitValue = query.limit ?? 50;
    const cursorValue = query.cursor ?? 0;
    if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      throw new ContentServiceError(400, "limitは1以上100以下で指定してください。");
    }
    if (!Number.isSafeInteger(cursorValue) || cursorValue < 0) {
      throw new ContentServiceError(400, "cursorは0以上の整数で指定してください。");
    }
    const normalizedSearch = query.search?.trim().toLocaleLowerCase();
    if (normalizedSearch && normalizedSearch.length > 200) {
      throw new ContentServiceError(400, "searchは200文字以内で指定してください。");
    }

    const contents = this.store.listContent(principal!.category, principal!.providerId!)
      .filter((content) => !query.status || content.status === query.status)
      .filter((content) => !query.audience || content.audience === query.audience)
      .filter((content) => !query.contentType || content.contentType === query.contentType)
      .filter((content) => !query.locale || content.locale === query.locale)
      .filter((content) => !query.visibility || content.visibility === query.visibility)
      .filter((content) => !query.tags || query.tags.every((tag) => content.tags.includes(tag)))
      .filter((content) => !query.series || content.series === query.series)
      .filter((content) => query.featured === undefined || content.featured === query.featured)
      .filter((content) => {
        if (!normalizedSearch) return true;
        const searchable = [content.title, content.slug, content.summary, content.seo.description, content.series ?? "", ...content.tags, ...content.seo.keywords].join(" ").toLocaleLowerCase();
        return searchable.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const sort = query.sort ?? "updatedAt_desc";
        if (sort === "title_asc") return left.title.localeCompare(right.title, "ja") || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
        if (sort === "status") return left.status.localeCompare(right.status) || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
        const comparison = left.updatedAt.localeCompare(right.updatedAt);
        return sort === "updatedAt_asc" ? comparison || left.id.localeCompare(right.id) : -comparison || left.id.localeCompare(right.id);
      });
    const items = contents.slice(cursorValue, cursorValue + limitValue);
    const nextCursor = cursorValue + items.length < contents.length ? String(cursorValue + items.length) : undefined;
    return { items, page: { limit: limitValue, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public getContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.store.getContent(contentId);
    if (!content) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.assertProvider(principal, content.category, "content.read");
    if (content.providerId !== principal!.providerId) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return content;
  }

  public async translateContent(
    principal: AuthenticatedPrincipal | null,
    contentId: string,
    input: {
      targetLocale: ContentLocale;
      title?: string;
      summary?: string;
      body?: string;
      seo?: Partial<ContentSeo>;
      instructions?: string;
    },
  ): Promise<ContentRecord> {
    const source = this.getContent(principal, contentId);
    this.portal.assertAction(principal, source.category, "content.translate");
    if (source.status === "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツは翻訳できません。先に復元してください。");
    if (input.targetLocale === source.locale) throw new ContentServiceError(400, "翻訳先言語は原文と異なる言語を指定してください。");

    const existing = this.store.listContent(source.category, source.providerId).find((content) =>
      content.status !== "archived" &&
      content.locale === input.targetLocale &&
      content.translationOf?.contentId === source.id,
    );
    if (existing) throw new ContentServiceError(409, `同じ翻訳先の下書きが既に存在します: ${existing.id}`);

    const localeSegment = input.targetLocale.toLocaleLowerCase().replace(/[^a-z0-9-]/g, "-");
    const targetLabel = localeLabels[input.targetLocale];
    const normalizedInstructions = input.instructions?.trim()
      ? this.normalizeEditableText(input.instructions, "instructions", 1000)
      : undefined;
    const generated = await this.callAgent("翻訳", () => this.agent.translate({
      source,
      targetLocale: input.targetLocale,
      targetLabel,
      ...(normalizedInstructions !== undefined ? { instructions: normalizedInstructions } : {}),
    }));
    const title = input.title !== undefined
      ? this.normalizeEditableText(input.title, "title", 160)
      : this.normalizeAgentText(generated.title, "title", 160);
    const summary = input.summary !== undefined
      ? this.normalizeEditableText(input.summary, "summary", 320)
      : this.normalizeAgentText(generated.summary, "summary", 320);
    const body = input.body !== undefined
      ? this.normalizeEditableText(input.body, "body", 200_000)
      : this.normalizeAgentText(generated.body, "body", 200_000);
    const seo: ContentSeo = {
      ...source.seo,
      ...(generated.seo ?? {}),
      ...(input.seo ?? {}),
      title: input.seo?.title !== undefined ? input.seo.title : generated.seo?.title ?? `【${targetLabel}】${source.seo.title}`,
      description: input.seo?.description !== undefined ? input.seo.description : generated.seo?.description ?? `翻訳版: ${source.seo.description}`,
      ogTitle: input.seo?.ogTitle !== undefined ? input.seo.ogTitle : generated.seo?.ogTitle ?? `【${targetLabel}】${source.seo.ogTitle}`,
      ogDescription: input.seo?.ogDescription !== undefined ? input.seo.ogDescription : generated.seo?.ogDescription ?? `翻訳版: ${source.seo.ogDescription}`,
      keywords: input.seo?.keywords !== undefined ? trimList(input.seo.keywords) : trimList(generated.seo?.keywords ?? [...source.seo.keywords, input.targetLocale]),
      canonicalPath: input.seo?.canonicalPath !== undefined ? input.seo.canonicalPath : generated.seo?.canonicalPath ?? `/${localeSegment}${source.seo.canonicalPath}`,
      faq: input.seo?.faq !== undefined ? input.seo.faq.map((item) => ({ ...item })) : source.seo.faq.map((item) => ({ ...item })),
    };
    const normalizedSeo = this.createSeoForContent(
      source.contentType,
      title,
      summary,
      `${source.slug}-${localeSegment}`,
      seo,
    );

    const created = this.store.createContent({
      category: source.category,
      providerId: source.providerId,
      contentType: source.contentType,
      audience: source.audience,
      ...(source.mediaIds && source.mediaIds.length > 0 ? { mediaIds: [...source.mediaIds] } : {}),
      ...(generated.structuredData
        ? { structuredData: this.normalizeStructuredData(source.contentType, generated.structuredData) }
        : source.structuredData ? { structuredData: this.cloneStructuredData(source.structuredData) } : {}),
      ...(source.sourceEvidence ? { sourceEvidence: this.cloneSourceEvidence(source.sourceEvidence) } : {}),
      title,
      slug: `${source.slug}-${localeSegment}`,
      summary,
      body,
      seo: normalizedSeo,
      sourceFacts: [...source.sourceFacts],
      proposalId: source.proposalId,
      locale: input.targetLocale,
      translationOf: {
        contentId: source.id,
        sourceVersion: source.version,
        sourceLocale: source.locale,
      },
      visibility: "private",
      tags: [...source.tags],
      featured: false,
      readingTimeMinutes: readingTimeMinutes(body),
      createdBy: principal!.accountId,
      ...(source.series ? { series: source.series } : {}),
      ...(source.authors ? { authors: this.cloneAuthors(source.authors) } : {}),
      generationAudit: this.createGenerationAudit("translate", [source.id, `version:${source.version}`]),
      status: "drafted",
    }, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    this.emitContentEvent("content.created", created);
    return created;
  }

  public listVersions(principal: AuthenticatedPrincipal | null, contentId: string): ContentVersionRecord[] {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.version_read");
    return this.store.listVersions(content.id);
  }

  public getVersion(principal: AuthenticatedPrincipal | null, contentId: string, versionNumber: number): ContentVersionRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.version_read");
    this.assertVersionNumber(versionNumber);
    const version = this.store.getVersion(content.id, versionNumber);
    if (!version) throw new ContentServiceError(404, "指定されたコンテンツ版が見つかりません。");
    return version;
  }

  public restoreVersion(principal: AuthenticatedPrincipal | null, contentId: string, versionNumber: number): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.version_restore");
    this.assertVersionNumber(versionNumber);
    if (content.status === "published") throw new ContentServiceError(409, "公開済みコンテンツは直接復元できません。複製してから編集してください。");
    if (content.status === "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツは先に復元してください。");
    if (content.status === "review_requested") throw new ContentServiceError(409, "レビュー中のコンテンツは復元できません。レビューを完了してから実行してください。");
    const restored = this.store.restoreVersion(content.id, versionNumber, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!restored) throw new ContentServiceError(404, "指定されたコンテンツ版が見つかりません。");
    this.emitContentEvent("content.updated", restored);
    return restored;
  }

  public listReviews(principal: AuthenticatedPrincipal | null, contentId: string): ContentReviewRecord[] {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "workflow.reviews");
    return this.store.listReviews(content.id);
  }

  public listEditorialActions(principal: AuthenticatedPrincipal | null, contentId: string): ContentEditorialActionRecord[] {
    const content = this.getContent(principal, contentId);
    return this.store.listEditorialActions(content.id);
  }

  public recordCorrection(
    principal: AuthenticatedPrincipal | null,
    contentId: string,
    input: {
      reason: string;
      body?: string;
      blocks?: ContentBlock[] | undefined;
      structuredData?: ContentStructuredData | undefined;
      sourceEvidence?: ContentSourceEvidence[] | undefined;
    },
  ): ContentEditorialActionRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.update");
    if (content.status !== "published") throw new ContentServiceError(409, "訂正履歴は公開済みコンテンツに対してのみ登録できます。");
    const reason = this.normalizeReviewNote(input.reason, true) ?? "訂正理由";
    const document = this.normalizeBlocksAndBody(input.body, input.blocks);
    const structuredData = this.normalizeStructuredData(content.contentType, input.structuredData);
    const sourceEvidence = this.normalizeSourceEvidence(input.sourceEvidence);
    return this.store.createEditorialAction({
      contentId: content.id,
      category: content.category,
      providerId: content.providerId,
      contentVersion: content.version,
      kind: "correction",
      reason,
      beforeBody: content.body,
      ...(content.blocks ? { beforeBlocks: content.blocks } : {}),
      ...(content.structuredData ? { beforeStructuredData: content.structuredData } : {}),
      ...(content.sourceEvidence ? { beforeSourceEvidence: content.sourceEvidence } : {}),
      afterBody: document.body,
      ...(document.blocks ? { afterBlocks: document.blocks } : {}),
      ...(structuredData ? { afterStructuredData: structuredData } : {}),
      ...(sourceEvidence ? { afterSourceEvidence: sourceEvidence } : {}),
      actorAccountId: principal!.accountId,
    });
  }

  public withdrawContent(
    principal: AuthenticatedPrincipal | null,
    contentId: string,
    reason: string,
  ): { content: ContentRecord; action: ContentEditorialActionRecord } {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "publication.unpublish");
    if (content.status !== "published") throw new ContentServiceError(409, "撤回履歴は公開中コンテンツに対してのみ登録できます。");
    const unpublished = this.unpublishContent(principal, contentId);
    const action = this.store.createEditorialAction({
      contentId: content.id,
      category: content.category,
      providerId: content.providerId,
      contentVersion: content.version,
      kind: "withdrawal",
      reason: this.normalizeReviewNote(reason, true) ?? "撤回理由",
      beforeBody: content.body,
      ...(content.blocks ? { beforeBlocks: content.blocks } : {}),
      ...(content.structuredData ? { beforeStructuredData: content.structuredData } : {}),
      ...(content.sourceEvidence ? { beforeSourceEvidence: content.sourceEvidence } : {}),
      actorAccountId: principal!.accountId,
    });
    return { content: unpublished, action };
  }

  public requestReview(
    principal: AuthenticatedPrincipal | null,
    contentId: string,
    note?: string,
  ): { content: ContentRecord; review: ContentReviewRecord } {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "workflow.request_review");
    if (content.status === "review_requested") throw new ContentServiceError(409, "このコンテンツはすでにレビュー中です。");
    if (content.status !== "seo_reviewed") throw new ContentServiceError(409, "SEO監査済みのコンテンツだけレビューを依頼できます。");
    this.assertApprovalReady(content);

    const updated = this.store.updateContent(content.id, { status: "review_requested" }, { incrementVersion: false });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    const normalizedNote = this.normalizeReviewNote(note, false);
    const review = this.store.createReview({
      contentId: content.id,
      category: content.category,
      providerId: content.providerId,
      contentVersion: content.version,
      status: "requested",
      requestedByAccountId: principal!.accountId,
      ...(normalizedNote ? { requestNote: normalizedNote } : {}),
      requestedAt: new Date().toISOString(),
    });
    return { content: updated, review };
  }

  public requestChanges(
    principal: AuthenticatedPrincipal | null,
    contentId: string,
    note?: string,
  ): { content: ContentRecord; review: ContentReviewRecord } {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "workflow.request_changes");
    if (content.status !== "review_requested") throw new ContentServiceError(409, "レビュー中のコンテンツだけ差し戻せます。");
    const review = this.store.listReviews(content.id)[0];
    if (!review || review.status !== "requested") throw new ContentServiceError(409, "有効なレビュー依頼が見つかりません。");
    const responseNote = this.normalizeReviewNote(note, true);
    const updated = this.store.updateContent(content.id, { status: "changes_requested" }, { incrementVersion: false });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    const reviewed = this.store.updateReview(review.id, {
      status: "changes_requested",
      reviewerAccountId: principal!.accountId,
      ...(responseNote ? { responseNote } : {}),
      reviewedAt: new Date().toISOString(),
    });
    if (!reviewed) throw new ContentServiceError(404, "レビュー記録が見つかりません。");
    return { content: updated, review: reviewed };
  }

  public updateContent(
    principal: AuthenticatedPrincipal | null,
    contentId: string,
    input: {
      title?: string;
      summary?: string;
      body?: string;
      blocks?: ContentBlock[] | undefined;
      structuredData?: ContentStructuredData | undefined;
      sourceEvidence?: ContentSourceEvidence[] | undefined;
      seo?: Partial<ContentSeo>;
      sourceFacts?: string[];
      mediaIds?: string[];
      visibility?: ContentVisibility | undefined;
      tags?: string[] | undefined;
      series?: string | undefined;
      authors?: ContentAuthorProfile[] | undefined;
      featured?: boolean | undefined;
      expiresAt?: string | undefined;
    },
  ): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.update");
    if (content.status === "published") throw new ContentServiceError(409, "公開済みコンテンツは編集できません。複製して編集してください。");
    if (content.status === "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツは復元してから編集してください。");
    if (content.status === "review_requested") throw new ContentServiceError(409, "レビュー中のコンテンツは編集できません。差し戻しを待ってください。");

    const patch: Partial<ContentRecord> = {};
    if (input.title !== undefined) patch.title = this.normalizeEditableText(input.title, "title", 160);
    if (input.summary !== undefined) patch.summary = this.normalizeEditableText(input.summary, "summary", 320);
    if (input.blocks !== undefined) {
      const document = this.normalizeBlocksAndBody(undefined, input.blocks);
      patch.blocks = document.blocks;
      patch.body = document.body;
    } else if (input.body !== undefined) {
      patch.body = this.normalizeEditableText(input.body, "body", 200_000);
      patch.blocks = undefined;
    }
    if (input.structuredData !== undefined) patch.structuredData = this.normalizeStructuredData(content.contentType, input.structuredData);
    if (input.sourceEvidence !== undefined) patch.sourceEvidence = this.normalizeSourceEvidence(input.sourceEvidence);
    if (input.sourceFacts !== undefined) patch.sourceFacts = trimList(input.sourceFacts);
    if (input.mediaIds !== undefined) patch.mediaIds = this.normalizeMediaIds(principal, input.mediaIds);
    if (input.visibility !== undefined) patch.visibility = this.normalizeVisibility(input.visibility);
    if (input.tags !== undefined) patch.tags = this.normalizeTags(input.tags);
    if (input.series !== undefined) patch.series = this.normalizeSeries(input.series);
    if (input.authors !== undefined) patch.authors = this.normalizeAuthors(input.authors);
    if (input.featured !== undefined) {
      if (typeof input.featured !== "boolean") throw new ContentServiceError(400, "featuredは真偽値で指定してください。");
      patch.featured = input.featured;
    }
    if (input.expiresAt !== undefined) patch.expiresAt = this.normalizeExpiresAt(input.expiresAt);
    if (input.body !== undefined || input.blocks !== undefined) patch.readingTimeMinutes = readingTimeMinutes(patch.body ?? content.body);
    if (Object.keys(input).length > 0) patch.generationAudit = undefined;
    if (input.seo !== undefined) {
      const seo: ContentSeo = { ...content.seo, ...input.seo };
      seo.title = this.normalizeEditableText(seo.title, "seo.title", 60);
      seo.description = this.normalizeEditableText(seo.description, "seo.description", 160);
      seo.ogTitle = this.normalizeEditableText(seo.ogTitle, "seo.ogTitle", 60);
      seo.ogDescription = this.normalizeEditableText(seo.ogDescription, "seo.ogDescription", 160);
      patch.seo = seo;
    }
    if (Object.keys(patch).length === 0) throw new ContentServiceError(400, "更新対象のフィールドを1つ以上指定してください。");
    if (content.status === "seo_reviewed" || content.status === "changes_requested" || content.status === "approved") patch.status = "drafted";

    const updated = this.store.updateContent(content.id, patch, { reason: "updated", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.emitContentEvent("content.updated", updated);
    return updated;
  }

  public duplicateContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.duplicate");
    if (content.status === "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツは複製できません。復元してから実行してください。");
    const copySuffix = randomUUID().slice(0, 8);

    const duplicated = this.store.createContent({
      category: content.category,
      providerId: content.providerId,
      contentType: content.contentType,
      audience: content.audience,
      ...(content.mediaIds && content.mediaIds.length > 0 ? { mediaIds: [...content.mediaIds] } : {}),
      ...(content.structuredData ? { structuredData: this.cloneStructuredData(content.structuredData) } : {}),
      ...(content.sourceEvidence ? { sourceEvidence: this.cloneSourceEvidence(content.sourceEvidence) } : {}),
      title: `${content.title}（複製）`,
      slug: `${content.slug}-copy-${copySuffix}`,
      summary: content.summary,
      body: content.body,
      seo: { ...content.seo, canonicalPath: `${content.seo.canonicalPath}-copy-${copySuffix}` },
      sourceFacts: [...content.sourceFacts],
      proposalId: content.proposalId,
      locale: content.locale,
      ...(content.translationOf ? { translationOf: { ...content.translationOf } } : {}),
      visibility: "private",
      tags: [...content.tags],
      featured: false,
      readingTimeMinutes: readingTimeMinutes(content.body),
      createdBy: principal!.accountId,
      ...(content.series ? { series: content.series } : {}),
      ...(content.authors ? { authors: this.cloneAuthors(content.authors) } : {}),
      status: "drafted",
    }, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    this.emitContentEvent("content.created", duplicated);
    return duplicated;
  }

  public archiveContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.archive");
    if (content.status === "published") throw new ContentServiceError(409, "公開済みコンテンツは公開取消を確認してからアーカイブしてください。");
    if (content.status === "archived") return content;
    const archived = this.store.updateContent(content.id, { status: "archived" }, { reason: "workflow", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!archived) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.emitContentEvent("content.archived", archived);
    return archived;
  }

  public unpublishContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "publication.unpublish");
    if (content.status !== "published") {
      throw new ContentServiceError(409, "公開中のコンテンツだけ公開取消できます。");
    }
    const unpublished = this.store.updateContent(content.id, { status: "archived" }, {
      incrementVersion: false,
      reason: "workflow",
      ...(principal?.accountId ? { actorId: principal.accountId } : {}),
    });
    if (!unpublished) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.emitContentEvent("content.archived", unpublished);
    return unpublished;
  }

  public restoreContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.restore");
    if (content.status !== "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツだけを復元できます。");
    const restored = this.store.updateContent(content.id, { status: "drafted" }, { reason: "workflow", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!restored) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.emitContentEvent("content.updated", restored);
    return restored;
  }

  public markPublished(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "publication.publish");
    this.assertInternalRole(principal, content.category, "publisher");
    if (content.status === "published") return content;
    if (content.status !== "approved") throw new ContentServiceError(409, "承認済みコンテンツだけを公開できます。");
    const published = this.store.updateContent(content.id, { status: "published", publishedAt: new Date().toISOString() }, { reason: "workflow", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!published) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.emitContentEvent("content.published", published);
    return published;
  }

  public async polishContent(principal: AuthenticatedPrincipal | null, contentId: string, instructions?: string): Promise<ContentRecord> {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.polish");
    if (content.status === "review_requested") throw new ContentServiceError(409, "レビュー中のコンテンツは清書できません。差し戻しを待ってください。");
    const generated = await this.callAgent("清書", () => this.agent.polish({ content, ...(instructions !== undefined ? { instructions } : {}) }));
    const title = generated.title !== undefined ? this.normalizeAgentText(generated.title, "title", 160) : content.title;
    const summary = generated.summary !== undefined ? this.normalizeAgentText(generated.summary, "summary", 320) : content.summary;
    const body = this.normalizeAgentText(generated.body, "body", 200_000);
    const updated = this.store.updateContent(content.id, {
      title,
      summary,
      body,
      blocks: undefined,
      status: "polished",
      generationAudit: this.createGenerationAudit("polish", [content.id, `version:${content.version}`, ...content.sourceFacts]),
      ...(generated.structuredData ? { structuredData: this.normalizeStructuredData(content.contentType, generated.structuredData) } : {}),
      seo: this.createSeoForContent(content.contentType, title, summary, content.slug, { ...content.seo, ...(generated.seo ?? {}) }),
    }, { reason: "polished", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.emitContentEvent("content.updated", updated);
    return updated;
  }

  public approveContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "workflow.approve");
    this.assertInternalRole(principal, content.category, "approver");
    if (content.contentType === "ir" && content.createdBy === principal?.accountId && (principal.internalRoleAssignments?.length ?? 0) > 0) {
      throw new ContentServiceError(409, "IRは作成者と承認者を分離してください。");
    }
    if (content.status !== "seo_reviewed" && content.status !== "review_requested") {
      throw new ContentServiceError(409, "SEO監査済みのコンテンツだけを公開承認できます。");
    }
    const review = content.status === "review_requested" ? this.store.listReviews(content.id)[0] : undefined;
    if (content.status === "review_requested" && (!review || review.status !== "requested")) {
      throw new ContentServiceError(409, "有効なレビュー依頼が見つかりません。");
    }
    this.assertApprovalReady(content);
    const updated = this.store.updateContent(content.id, {
      status: "approved",
      reviewedBy: principal!.accountId,
      ...(content.generationAudit ? { generationAudit: { ...content.generationAudit, approvedBy: principal!.accountId } } : {}),
    }, { incrementVersion: false });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    if (review) {
      this.store.updateReview(review.id, {
        status: "approved",
        reviewerAccountId: principal!.accountId,
        reviewedAt: new Date().toISOString(),
      });
    }
    this.emitContentEvent("content.updated", updated);
    return updated;
  }

  public auditSeo(principal: AuthenticatedPrincipal | null, contentId: string): SeoAuditResult {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "seo.audit");
    if (content.status === "approved" || content.status === "published") {
      throw new ContentServiceError(409, "承認済みコンテンツのSEO監査をやり直す場合は、複製して編集してください。");
    }
    const issues: SeoAuditResult["issues"] = [];
    const primaryKeyword = content.seo.keywords[0] ?? "";
    const normalizedPrimaryKeyword = primaryKeyword.toLocaleLowerCase("ja-JP");
    const normalizedSeoTitle = content.seo.title.toLocaleLowerCase("ja-JP");
    const h1Headings = content.body.match(/^#(?!#)\s+.+$/gm) ?? [];
    const plainBody = content.body
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_>#-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (content.seo.title.length < 10 || content.seo.title.length > 60) {
      issues.push({ code: "SEO_TITLE_LENGTH", severity: "warning", field: "seo.title", message: "SEOタイトルは10〜60文字を目安にしてください。", recommendation: "検索意図を残しながらタイトルを調整してください。" });
    }
    if (content.seo.description.length < 50 || content.seo.description.length > 160) {
      issues.push({ code: "SEO_DESCRIPTION_LENGTH", severity: "warning", field: "seo.description", message: "メタディスクリプションは50〜160文字を目安にしてください。", recommendation: "読者が得られる情報と次の行動を具体化してください。" });
    }
    if (content.contentType === "blog" && content.tags.length === 0) {
      issues.push({ code: "BLOG_TAGS_EMPTY", severity: "warning", field: "tags", message: "Blogにタグが登録されていません。", recommendation: "検索意図と関連記事の分類に使うタグを登録してください。" });
    }
    if (content.contentType === "blog" && (!content.authors || content.authors.length === 0)) {
      issues.push({ code: "BLOG_AUTHOR_EMPTY", severity: "warning", field: "authors", message: "Blogの著者プロフィールが登録されていません。", recommendation: "著者名と専門性を登録し、読者が情報の責任主体を確認できるようにしてください。" });
    }
    if (content.expiresAt && Date.parse(content.expiresAt) <= Date.now()) {
      issues.push({ code: "CONTENT_EXPIRED", severity: "error", field: "expiresAt", message: "公開期限を過ぎています。", recommendation: "期限を更新するか、公開対象から除外してください。" });
    }
    if (primaryKeyword && !`${content.seo.title}\n${content.body}`.toLocaleLowerCase("ja-JP").includes(normalizedPrimaryKeyword)) {
      issues.push({ code: "PRIMARY_KEYWORD_MISSING", severity: "warning", field: "seo.keywords", message: "主キーワードがタイトルまたは本文に含まれていません。", recommendation: "検索意図を損なわない範囲で自然に追加してください。" });
    }
    if (primaryKeyword && !normalizedSeoTitle.includes(normalizedPrimaryKeyword)) {
      issues.push({ code: "PRIMARY_KEYWORD_NOT_IN_TITLE", severity: "warning", field: "seo.title", message: "主キーワードがSEOタイトルに含まれていません。", recommendation: "検索意図を保ちながら、主キーワードをSEOタイトルへ自然に含めてください。" });
    }
    if (h1Headings.length === 0) {
      issues.push({ code: "H1_MISSING", severity: "error", field: "body", message: "本文にH1見出しがありません。", recommendation: "ページごとに主題を表すH1を1つ設定してください。" });
    }
    if (h1Headings.length > 1) {
      issues.push({ code: "H1_MULTIPLE", severity: "error", field: "body", message: "本文にH1見出しが複数あります。", recommendation: "ページの主題を表すH1を1つに整理し、下位見出しはH2以降にしてください。" });
    }
    if (plainBody.length < 200) {
      issues.push({ code: "SEO_BODY_THIN", severity: "warning", field: "body", message: "本文の可読テキストが少なく、検索意図に十分答えられない可能性があります。", recommendation: "結論、根拠、具体例、次の行動を追加し、読者の疑問を解消してください。" });
    }
    if (content.seo.jsonLdType === "FAQPage" && content.seo.faq.length === 0) {
      issues.push({ code: "FAQ_JSONLD_EMPTY", severity: "error", field: "seo.faq", message: "FAQPageのJSON-LDにFAQ項目がありません。", recommendation: "質問と回答を登録するか、JSON-LDタイプを本文に合うものへ変更してください。" });
    }
    if (!content.seo.canonicalPath.startsWith("/")) {
      issues.push({ code: "CANONICAL_INVALID", severity: "error", field: "seo.canonicalPath", message: "canonicalPathはサイト内パスで指定してください。", recommendation: "先頭にスラッシュを付けた正規URLパスを設定してください。" });
    }
    if (content.sourceFacts.length === 0 && (content.sourceEvidence?.length ?? 0) === 0) {
      issues.push({ code: "SOURCE_FACTS_EMPTY", severity: "warning", field: "sourceFacts", message: "確認済みの一次情報または出典が登録されていません。", recommendation: "公開前に出典URL、数値、日付、担当者を登録してください。" });
    }
    if (content.contentType === "company" && content.structuredData?.type !== "company") {
      issues.push({ code: "COMPANY_STRUCTURED_DATA_MISSING", severity: "warning", field: "structuredData", message: "会社情報の構造化データがありません。", recommendation: "会社名、代表者、所在地、サービスをstructuredDataへ登録してください。" });
    }
    if (content.contentType === "job" && content.structuredData?.type !== "job") {
      issues.push({ code: "JOB_STRUCTURED_DATA_MISSING", severity: "warning", field: "structuredData", message: "求人の構造化データがありません。", recommendation: "職種、勤務地、業務内容、必須条件、募集状態をstructuredDataへ登録してください。" });
    }
    if (content.contentType === "pr" && content.structuredData?.type !== "pressRelease") {
      issues.push({ code: "PR_STRUCTURED_DATA_MISSING", severity: "warning", field: "structuredData", message: "プレスリリースの構造化データがありません。", recommendation: "発表日、発行者、メディア窓口をstructuredDataへ登録してください。" });
    }
    if (content.contentType === "ir" && content.structuredData?.type !== "ir") {
      issues.push({ code: "IR_STRUCTURED_DATA_MISSING", severity: "warning", field: "structuredData", message: "IRの構造化データがありません。", recommendation: "公表日、資料種別、対象期間、原資料URLをstructuredDataへ登録してください。" });
    }
    const result: SeoAuditResult = {
      contentId,
      contentVersion: content.version,
      score: Math.max(0, 100 - issues.reduce((total, issue) => total + (issue.severity === "error" ? 20 : issue.severity === "warning" ? 10 : 3), 0)),
      issues,
      auditedAt: new Date().toISOString(),
    };
    const patch: Partial<ContentRecord> = { lastSeoAudit: result };
    if (!issues.some((issue) => issue.severity === "error") && content.status !== "seo_reviewed") {
      patch.status = "seo_reviewed";
    }
    const updated = this.store.updateContent(content.id, patch, { incrementVersion: false });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return result;
  }

  public auditSiteSeo(principal: AuthenticatedPrincipal | null): SeoSiteAuditResult {
    this.assertProvider(principal, principal?.category);
    const category = principal!.category;
    const providerId = principal!.providerId!;
    this.portal.assertAction(principal, category, "seo.site_audit");

    const contents = this.store.listContent(category, providerId);
    const publicContents = contents.filter((content) =>
      (content.status === "approved" || content.status === "published") &&
      content.visibility === "public" &&
      (!content.expiresAt || Date.parse(content.expiresAt) > Date.now()),
    );
    const issues: SeoSiteAuditResult["issues"] = [];
    const canonicalOwners = new Map<string, ContentRecord[]>();
    const titleOwners = new Map<string, ContentRecord[]>();
    const knownPaths = new Set<string>();
    knownPaths.add("/");

    const addIssue = (
      issue: Omit<SeoSiteAuditResult["issues"][number], "contentId"> & { contentId?: string },
    ): void => {
      issues.push(issue);
    };

    if (publicContents.length === 0) {
      addIssue({
        code: "NO_PUBLIC_CONTENT",
        severity: "info",
        field: "contents",
        message: "公開対象のコンテンツがまだありません。",
        recommendation: "承認済みコンテンツを公開対象に追加してください。",
      });
    }

    for (const categorySlug of categorySlugs) {
      knownPaths.add(`/categories/${categorySlug}`);
      knownPaths.add(`/categories/${categorySlug}/providers`);
      for (const provider of this.portal.searchProviders(categorySlug, null, {})) {
        knownPaths.add(providerSeoPath(categorySlug, provider.id));
      }
    }

    for (const content of publicContents) {
      const canonicalPath = normalizeSeoPath(content.seo.canonicalPath);
      if (canonicalPath) knownPaths.add(canonicalPath);
    }

    for (const content of publicContents) {
      const canonicalPath = normalizeSeoPath(content.seo.canonicalPath);
      if (!canonicalPath) {
        addIssue({
          code: "CANONICAL_INVALID",
          severity: "error",
          contentId: content.id,
          field: "seo.canonicalPath",
          message: "公開対象のcanonicalがサイト内パスではありません。",
          recommendation: "先頭が / の一意なサイト内パスを設定してください。",
        });
      } else {
        knownPaths.add(canonicalPath);
        const owners = canonicalOwners.get(canonicalPath) ?? [];
        owners.push(content);
        canonicalOwners.set(canonicalPath, owners);
      }

      const title = content.seo.title.trim().toLocaleLowerCase("ja-JP");
      if (title) {
        const owners = titleOwners.get(title) ?? [];
        owners.push(content);
        titleOwners.set(title, owners);
      }

      if (!content.seo.jsonLdType || !["Organization", "Article", "BlogPosting", "JobPosting", "NewsArticle", "FAQPage"].includes(content.seo.jsonLdType)) {
        addIssue({
          code: "JSONLD_TYPE_MISSING",
          severity: "error",
          contentId: content.id,
          field: "seo.jsonLdType",
          message: "公開対象のJSON-LDタイプが設定されていません。",
          recommendation: "コンテンツ種別に対応するschema.orgのJSON-LDタイプを設定してください。",
        });
      }

      if (!content.lastSeoAudit || content.lastSeoAudit.contentVersion !== content.version) {
        addIssue({
          code: "SEO_AUDIT_STALE",
          severity: "error",
          contentId: content.id,
          field: "lastSeoAudit",
          message: "公開対象のSEO監査証跡が最新版ではありません。",
          recommendation: "最新版に対してコンテンツSEO監査を再実行してください。",
        });
      } else if (content.lastSeoAudit.issues.some((issue) => issue.severity === "error")) {
        addIssue({
          code: "SEO_AUDIT_HAS_ERRORS",
          severity: "error",
          contentId: content.id,
          field: "lastSeoAudit.issues",
          message: "公開対象のページSEO監査に重大な問題があります。",
          recommendation: "ページSEO監査のエラーを解消してから再監査してください。",
        });
      }

      if (!content.lastFactCheck || content.lastFactCheck.contentVersion !== content.version || !content.lastFactCheck.passed) {
        addIssue({
          code: "FACT_CHECK_STALE",
          severity: "error",
          contentId: content.id,
          field: "lastFactCheck",
          message: "公開対象の事実確認証跡が最新版ではないか、合格していません。",
          recommendation: "一次情報を登録し、最新版の事実確認を完了してください。",
        });
      }

      const links = [...content.body.matchAll(/\]\(\s*(\/[^)\s]+)[^)]*\)/g)].map((match) => normalizeSeoPath(match[1] ?? ""));
      if (publicContents.length > 1 && links.length === 0) {
        addIssue({
          code: "INTERNAL_LINK_MISSING",
          severity: "warning",
          contentId: content.id,
          field: "body",
          message: "同一カテゴリの公開対象へ向かう本文内リンクがありません。",
          recommendation: "関連する公開ページへの内部リンクを本文に追加してください。",
        });
      }
      for (const link of links) {
        if (link && !knownPaths.has(link) && link !== "/") {
          addIssue({
            code: "INTERNAL_LINK_TARGET_MISSING",
            severity: "warning",
            contentId: content.id,
            field: "body",
            message: `内部リンク先 ${link} が公開対象のcanonical一覧にありません。`,
            recommendation: "リンク先のcanonical、公開状態、またはリンクURLを確認してください。",
          });
        }
      }
    }

    for (const [canonicalPath, owners] of canonicalOwners) {
      if (owners.length < 2) continue;
      for (const content of owners) {
        addIssue({
          code: "CANONICAL_DUPLICATE",
          severity: "error",
          contentId: content.id,
          field: "seo.canonicalPath",
          message: `canonical ${canonicalPath} が複数の公開対象で重複しています。`,
          recommendation: "公開ページごとに一意のcanonicalパスを設定してください。",
        });
      }
    }

    for (const [title, owners] of titleOwners) {
      if (owners.length < 2) continue;
      for (const content of owners) {
        addIssue({
          code: "SEO_TITLE_DUPLICATE",
          severity: "warning",
          contentId: content.id,
          field: "seo.title",
          message: `SEOタイトル「${title}」が複数の公開対象で重複しています。`,
          recommendation: "検索意図とページ内容に合わせてSEOタイトルを固有化してください。",
        });
      }
    }

    const score = Math.max(0, 100 - issues.reduce((total, issue) => total + (issue.severity === "error" ? 20 : issue.severity === "warning" ? 10 : 3), 0));
    const result: SeoSiteAuditResult = {
      category,
      providerId,
      contentCount: contents.length,
      publicContentCount: publicContents.length,
      score,
      issues,
      auditedAt: new Date().toISOString(),
    };
    return this.store.saveSiteSeoAudit(result);
  }

  public factCheck(principal: AuthenticatedPrincipal | null, contentId: string): FactCheckResult {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.fact_check");
    const sourceFacts = content.sourceFacts.filter(Boolean);
    const sourceEvidence = content.sourceEvidence ?? [];
    const items = sourceFacts.length > 0 || sourceEvidence.length > 0
      ? [
        ...sourceFacts.map((claim) => ({ claim, status: "source_registered" as const, note: "事業者が一次情報として登録しています。外部検証は本番アダプターで実行します。" })),
        ...sourceEvidence.map((source) => ({ claim: `${source.title} (${source.url})`, status: "source_registered" as const, note: `最終確認日: ${source.checkedAt}` })),
      ]
      : [{ claim: "本文に含まれる企業固有情報", status: "source_missing" as const, note: "出典または確認済み情報が登録されていません。" }];
    const issues = sourceFacts.length > 0 || sourceEvidence.length > 0 ? [] : ["確認済みの一次情報がありません。公開前に出典を登録してください。"];
    const result: FactCheckResult = {
      contentId,
      contentVersion: content.version,
      passed: issues.length === 0,
      scope: "source_presence_only",
      items,
      issues,
      checkedAt: new Date().toISOString(),
    };
    const updated = this.store.updateContent(content.id, { lastFactCheck: result }, { incrementVersion: false });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return result;
  }

  private emitContentEvent(eventType: WebhookEventType, content: ContentRecord): void {
    this.webhook?.emit(content.category, content.providerId, eventType, {
      contentId: content.id,
      contentType: content.contentType,
      locale: content.locale,
      status: content.status,
      version: content.version,
    });
  }

  private getOwnedProposal(principal: AuthenticatedPrincipal | null, proposalId: string): ContentProposal {
    const proposal = this.store.getProposal(proposalId);
    if (!proposal) throw new ContentServiceError(404, "企画案が見つかりません。");
    this.assertProvider(principal, proposal.category, "content.read");
    if (proposal.providerId !== principal!.providerId) throw new ContentServiceError(404, "企画案が見つかりません。");
    return proposal;
  }

  private normalizeEditableText(value: string, fieldName: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized) throw new ContentServiceError(400, `${fieldName}は空にできません。`);
    return limit(normalized, maxLength);
  }

  private normalizeVisibility(value: ContentVisibility | undefined): ContentVisibility {
    if (value === undefined) return "public";
    if (!contentVisibilityValues.includes(value)) throw new ContentServiceError(400, "visibilityが不正です。public、unlisted、private、internalのいずれかを指定してください。");
    return value;
  }

  private normalizeTags(value: string[] | undefined): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) throw new ContentServiceError(400, "tagsは文字列配列で指定してください。");
    return trimList(value).slice(0, 30).map((tag) => limit(tag, 80));
  }

  private normalizeSeries(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    return normalized ? limit(normalized, 120) : undefined;
  }

  private normalizeAuthors(value: ContentAuthorProfile[] | undefined): ContentAuthorProfile[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 10) throw new ContentServiceError(400, "authorsは10人以内の配列で指定してください。");
    const authors: ContentAuthorProfile[] = [];
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object" || typeof item.name !== "string") throw new ContentServiceError(400, `authors[${index}].nameは必須です。`);
      const author = item as ContentAuthorProfile;
      const name = this.normalizeEditableText(author.name, `authors[${index}].name`, 160);
      const bio = typeof author.bio === "string" && author.bio.trim() ? limit(author.bio.trim(), 1_000) : undefined;
      const credentials = author.credentials === undefined ? undefined : this.normalizeTags(author.credentials).slice(0, 10);
      const profileUrl = author.profileUrl?.trim();
      if (profileUrl !== undefined && profileUrl !== "" && !(profileUrl.startsWith("/") && !profileUrl.startsWith("//"))) {
        try {
          if (new URL(profileUrl).protocol !== "https:") throw new Error("unsafe");
        } catch {
          throw new ContentServiceError(400, `authors[${index}].profileUrlはサイト内パスまたはHTTPS URLで指定してください。`);
        }
      }
      authors.push({
        ...(typeof author.id === "string" && author.id.trim() ? { id: limit(author.id.trim(), 160) } : {}),
        name,
        ...(bio ? { bio } : {}),
        ...(credentials && credentials.length > 0 ? { credentials } : {}),
        ...(profileUrl ? { profileUrl: limit(profileUrl, 2_000) } : {}),
      });
    }
    return authors;
  }

  private normalizeExpiresAt(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized || !/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
      throw new ContentServiceError(400, "expiresAtはISO 8601形式で指定してください。");
    }
    return normalized;
  }

  private normalizeBlocksAndBody(body: string | undefined, blocksInput: unknown): { body: string; blocks?: ContentBlock[] } {
    let blocks: ContentBlock[] | undefined;
    try {
      blocks = normalizeContentBlocks(blocksInput);
    } catch (error) {
      throw new ContentServiceError(400, error instanceof Error ? error.message : "blocksが不正です。");
    }
    if (blocks) {
      const rendered = renderContentBlocks(blocks);
      return { body: this.normalizeEditableText(rendered, "body", 200_000), blocks };
    }
    if (body === undefined) throw new ContentServiceError(400, "bodyまたはblocksが必要です。");
    return { body: this.normalizeEditableText(body, "body", 200_000) };
  }

  private normalizeStructuredData(contentType: ContentType, input: ContentStructuredData | undefined): ContentStructuredData | undefined {
    if (input === undefined) return undefined;
    if (!input || typeof input !== "object" || typeof input.type !== "string") {
      throw new ContentServiceError(400, "structuredDataの形式が不正です。typeを指定してください。");
    }
    const text = (value: unknown, field: string, maxLength: number, required = true): string | undefined => {
      if (value === undefined && !required) return undefined;
      if (typeof value !== "string") throw new ContentServiceError(400, `structuredData.${field}は文字列で指定してください。`);
      const normalized = value.trim();
      if (!normalized && required) throw new ContentServiceError(400, `structuredData.${field}は必須です。`);
      return normalized ? limit(normalized, maxLength) : undefined;
    };
    const list = (value: unknown, field: string, required = false): string[] | undefined => {
      if (value === undefined && !required) return undefined;
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new ContentServiceError(400, `structuredData.${field}は文字列配列で指定してください。`);
      }
      const normalized = trimList(value).slice(0, 50);
      if (required && normalized.length === 0) throw new ContentServiceError(400, `structuredData.${field}は1件以上必要です。`);
      return normalized;
    };
    const date = (value: unknown, field: string, required = true): string | undefined => {
      const normalized = text(value, field, 40, required);
      if (normalized === undefined) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
        throw new ContentServiceError(400, `structuredData.${field}はISO 8601形式で指定してください。`);
      }
      return normalized;
    };
    const url = (value: unknown, field: string): string | undefined => {
      const normalized = text(value, field, 2_000, false);
      if (normalized === undefined) return undefined;
      if (normalized.startsWith("/") && !normalized.startsWith("//")) return normalized;
      try {
        const parsed = new URL(normalized);
        if (parsed.protocol === "https:") return normalized;
      } catch {
        // 下の統一エラーへ進めます。
      }
      throw new ContentServiceError(400, `structuredData.${field}はサイト内パスまたはHTTPS URLで指定してください。`);
    };

    if (contentType === "company" && input.type === "company") {
      return {
        type: "company",
        companyName: text(input.companyName, "companyName", 160)!,
        ...(text(input.representative, "representative", 160, false) ? { representative: text(input.representative, "representative", 160, false) } : {}),
        ...(text(input.address, "address", 320, false) ? { address: text(input.address, "address", 320, false) } : {}),
        ...(list(input.services, "services") ? { services: list(input.services, "services") } : {}),
      };
    }
    if (contentType === "job" && input.type === "job") {
      const status = input.status;
      if (status !== "open" && status !== "closed") throw new ContentServiceError(400, "structuredData.statusはopenまたはclosedで指定してください。");
      return {
        type: "job",
        jobTitle: text(input.jobTitle, "jobTitle", 160)!,
        employmentType: text(input.employmentType, "employmentType", 120)!,
        locations: list(input.locations, "locations", true)!,
        responsibilities: list(input.responsibilities, "responsibilities", true)!,
        requirements: list(input.requirements, "requirements", true)!,
        ...(text(input.salary, "salary", 160, false) ? { salary: text(input.salary, "salary", 160, false) } : {}),
        ...(list(input.preferredQualifications, "preferredQualifications") ? { preferredQualifications: list(input.preferredQualifications, "preferredQualifications") } : {}),
        ...(list(input.benefits, "benefits") ? { benefits: list(input.benefits, "benefits") } : {}),
        ...(list(input.selectionProcess, "selectionProcess") ? { selectionProcess: list(input.selectionProcess, "selectionProcess") } : {}),
        ...(url(input.applicationUrl, "applicationUrl") ? { applicationUrl: url(input.applicationUrl, "applicationUrl") } : {}),
        ...(date(input.openingDate, "openingDate", false) ? { openingDate: date(input.openingDate, "openingDate", false) } : {}),
        ...(date(input.closingDate, "closingDate", false) ? { closingDate: date(input.closingDate, "closingDate", false) } : {}),
        status,
      };
    }
    if (contentType === "pr" && input.type === "pressRelease") {
      return {
        type: "pressRelease",
        releaseDate: date(input.releaseDate, "releaseDate")!,
        issuer: text(input.issuer, "issuer", 160)!,
        ...(text(input.mediaContact, "mediaContact", 320, false) ? { mediaContact: text(input.mediaContact, "mediaContact", 320, false) } : {}),
        ...(date(input.eventDate, "eventDate", false) ? { eventDate: date(input.eventDate, "eventDate", false) } : {}),
      };
    }
    if (contentType === "ir" && input.type === "ir") {
      const documentTypes = ["financial_results", "presentation", "notice", "shareholder", "calendar", "other"] as const;
      if (!documentTypes.includes(input.documentType)) throw new ContentServiceError(400, "structuredData.documentTypeが不正です。");
      if (input.withdrawn !== undefined && typeof input.withdrawn !== "boolean") throw new ContentServiceError(400, "structuredData.withdrawnは真偽値で指定してください。");
      return {
        type: "ir",
        publicationDate: date(input.publicationDate, "publicationDate")!,
        documentType: input.documentType,
        ...(text(input.fiscalPeriod, "fiscalPeriod", 120, false) ? { fiscalPeriod: text(input.fiscalPeriod, "fiscalPeriod", 120, false) } : {}),
        ...(url(input.sourceDocumentUrl, "sourceDocumentUrl") ? { sourceDocumentUrl: url(input.sourceDocumentUrl, "sourceDocumentUrl") } : {}),
        ...(text(input.correctionOfContentId, "correctionOfContentId", 160, false) ? { correctionOfContentId: text(input.correctionOfContentId, "correctionOfContentId", 160, false) } : {}),
        ...(input.withdrawn !== undefined ? { withdrawn: input.withdrawn } : {}),
      };
    }
    throw new ContentServiceError(400, `structuredData.type「${input.type}」はcontentType「${contentType}」と一致しません。`);
  }

  private cloneStructuredData(data: ContentStructuredData): ContentStructuredData {
    return JSON.parse(JSON.stringify(data)) as ContentStructuredData;
  }

  private normalizeSourceEvidence(input: ContentSourceEvidence[] | undefined): ContentSourceEvidence[] | undefined {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) throw new ContentServiceError(400, "sourceEvidenceは配列で指定してください。");
    if (input.length > 20) throw new ContentServiceError(400, "sourceEvidenceは20件以内で指定してください。");
    const normalized: ContentSourceEvidence[] = [];
    for (const [index, item] of input.entries()) {
      if (!item || typeof item !== "object") throw new ContentServiceError(400, `sourceEvidence[${index}]はオブジェクトで指定してください。`);
      const candidate = item as unknown as Record<string, unknown>;
      if (typeof candidate.title !== "string" || !candidate.title.trim()) throw new ContentServiceError(400, `sourceEvidence[${index}].titleは必須です。`);
      if (typeof candidate.url !== "string" || !candidate.url.trim()) throw new ContentServiceError(400, `sourceEvidence[${index}].urlは必須です。`);
      const title = limit(candidate.title.trim(), 200);
      const url = candidate.url.trim();
      if (!(url.startsWith("/") && !url.startsWith("//"))) {
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "https:") throw new Error("unsafe");
        } catch {
          throw new ContentServiceError(400, `sourceEvidence[${index}].urlはサイト内パスまたはHTTPS URLで指定してください。`);
        }
      }
      const checkedAt = typeof candidate.checkedAt === "string" ? candidate.checkedAt.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) {
        throw new ContentServiceError(400, `sourceEvidence[${index}].checkedAtはISO 8601形式で指定してください。`);
      }
      const publisher = typeof candidate.publisher === "string" && candidate.publisher.trim() ? limit(candidate.publisher.trim(), 160) : undefined;
      const note = typeof candidate.note === "string" && candidate.note.trim() ? limit(candidate.note.trim(), 1_000) : undefined;
      if (!normalized.some((source) => source.url === url)) {
        normalized.push({
          title,
          url,
          checkedAt,
          ...(publisher ? { publisher } : {}),
          ...(note ? { note } : {}),
        });
      }
    }
    return normalized;
  }

  private cloneSourceEvidence(evidence: ContentSourceEvidence[]): ContentSourceEvidence[] {
    return evidence.map((item) => ({ ...item }));
  }

  private cloneAuthors(authors: ContentAuthorProfile[]): ContentAuthorProfile[] {
    return authors.map((author) => ({
      ...author,
      ...(author.credentials ? { credentials: [...author.credentials] } : {}),
    }));
  }

  private normalizeAgentText(value: unknown, fieldName: string, maxLength: number): string {
    if (typeof value !== "string") throw new ContentServiceError(502, `AIエージェントの${fieldName}が文字列ではありません。`);
    const normalized = value.trim();
    if (!normalized) throw new ContentServiceError(502, `AIエージェントが${fieldName}を返しませんでした。`);
    return limit(normalized, maxLength);
  }

  private normalizeAgentList(value: unknown, fieldName: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new ContentServiceError(502, `AIエージェントの${fieldName}が文字列配列ではありません。`);
    }
    return trimList(value);
  }

  private normalizeMediaIds(principal: AuthenticatedPrincipal | null, mediaIds: string[] | undefined): string[] {
    const normalized = [...new Set((mediaIds ?? []).map((mediaId) => mediaId.trim()).filter(Boolean))];
    if (normalized.length > 20) throw new ContentServiceError(400, "mediaIdsは20件以内で指定してください。");
    if (normalized.length === 0) return [];
    if (!this.media) throw new ContentServiceError(503, "メディア連携が構成されていません。");
    try {
      this.media.getOwnedAssets(principal, normalized);
    } catch (error) {
      if (error instanceof Error) throw new ContentServiceError(400, `mediaIdsを確認できません。${error.message}`);
      throw error;
    }
    return normalized;
  }

  private async callAgent<T>(stage: string, callback: () => ContentAgentResult<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof ContentServiceError) throw error;
      const detail = error instanceof Error ? ` ${error.message}` : "";
      throw new ContentServiceError(502, `AIエージェントの${stage}に失敗しました。${detail}`.trim());
    }
  }

  private createGenerationAudit(operation: ContentGenerationOperation, inputSources: string[]): ContentGenerationAudit {
    const normalizedSources = [...new Set(inputSources.map((source) => source.trim()).filter(Boolean))].slice(0, 50);
    return {
      operation,
      adapterId: this.agent.id,
      ...(this.agent.model ? { model: this.agent.model } : {}),
      inputSources: normalizedSources,
      generatedAt: new Date().toISOString(),
    };
  }

  private assertInternalRole(principal: AuthenticatedPrincipal | null, category: CategorySlug, requiredRole: ContentInternalRole): void {
    const assignments = principal?.internalRoleAssignments ?? [];
    if (assignments.length === 0) return;
    const allowed = assignments.some((assignment) =>
      assignment.role === requiredRole &&
      (assignment.category === "*" || assignment.category === category) &&
      (!assignment.providerId || assignment.providerId === principal?.providerId),
    );
    if (!allowed) throw new ContentServiceError(403, `内部ロール${requiredRole}の権限が必要です。`);
  }

  private normalizeSlug(value: string): string {
    const slug = value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/.test(slug)) throw new ContentServiceError(400, "slugは英数字またはハイフンで1〜120文字にしてください。");
    return slug;
  }

  private createSeoForContent(contentType: ContentType, title: string, summary: string, slug: string, input: Partial<ContentSeo> | undefined): ContentSeo {
    const canonicalPath = input?.canonicalPath === undefined ? `/content/${slug}` : normalizeSeoPath(input.canonicalPath);
    if (!canonicalPath) throw new ContentServiceError(400, "seo.canonicalPathはスラッシュから始まるパスで指定してください。");
    const seoTitle = this.normalizeEditableText(input?.title ?? title, "seo.title", 60);
    const seoDescription = this.normalizeEditableText(input?.description ?? summary, "seo.description", 160);
    const ogTitle = this.normalizeEditableText(input?.ogTitle ?? seoTitle, "seo.ogTitle", 60);
    const ogDescription = this.normalizeEditableText(input?.ogDescription ?? seoDescription, "seo.ogDescription", 160);
    return {
      title: seoTitle,
      description: seoDescription,
      keywords: trimList(input?.keywords ?? [title]),
      canonicalPath,
      ogTitle,
      ogDescription,
      jsonLdType: input?.jsonLdType ?? jsonLdTypes[contentType],
      faq: input?.faq?.map((item) => ({ question: item.question.trim(), answer: item.answer.trim() })).filter((item) => item.question && item.answer) ?? [],
    };
  }

  private assertVersionNumber(versionNumber: number): void {
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new ContentServiceError(400, "versionは1以上の整数で指定してください。");
  }

  private assertApprovalReady(content: ContentRecord): void {
    if (!content.lastFactCheck || content.lastFactCheck.contentVersion !== content.version) {
      throw new ContentServiceError(409, "最新バージョンのファクトチェックを完了してから承認してください。");
    }
    if (!content.lastFactCheck.passed) {
      throw new ContentServiceError(409, "ファクトチェックに未解決の問題があるため承認できません。");
    }
    if (!content.lastSeoAudit || content.lastSeoAudit.contentVersion !== content.version) {
      throw new ContentServiceError(409, "最新バージョンのSEO監査を完了してから承認してください。");
    }
    if (content.lastSeoAudit.issues.some((issue) => issue.severity === "error")) {
      throw new ContentServiceError(409, "SEO監査に重大な問題があるため承認できません。");
    }
  }

  private normalizeReviewNote(note: string | undefined, required: boolean): string | undefined {
    const normalized = note?.trim() ?? "";
    if (required && normalized.length < 3) throw new ContentServiceError(400, "差し戻し理由を3文字以上で指定してください。");
    if (!normalized) return undefined;
    return limit(normalized, 1000);
  }

  private assertProvider(principal: AuthenticatedPrincipal | null, category: CategorySlug | undefined, action?: "content.read"): void {
    if (!principal) throw new ContentServiceError(401, "ログインが必要です。");
    if (principal.role !== "provider" || !principal.providerId) throw new ContentServiceError(403, "事業者だけがコンテンツを管理できます。");
    if (category && principal.category !== category) throw new ContentServiceError(403, "現在のカテゴリコンテキストが一致しません。");
    if (action) this.portal.assertAction(principal, principal.category, action);
  }
}

export function isContentType(value: unknown): value is ContentType {
  return typeof value === "string" && contentTypes.includes(value as ContentType);
}

export function isContentAudience(value: unknown): value is ContentAudience {
  return typeof value === "string" && contentAudiences.includes(value as ContentAudience);
}

export function isContentLocale(value: unknown): value is ContentLocale {
  return typeof value === "string" && contentLocales.includes(value as ContentLocale);
}

export function isContentWorkflowStatus(value: unknown): value is ContentWorkflowStatus {
  return typeof value === "string" && contentWorkflowStatuses.includes(value as ContentWorkflowStatus);
}

export function parseOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ContentServiceError(400, `${fieldName}は文字列配列で指定してください。`);
  }
  return value as string[];
}
