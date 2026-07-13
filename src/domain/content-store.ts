import { randomUUID } from "node:crypto";
import type { ContentProposal, ContentRecord, ContentVersionReason, ContentVersionRecord } from "./types.js";
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

  public constructor(private readonly stateStore?: StateStore) {
    this.proposals = stateStore?.load<ContentProposal[]>("content-proposals.json", []) ?? [];
    this.contents = stateStore?.load<ContentRecord[]>("content-records.json", []) ?? [];
    this.versions = stateStore?.load<ContentVersionRecord[]>("content-versions.json", []) ?? [];
    for (const content of this.contents) {
      if (!this.versions.some((version) => version.contentId === content.id)) {
        this.versions.push(this.createVersionSnapshot(content, "migrated"));
      }
    }
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
    input: Omit<ContentRecord, "id" | "version" | "createdAt" | "updatedAt">,
    options: { actorId?: string } = {},
  ): ContentRecord {
    const now = new Date().toISOString();
    const content: ContentRecord = {
      ...input,
      id: `content-${randomUUID()}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.contents.push(content);
    this.versions.push(this.createVersionSnapshot(content, "created", options.actorId));
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

  public listVersions(contentId: string): ContentVersionRecord[] {
    return this.versions
      .filter((version) => version.contentId === contentId)
      .sort((left, right) => right.version - left.version);
  }

  public getVersion(contentId: string, versionNumber: number): ContentVersionRecord | undefined {
    return this.versions.find((version) => version.contentId === contentId && version.version === versionNumber);
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
    this.stateStore?.save("content-records.json", this.contents);
    if (options.incrementVersion !== false) {
      this.versions.push(this.createVersionSnapshot(content, options.reason ?? "updated", options.actorId));
      this.stateStore?.save("content-versions.json", this.versions);
    }
    return content;
  }

  public restoreVersion(contentId: string, versionNumber: number, options: ContentRestoreOptions = {}): ContentRecord | undefined {
    const content = this.getContent(contentId);
    const version = this.getVersion(contentId, versionNumber);
    if (!content || !version) return undefined;

    Object.assign(content, {
      title: version.title,
      summary: version.summary,
      body: version.body,
      seo: this.cloneSeo(version.seo),
      sourceFacts: [...version.sourceFacts],
      status: "drafted" as const,
      version: content.version + 1,
      updatedAt: new Date().toISOString(),
    });
    delete content.lastSeoAudit;
    delete content.lastFactCheck;
    this.versions.push(this.createVersionSnapshot(content, "restored", options.actorId));
    this.stateStore?.save("content-records.json", this.contents);
    this.stateStore?.save("content-versions.json", this.versions);
    return content;
  }

  private createVersionSnapshot(content: ContentRecord, reason: ContentVersionReason, actorId?: string): ContentVersionRecord {
    return {
      id: `content-version-${randomUUID()}`,
      contentId: content.id,
      version: content.version,
      title: content.title,
      summary: content.summary,
      body: content.body,
      seo: this.cloneSeo(content.seo),
      sourceFacts: [...content.sourceFacts],
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
}
