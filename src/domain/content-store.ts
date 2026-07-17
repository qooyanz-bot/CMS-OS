import { randomUUID } from "node:crypto";
import type { ContentBlock, ContentEditorialActionRecord, ContentGenerationAudit, ContentProposal, ContentRecord, ContentReviewRecord, ContentSourceEvidence, ContentStructuredData, ContentVersionReason, ContentVersionRecord, SeoSiteAuditResult } from "./types.js";
import type { StateStore } from "../infrastructure/json-state-store.js";

interface ContentMutationOptions {
  incrementVersion?: boolean;
  reason?: ContentVersionReason;
  actorId?: string;
}

interface ContentRestoreOptions {
  actorId?: string;
}

export class ContentStore {
  private readonly proposals: ContentProposal[];
  private readonly contents: ContentRecord[];
  private readonly versions: ContentVersionRecord[];
  private readonly reviews: ContentReviewRecord[];
  private readonly editorialActions: ContentEditorialActionRecord[];
  private readonly siteSeoAudits: SeoSiteAuditResult[];

  public constructor(private readonly stateStore?: StateStore) {
    this.proposals = stateStore?.load<ContentProposal[]>("content-proposals.json", []) ?? [];
    this.contents = stateStore?.load<ContentRecord[]>("content-records.json", []) ?? [];
    this.versions = stateStore?.load<ContentVersionRecord[]>("content-versions.json", []) ?? [];
    this.reviews = stateStore?.load<ContentReviewRecord[]>("content-review-records.json", []) ?? [];
    this.editorialActions = stateStore?.load<ContentEditorialActionRecord[]>("content-editorial-actions.json", []) ?? [];
    this.siteSeoAudits = stateStore?.load<SeoSiteAuditResult[]>("seo-site-audits.json", []) ?? [];
    for (const content of this.contents) {
      if (!content.locale) content.locale = "ja";
      if (!content.visibility) content.visibility = "public";
      if (!Array.isArray(content.tags)) content.tags = [];
      if (typeof content.featured !== "boolean") content.featured = false;
      if (!Number.isSafeInteger(content.readingTimeMinutes) || content.readingTimeMinutes < 1) content.readingTimeMinutes = Math.max(1, Math.ceil(content.body.replace(/\s+/g, "").length / 500));
      if (!content.createdBy) content.createdBy = "system:migrated";
      if (content.generationAudit) content.generationAudit = this.cloneGenerationAudit(content.generationAudit);
    }
    for (const version of this.versions) {
      if (!version.locale) version.locale = "ja";
      if (!version.visibility) version.visibility = "public";
      if (!Array.isArray(version.tags)) version.tags = [];
      if (typeof version.featured !== "boolean") version.featured = false;
      if (!Number.isSafeInteger(version.readingTimeMinutes) || version.readingTimeMinutes < 1) version.readingTimeMinutes = Math.max(1, Math.ceil(version.body.replace(/\s+/g, "").length / 500));
      if (!version.createdBy) version.createdBy = version.actorId ?? "system:migrated";
      if (version.generationAudit) version.generationAudit = this.cloneGenerationAudit(version.generationAudit);
    }
    for (const content of this.contents) {
      if (!this.versions.some((version) => version.contentId === content.id)) {
        this.versions.push(this.createVersionSnapshot(content, "migrated"));
      }
      const latest = this.versions
        .filter((version) => version.contentId === content.id)
        .sort((left, right) => right.version - left.version)[0];
      if (latest) content.currentVersionId = latest.id;
    }
    this.stateStore?.save("content-records.json", this.contents);
    this.stateStore?.save("content-versions.json", this.versions);
  }

  public createProposal(input: Omit<ContentProposal, "id" | "createdAt">): ContentProposal {
    const proposal: ContentProposal = {
      ...input,
      id: `proposal-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.proposals.push(proposal);
    this.stateStore?.save("content-proposals.json", this.proposals);
    return proposal;
  }

  public listProposals(category: ContentProposal["category"], providerId: string): ContentProposal[] {
    return this.proposals.filter((proposal) => proposal.category === category && proposal.providerId === providerId);
  }

  public getProposal(proposalId: string): ContentProposal | undefined {
    return this.proposals.find((proposal) => proposal.id === proposalId);
  }

  public createContent(
    input: Omit<ContentRecord, "id" | "version" | "createdAt" | "updatedAt" | "currentVersionId">,
    options: { actorId?: string } = {},
  ): ContentRecord {
    const now = new Date().toISOString();
    const content: ContentRecord = {
      ...input,
      ...(input.blocks ? { blocks: this.cloneBlocks(input.blocks) } : {}),
      ...(input.structuredData ? { structuredData: this.cloneStructuredData(input.structuredData) } : {}),
      ...(input.sourceEvidence ? { sourceEvidence: this.cloneSourceEvidence(input.sourceEvidence) } : {}),
      ...(input.authors ? { authors: this.cloneAuthors(input.authors) } : {}),
      ...(input.generationAudit ? { generationAudit: this.cloneGenerationAudit(input.generationAudit) } : {}),
      id: `content-${randomUUID()}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
      currentVersionId: "",
    };
    this.contents.push(content);
    const snapshot = this.createVersionSnapshot(content, "created", options.actorId);
    content.currentVersionId = snapshot.id;
    this.versions.push(snapshot);
    this.stateStore?.save("content-records.json", this.contents);
    this.stateStore?.save("content-versions.json", this.versions);
    return content;
  }

