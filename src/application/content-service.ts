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
  type ContentJsonLdType,
  type ContentLocale,
  type ContentProposal,
  type ContentRecord,
  type ContentReviewRecord,
  type ContentSeo,
  type ContentType,
  type ContentVersionRecord,
  type FactCheckResult,
  type SeoAuditResult,
  type SeoSiteAuditResult,
} from "../domain/types.js";

export class ContentServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "ContentServiceError";
  }
}

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

function createBody(title: string, proposal: ContentProposal): string {
  const sections = proposal.outline
    .map((heading) => `## ${heading}\n\n${proposal.topic}について、${audienceIntents[proposal.audience]}ための情報を整理します。\n`)
    .join("\n");
  const facts = proposal.sourceFacts.length > 0
    ? `\n## 確認済み情報\n\n${proposal.sourceFacts.map((fact) => `- ${fact}`).join("\n")}\n`
    : "\n## 編集メモ\n\n公開前に、企業が保有する一次情報と出典を追加してください。\n";
  return `# ${title}\n\n${proposal.rationale}\n\n${sections}${facts}`.trim();
}

export class ContentService {
  public constructor(
    private readonly portal: PortalService,
    private readonly store = new ContentStore(),
  ) {}

  public createProposal(
    principal: AuthenticatedPrincipal | null,
    input: {
      category: CategorySlug;
      contentType: ContentType;
      audience: ContentAudience;
      topic: string;
      primaryKeyword?: string | undefined;
      relatedKeywords?: string[] | undefined;
      sourceFacts?: string[] | undefined;
    },
  ): ContentProposal {
    this.portal.assertAction(principal, input.category, "content.propose");
    this.assertProvider(principal, input.category);
    if (!principal || !principal.providerId) throw new ContentServiceError(403, "事業者情報が見つかりません。");

    const topic = input.topic.trim();
    if (topic.length < 3) throw new ContentServiceError(400, "topicは3文字以上で入力してください。");
    const primaryKeyword = (input.primaryKeyword?.trim() || topic).slice(0, 80);
    const sourceFacts = trimList(input.sourceFacts);
    const relatedKeywords = trimList([...(input.relatedKeywords ?? []), topic, audienceLabels[input.audience]]);
    const proposal: Omit<ContentProposal, "id" | "createdAt"> = {
      category: input.category,
      providerId: principal.providerId!,
      contentType: input.contentType,
      audience: input.audience,
      topic,
      searchIntent: audienceIntents[input.audience],
      primaryKeyword,
      relatedKeywords,
      outline: createOutline(input.audience),
      sourceFacts,
      rationale: `${contentTypeLabels[input.contentType]}として、${audienceLabels[input.audience]}に向けて「${topic}」を伝える企画です。${audienceIntents[input.audience]}。`,
    };
    return this.store.createProposal(proposal);
  }

  public listProposals(principal: AuthenticatedPrincipal | null): ContentProposal[] {
    this.assertProvider(principal, principal?.category);
    return this.store.listProposals(principal!.category, principal!.providerId!);
  }

