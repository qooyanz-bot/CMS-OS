import { randomUUID } from "node:crypto";
import type { ContentProposal, ContentRecord } from "./types.js";

export class ContentStore {
  private readonly proposals: ContentProposal[] = [];
  private readonly contents: ContentRecord[] = [];

  public createProposal(input: Omit<ContentProposal, "id" | "createdAt">): ContentProposal {
    const proposal: ContentProposal = {
      ...input,
      id: `proposal-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.proposals.push(proposal);
    return proposal;
  }

  public listProposals(category: ContentProposal["category"], providerId: string): ContentProposal[] {
    return this.proposals.filter((proposal) => proposal.category === category && proposal.providerId === providerId);
  }

  public getProposal(proposalId: string): ContentProposal | undefined {
    return this.proposals.find((proposal) => proposal.id === proposalId);
  }

  public createContent(input: Omit<ContentRecord, "id" | "version" | "createdAt" | "updatedAt">): ContentRecord {
    const now = new Date().toISOString();
    const content: ContentRecord = {
      ...input,
      id: `content-${randomUUID()}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.contents.push(content);
    return content;
  }

  public listContent(category: ContentRecord["category"], providerId: string): ContentRecord[] {
    return this.contents.filter((content) => content.category === category && content.providerId === providerId);
  }

  public getContent(contentId: string): ContentRecord | undefined {
    return this.contents.find((content) => content.id === contentId);
  }

  public updateContent(contentId: string, patch: Partial<ContentRecord>): ContentRecord | undefined {
    const content = this.getContent(contentId);
    if (!content) return undefined;
    Object.assign(content, patch, { version: content.version + 1, updatedAt: new Date().toISOString() });
    return content;
  }
}