  public listContent(category: ContentRecord["category"], providerId: string): ContentRecord[] {
    return this.contents.filter((content) => content.category === category && content.providerId === providerId);
  }

  public getContent(contentId: string): ContentRecord | undefined {
    return this.contents.find((content) => content.id === contentId);
  }

  public saveSiteSeoAudit(result: SeoSiteAuditResult): SeoSiteAuditResult {
    const index = this.siteSeoAudits.findIndex((audit) => audit.category === result.category && audit.providerId === result.providerId);
    if (index >= 0) this.siteSeoAudits[index] = result;
    else this.siteSeoAudits.push(result);
    this.stateStore?.save("seo-site-audits.json", this.siteSeoAudits);
    return result;
  }

  public getSiteSeoAudit(category: SeoSiteAuditResult["category"], providerId: string): SeoSiteAuditResult | undefined {
    return this.siteSeoAudits.find((audit) => audit.category === category && audit.providerId === providerId);
  }

  public listVersions(contentId: string): ContentVersionRecord[] {
    return this.versions
      .filter((version) => version.contentId === contentId)
      .sort((left, right) => right.version - left.version);
  }

  public getVersion(contentId: string, versionNumber: number): ContentVersionRecord | undefined {
    return this.versions.find((version) => version.contentId === contentId && version.version === versionNumber);
  }