  public createContent(
    principal: AuthenticatedPrincipal | null,
    input: {
      category: CategorySlug;
      contentType: ContentType;
      audience: ContentAudience;
      title: string;
      summary: string;
      body: string;
      slug?: string | undefined;
      sourceFacts?: string[] | undefined;
      locale?: ContentLocale | undefined;
      proposalId?: string | undefined;
      seo?: Partial<ContentSeo> | undefined;
    },
  ): ContentRecord {
    this.portal.assertAction(principal, input.category, "content.create");
    this.assertProvider(principal, input.category);
    if (!principal || !principal.providerId) throw new ContentServiceError(403, "事業者情報が見つかりません。");
    const title = this.normalizeEditableText(input.title, "title", 160);
    const summary = this.normalizeEditableText(input.summary, "summary", 320);
    const body = this.normalizeEditableText(input.body, "body", 200_000);
    const sourceFacts = trimList(input.sourceFacts);
    const locale = input.locale ?? "ja";
    let proposal: ContentProposal | undefined;
    if (input.proposalId !== undefined) {
      proposal = this.getOwnedProposal(principal, input.proposalId);
      if (proposal.category !== input.category || proposal.contentType !== input.contentType || proposal.audience !== input.audience) {
        throw new ContentServiceError(409, "proposalIdのカテゴリ、コンテンツ種別、対象ポジションが入力内容と一致しません。");
      }
    } else {
      proposal = this.store.createProposal({
        category: input.category,
        providerId: principal.providerId,
        contentType: input.contentType,
        audience: input.audience,
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
    return this.store.createContent({
      category: input.category,
      providerId: principal.providerId,
      contentType: input.contentType,
      audience: input.audience,
      title,
      slug,
      summary,
      body,
      seo,
      sourceFacts,
      proposalId: proposal.id,
      locale,
      status: "drafted",
    }, { ...(principal.accountId ? { actorId: principal.accountId } : {}) });
  }

  public createDraft(principal: AuthenticatedPrincipal | null, proposalId: string): ContentRecord {
    const proposal = this.getOwnedProposal(principal, proposalId);
    this.portal.assertAction(principal, proposal.category, "content.draft");

    const title = `${proposal.topic}｜${audienceLabels[proposal.audience]}向け${contentTypeLabels[proposal.contentType]}`;
    const summary = limit(`${proposal.topic}について、${audienceIntents[proposal.audience]}ためのCMS-OS編集原稿です。`, 160);
    const seoTitle = limit(title, 60);
    const seoDescription = limit(summary, 160);
    return this.store.createContent({
      category: proposal.category,
      providerId: proposal.providerId,
      contentType: proposal.contentType,
      audience: proposal.audience,
      title,
      slug: `content-${proposal.id.slice(-12)}`,
      summary,
      body: createBody(title, proposal),
      seo: {
        title: seoTitle,
        description: seoDescription,
        keywords: [proposal.primaryKeyword, ...proposal.relatedKeywords],
        canonicalPath: `/content/content-${proposal.id.slice(-12)}`,
        ogTitle: seoTitle,
        ogDescription: seoDescription,
        jsonLdType: jsonLdTypes[proposal.contentType],
        faq: proposal.outline.slice(-1).map((question) => ({
          question: `${question}は確認できますか？`,
          answer: "公開前に一次情報と担当者の確認結果を反映します。",
        })),
      },
      sourceFacts: proposal.sourceFacts,
      proposalId: proposal.id,
      locale: "ja",
      status: "drafted",
    }, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
  }

  public listContent(principal: AuthenticatedPrincipal | null): ContentRecord[] {
    this.assertProvider(principal, principal?.category);
    return this.store.listContent(principal!.category, principal!.providerId!);
  }

  public getContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.store.getContent(contentId);
    if (!content) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    this.assertProvider(principal, content.category);
    if (content.providerId !== principal!.providerId) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return content;
  }

  public translateContent(
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
  ): ContentRecord {
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
    const translationNote = input.instructions?.trim() ? `\n\n> 翻訳指示: ${this.normalizeEditableText(input.instructions, "instructions", 1000)}` : "";
    const title = input.title !== undefined
      ? this.normalizeEditableText(input.title, "title", 160)
      : `【${targetLabel}翻訳下書き】${source.title}`;
    const summary = input.summary !== undefined
      ? this.normalizeEditableText(input.summary, "summary", 320)
      : `翻訳先: ${targetLabel}。原文「${source.summary}」をもとにした翻訳下書きです。`;
    const body = input.body !== undefined
      ? this.normalizeEditableText(input.body, "body", 200_000)
      : `# ${title}\n\n> 翻訳先: ${targetLabel}\n> 原文コンテンツID: ${source.id}\n> 原文バージョン: ${source.version}\n\n${source.body}${translationNote}`;
    const seo: ContentSeo = {
      ...source.seo,
      ...(input.seo ?? {}),
      title: input.seo?.title !== undefined ? input.seo.title : `【${targetLabel}】${source.seo.title}`,
      description: input.seo?.description !== undefined ? input.seo.description : `翻訳版: ${source.seo.description}`,
      ogTitle: input.seo?.ogTitle !== undefined ? input.seo.ogTitle : `【${targetLabel}】${source.seo.ogTitle}`,
      ogDescription: input.seo?.ogDescription !== undefined ? input.seo.ogDescription : `翻訳版: ${source.seo.ogDescription}`,
      keywords: input.seo?.keywords !== undefined ? trimList(input.seo.keywords) : trimList([...source.seo.keywords, input.targetLocale]),
      canonicalPath: input.seo?.canonicalPath !== undefined ? input.seo.canonicalPath : `/${localeSegment}${source.seo.canonicalPath}`,
      faq: input.seo?.faq !== undefined ? input.seo.faq.map((item) => ({ ...item })) : source.seo.faq.map((item) => ({ ...item })),
    };
    seo.title = limit(seo.title.trim(), 60);
    seo.description = limit(seo.description.trim(), 160);
    seo.ogTitle = limit(seo.ogTitle.trim(), 60);
    seo.ogDescription = limit(seo.ogDescription.trim(), 160);
    if (!seo.canonicalPath.startsWith("/")) seo.canonicalPath = `/${localeSegment}${source.seo.canonicalPath}`;

    return this.store.createContent({
      category: source.category,
      providerId: source.providerId,
      contentType: source.contentType,
      audience: source.audience,
      title,
      slug: `${source.slug}-${localeSegment}`,
      summary,
      body,
      seo,
      sourceFacts: [...source.sourceFacts],
      proposalId: source.proposalId,
      locale: input.targetLocale,
      translationOf: {
        contentId: source.id,
        sourceVersion: source.version,
        sourceLocale: source.locale,
      },
      status: "drafted",
    }, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
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
    return restored;
  }

  public listReviews(principal: AuthenticatedPrincipal | null, contentId: string): ContentReviewRecord[] {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "workflow.reviews");
    return this.store.listReviews(content.id);
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
      seo?: Partial<ContentSeo>;
      sourceFacts?: string[];
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
    if (input.body !== undefined) patch.body = this.normalizeEditableText(input.body, "body", 200_000);
    if (input.sourceFacts !== undefined) patch.sourceFacts = trimList(input.sourceFacts);
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
    return updated;
  }

  public duplicateContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.duplicate");
    if (content.status === "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツは複製できません。復元してから実行してください。");
    const copySuffix = randomUUID().slice(0, 8);

    return this.store.createContent({
      category: content.category,
      providerId: content.providerId,
      contentType: content.contentType,
      audience: content.audience,
      title: `${content.title}（複製）`,
      slug: `${content.slug}-copy-${copySuffix}`,
      summary: content.summary,
      body: content.body,
      seo: { ...content.seo, canonicalPath: `${content.seo.canonicalPath}-copy-${copySuffix}` },
      sourceFacts: [...content.sourceFacts],
      proposalId: content.proposalId,
      locale: content.locale,
      ...(content.translationOf ? { translationOf: { ...content.translationOf } } : {}),
      status: "drafted",
    }, { ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
  }

  public archiveContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.archive");
    if (content.status === "published") throw new ContentServiceError(409, "公開済みコンテンツは公開取消を確認してからアーカイブしてください。");
    if (content.status === "archived") return content;
    const archived = this.store.updateContent(content.id, { status: "archived" }, { reason: "workflow", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!archived) throw new ContentServiceError(404, "コンテンツが見つかりません。");
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
    return unpublished;
  }

  public restoreContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.restore");
    if (content.status !== "archived") throw new ContentServiceError(409, "アーカイブ済みコンテンツだけを復元できます。");
    const restored = this.store.updateContent(content.id, { status: "drafted" }, { reason: "workflow", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!restored) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return restored;
  }

  public markPublished(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "publication.publish");
    if (content.status === "published") return content;
    if (content.status !== "approved") throw new ContentServiceError(409, "承認済みコンテンツだけを公開できます。");
    const published = this.store.updateContent(content.id, { status: "published" }, { reason: "workflow", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!published) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return published;
  }

  public polishContent(principal: AuthenticatedPrincipal | null, contentId: string, instructions?: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "content.polish");
    if (content.status === "review_requested") throw new ContentServiceError(409, "レビュー中のコンテンツは清書できません。差し戻しを待ってください。");
    const normalizedBody = content.body
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const instructionNote = instructions?.trim() ? `\n\n> 清書方針: ${instructions.trim()}` : "";
    const updated = this.store.updateContent(content.id, {
      body: `${normalizedBody}${instructionNote}`,
      status: "polished",
      seo: { ...content.seo, title: limit(content.seo.title.trim(), 60), description: limit(content.seo.description.trim(), 160) },
    }, { reason: "polished", ...(principal?.accountId ? { actorId: principal.accountId } : {}) });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    return updated;
  }

  public approveContent(principal: AuthenticatedPrincipal | null, contentId: string): ContentRecord {
    const content = this.getContent(principal, contentId);
    this.portal.assertAction(principal, content.category, "workflow.approve");
    if (content.status !== "seo_reviewed" && content.status !== "review_requested") {
      throw new ContentServiceError(409, "SEO監査済みのコンテンツだけを公開承認できます。");
    }
    const review = content.status === "review_requested" ? this.store.listReviews(content.id)[0] : undefined;
    if (content.status === "review_requested" && (!review || review.status !== "requested")) {
      throw new ContentServiceError(409, "有効なレビュー依頼が見つかりません。");
    }
    this.assertApprovalReady(content);
    const updated = this.store.updateContent(content.id, { status: "approved" }, { incrementVersion: false });
    if (!updated) throw new ContentServiceError(404, "コンテンツが見つかりません。");
    if (review) {
      this.store.updateReview(review.id, {
        status: "approved",
        reviewerAccountId: principal!.accountId,
        reviewedAt: new Date().toISOString(),
      });
    }
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
    if (content.seo.title.length < 10 || content.seo.title.length > 60) {
      issues.push({ code: "SEO_TITLE_LENGTH", severity: "warning", field: "seo.title", message: "SEOタイトルは10〜60文字を目安にしてください。", recommendation: "検索意図を残しながらタイトルを調整してください。" });
    }
    if (content.seo.description.length < 50 || content.seo.description.length > 160) {
      issues.push({ code: "SEO_DESCRIPTION_LENGTH", severity: "warning", field: "seo.description", message: "メタディスクリプションは50〜160文字を目安にしてください。", recommendation: "読者が得られる情報と次の行動を具体化してください。" });
    }
    if (primaryKeyword && !`${content.seo.title}\n${content.body}`.toLocaleLowerCase("ja-JP").includes(primaryKeyword.toLocaleLowerCase("ja-JP"))) {
      issues.push({ code: "PRIMARY_KEYWORD_MISSING", severity: "warning", field: "seo.keywords", message: "主キーワードがタイトルまたは本文に含まれていません。", recommendation: "検索意図を損なわない範囲で自然に追加してください。" });
    }
    if (!content.body.match(/^# /m)) {
      issues.push({ code: "H1_MISSING", severity: "error", field: "body", message: "本文にH1見出しがありません。", recommendation: "ページごとに主題を表すH1を1つ設定してください。" });
    }
    if (!content.seo.canonicalPath.startsWith("/")) {
      issues.push({ code: "CANONICAL_INVALID", severity: "error", field: "seo.canonicalPath", message: "canonicalPathはサイト内パスで指定してください。", recommendation: "先頭にスラッシュを付けた正規URLパスを設定してください。" });
    }
    if (content.sourceFacts.length === 0) {
      issues.push({ code: "SOURCE_FACTS_EMPTY", severity: "warning", field: "sourceFacts", message: "確認済みの一次情報が登録されていません。", recommendation: "公開前に出典、数値、日付、担当者を登録してください。" });
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
    const publicContents = contents.filter((content) => content.status === "approved" || content.status === "published");
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
    const items = sourceFacts.length > 0
      ? sourceFacts.map((claim) => ({ claim, status: "source_registered" as const, note: "事業者が一次情報として登録しています。外部検証は本番アダプターで実行します。" }))
      : [{ claim: "本文に含まれる企業固有情報", status: "source_missing" as const, note: "出典または確認済み情報が登録されていません。" }];
    const issues = sourceFacts.length > 0 ? [] : ["確認済みの一次情報がありません。公開前に出典を登録してください。"];
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

  private getOwnedProposal(principal: AuthenticatedPrincipal | null, proposalId: string): ContentProposal {
    const proposal = this.store.getProposal(proposalId);
    if (!proposal) throw new ContentServiceError(404, "企画案が見つかりません。");
    this.assertProvider(principal, proposal.category);
    if (proposal.providerId !== principal!.providerId) throw new ContentServiceError(404, "企画案が見つかりません。");
    return proposal;
  }

  private normalizeEditableText(value: string, fieldName: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized) throw new ContentServiceError(400, `${fieldName}は空にできません。`);
    return limit(normalized, maxLength);
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

  private assertProvider(principal: AuthenticatedPrincipal | null, category: CategorySlug | undefined): void {
    if (!principal) throw new ContentServiceError(401, "ログインが必要です。");
    if (principal.role !== "provider" || !principal.providerId) throw new ContentServiceError(403, "事業者だけがコンテンツを管理できます。");
    if (category && principal.category !== category) throw new ContentServiceError(403, "現在のカテゴリコンテキストが一致しません。");
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

export function parseOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ContentServiceError(400, `${fieldName}は文字列配列で指定してください。`);
  }
  return value as string[];
}