  public createReview(input: Omit<ContentReviewRecord, "id" | "createdAt" | "updatedAt">): ContentReviewRecord {
    const now = new Date().toISOString();
    const review: ContentReviewRecord = {
      ...input,
      id: `content-review-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.reviews.push(review);
    this.stateStore?.save("content-review-records.json", this.reviews);
    return review;
  }

  public listReviews(contentId: string): ContentReviewRecord[] {
    return this.reviews
      .filter((review) => review.contentId === contentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public getReview(reviewId: string): ContentReviewRecord | undefined {
    return this.reviews.find((review) => review.id === reviewId);
  }

  public createEditorialAction(input: Omit<ContentEditorialActionRecord, "id" | "createdAt">): ContentEditorialActionRecord {
    const action: ContentEditorialActionRecord = {
      ...input,
      ...(input.beforeBlocks ? { beforeBlocks: this.cloneBlocks(input.beforeBlocks) } : {}),
      ...(input.beforeStructuredData ? { beforeStructuredData: this.cloneStructuredData(input.beforeStructuredData) } : {}),
      ...(input.beforeSourceEvidence ? { beforeSourceEvidence: this.cloneSourceEvidence(input.beforeSourceEvidence) } : {}),
      ...(input.afterBlocks ? { afterBlocks: this.cloneBlocks(input.afterBlocks) } : {}),
      ...(input.afterStructuredData ? { afterStructuredData: this.cloneStructuredData(input.afterStructuredData) } : {}),
      ...(input.afterSourceEvidence ? { afterSourceEvidence: this.cloneSourceEvidence(input.afterSourceEvidence) } : {}),
      id: `content-editorial-action-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.editorialActions.push(action);
    this.stateStore?.save("content-editorial-actions.json", this.editorialActions);
    return action;
  }

  public listEditorialActions(contentId: string): ContentEditorialActionRecord[] {
    return this.editorialActions
      .filter((action) => action.contentId === contentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public updateReview(reviewId: string, patch: Partial<ContentReviewRecord>): ContentReviewRecord | undefined {
    const review = this.getReview(reviewId);
    if (!review) return undefined;
    Object.assign(review, patch, { updatedAt: new Date().toISOString() });
    this.stateStore?.save("content-review-records.json", this.reviews);
    return review;
  }

  public updateContent(
    contentId: string,
    patch: Partial<ContentRecord>,
    options: ContentMutationOptions = {},
  ): ContentRecord | undefined {
    const content = this.getContent(contentId);
    if (!content) return undefined;
    const versionPatch = options.incrementVersion === false ? {} : { version: content.version + 1 };
    Object.assign(content, patch, versionPatch, { updatedAt: new Date().toISOString() });
    if (options.incrementVersion !== false) {
      const snapshot = this.createVersionSnapshot(content, options.reason ?? "updated", options.actorId);
      content.currentVersionId = snapshot.id;
      this.versions.push(snapshot);
      this.stateStore?.save("content-versions.json", this.versions);
    }
    this.stateStore?.save("content-records.json", this.contents);
    return content;
  }

  public restoreVersion(contentId: string, versionNumber: number, options: ContentRestoreOptions = {}): ContentRecord | undefined {
    const content = this.getContent(contentId);
    const version = this.getVersion(contentId, versionNumber);
    if (!content || !version) return undefined;

    Object.assign(content, {
      ...(version.blocks ? { blocks: this.cloneBlocks(version.blocks) } : { blocks: undefined }),
      ...(version.structuredData ? { structuredData: this.cloneStructuredData(version.structuredData) } : { structuredData: undefined }),
      ...(version.sourceEvidence ? { sourceEvidence: this.cloneSourceEvidence(version.sourceEvidence) } : { sourceEvidence: undefined }),
      ...(version.authors ? { authors: this.cloneAuthors(version.authors) } : { authors: undefined }),
      title: version.title,
      summary: version.summary,
      body: version.body,
      seo: this.cloneSeo(version.seo),
      sourceFacts: [...version.sourceFacts],
      ...(version.mediaIds ? { mediaIds: [...version.mediaIds] } : {}),
      visibility: version.visibility,
      tags: [...version.tags],
      featured: version.featured,
      readingTimeMinutes: version.readingTimeMinutes,
      createdBy: version.createdBy,
      ...(version.series ? { series: version.series } : { series: undefined }),
      ...(version.publishedAt ? { publishedAt: version.publishedAt } : { publishedAt: undefined }),
      ...(version.expiresAt ? { expiresAt: version.expiresAt } : { expiresAt: undefined }),
      ...(version.reviewedBy ? { reviewedBy: version.reviewedBy } : { reviewedBy: undefined }),
      ...(version.generationAudit ? { generationAudit: this.cloneGenerationAudit(version.generationAudit) } : { generationAudit: undefined }),
      status: "drafted" as const,
      version: content.version + 1,
      updatedAt: new Date().toISOString(),
    });
    delete content.lastSeoAudit;
    delete content.lastFactCheck;
    const snapshot = this.createVersionSnapshot(content, "restored", options.actorId);
    content.currentVersionId = snapshot.id;
    this.versions.push(snapshot);
    this.stateStore?.save("content-records.json", this.contents);
    this.stateStore?.save("content-versions.json", this.versions);
    return content;
  }

  private createVersionSnapshot(content: ContentRecord, reason: ContentVersionReason, actorId?: string): ContentVersionRecord {
    return {
      id: `content-version-${randomUUID()}`,
      contentId: content.id,
      version: content.version,
      ...(content.blocks ? { blocks: this.cloneBlocks(content.blocks) } : {}),
      ...(content.structuredData ? { structuredData: this.cloneStructuredData(content.structuredData) } : {}),
      ...(content.sourceEvidence ? { sourceEvidence: this.cloneSourceEvidence(content.sourceEvidence) } : {}),
      ...(content.authors ? { authors: this.cloneAuthors(content.authors) } : {}),
      ...(content.mediaIds ? { mediaIds: [...content.mediaIds] } : {}),
      title: content.title,
      summary: content.summary,
      body: content.body,
      seo: this.cloneSeo(content.seo),
      sourceFacts: [...content.sourceFacts],
      locale: content.locale,
      ...(content.translationOf ? { translationOf: { ...content.translationOf } } : {}),
      visibility: content.visibility,
      tags: [...content.tags],
      featured: content.featured,
      readingTimeMinutes: content.readingTimeMinutes,
      createdBy: content.createdBy,
      ...(content.series ? { series: content.series } : { series: undefined }),
      ...(content.publishedAt ? { publishedAt: content.publishedAt } : { publishedAt: undefined }),
      ...(content.expiresAt ? { expiresAt: content.expiresAt } : { expiresAt: undefined }),
      ...(content.reviewedBy ? { reviewedBy: content.reviewedBy } : { reviewedBy: undefined }),
      ...(content.generationAudit ? { generationAudit: this.cloneGenerationAudit(content.generationAudit) } : { generationAudit: undefined }),
      status: content.status,
      reason,
      ...(actorId ? { actorId } : {}),
      createdAt: content.updatedAt,
    };
  }

  private cloneSeo(seo: ContentRecord["seo"]): ContentRecord["seo"] {
    return {
      ...seo,
      keywords: [...seo.keywords],
      faq: seo.faq.map((item) => ({ ...item })),
    };
  }

  private cloneGenerationAudit(audit: ContentGenerationAudit): ContentGenerationAudit {
    return { ...audit, inputSources: [...audit.inputSources] };
  }

  private cloneBlocks(blocks: ContentBlock[]): ContentBlock[] {
    return blocks.map((block) => JSON.parse(JSON.stringify(block)) as ContentBlock);
  }

  private cloneStructuredData(data: ContentStructuredData): ContentStructuredData {
    return JSON.parse(JSON.stringify(data)) as ContentStructuredData;
  }

  private cloneSourceEvidence(evidence: ContentSourceEvidence[]): ContentSourceEvidence[] {
    return evidence.map((item) => ({ ...item }));
  }

  private cloneAuthors(authors: ContentRecord["authors"]): ContentRecord["authors"] {
    return authors?.map((author) => ({ ...author, ...(author.credentials ? { credentials: [...author.credentials] } : {}) }));
  }
}
