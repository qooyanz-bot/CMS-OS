import { randomUUID } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { MediaAsset, MediaSeoAuditResult, MediaSiteSeoAuditResult, MediaTransformSpec } from "./types.js";

function cloneAsset(asset: MediaAsset): MediaAsset {
  return {
    ...asset,
    tags: [...asset.tags],
    ...(asset.transform ? { transform: { ...asset.transform } } : {}),
    ...(asset.lastSeoAudit ? { lastSeoAudit: { ...asset.lastSeoAudit, issues: asset.lastSeoAudit.issues.map((issue) => ({ ...issue })) } } : {}),
  };
}

export class MediaStore {
  private readonly assets: MediaAsset[];
  private readonly siteSeoAudits: MediaSiteSeoAuditResult[];

  public constructor(private readonly stateStore?: StateStore) {
    const saved = stateStore?.load<MediaAsset[]>("portal-media-assets.json", []) ?? [];
    this.assets = saved.map(cloneAsset);
    this.siteSeoAudits = (stateStore?.load<MediaSiteSeoAuditResult[]>("media-seo-audits.json", []) ?? []).map((audit) => ({
      ...audit,
      issues: audit.issues.map((issue) => ({ ...issue })),
    }));
  }

  public listAssets(): MediaAsset[] {
    return this.assets.map(cloneAsset);
  }

  public getAsset(assetId: string): MediaAsset | undefined {
    const asset = this.assets.find((candidate) => candidate.id === assetId);
    return asset ? cloneAsset(asset) : undefined;
  }

  public createAsset(input: Omit<MediaAsset, "id" | "createdAt" | "updatedAt">): MediaAsset {
    const now = new Date().toISOString();
    const asset: MediaAsset = {
      ...input,
      id: `media-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.assets.push(asset);
    this.persist();
    return cloneAsset(asset);
  }

  public updateAsset(assetId: string, patch: Partial<Omit<MediaAsset, "id" | "category" | "providerId" | "createdAt" | "updatedAt">>): MediaAsset | undefined {
    const asset = this.assets.find((candidate) => candidate.id === assetId);
    if (!asset) return undefined;
    Object.assign(asset, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return cloneAsset(asset);
  }

  public saveSeoAudit(assetId: string, result: MediaSeoAuditResult): MediaAsset | undefined {
    const asset = this.assets.find((candidate) => candidate.id === assetId);
    if (!asset) return undefined;
    asset.lastSeoAudit = { ...result, issues: result.issues.map((issue) => ({ ...issue })) };
    this.persist();
    return cloneAsset(asset);
  }

  public saveSiteSeoAudit(result: MediaSiteSeoAuditResult): MediaSiteSeoAuditResult {
    const saved = { ...result, issues: result.issues.map((issue) => ({ ...issue })) };
    this.siteSeoAudits.push(saved);
    if (this.siteSeoAudits.length > 50) this.siteSeoAudits.splice(0, this.siteSeoAudits.length - 50);
    this.persistSiteSeoAudits();
    return { ...saved, issues: saved.issues.map((issue) => ({ ...issue })) };
  }

  public getLatestSiteSeoAudit(category: MediaSiteSeoAuditResult["category"], providerId: string): MediaSiteSeoAuditResult | undefined {
    const audit = [...this.siteSeoAudits].reverse().find((candidate) => candidate.category === category && candidate.providerId === providerId);
    return audit ? { ...audit, issues: audit.issues.map((issue) => ({ ...issue })) } : undefined;
  }

  public archiveAsset(assetId: string): MediaAsset | undefined {
    return this.updateAsset(assetId, { status: "archived" });
  }

  public createDerivedAsset(source: MediaAsset, input: { storageKey: string; name: string; transform: MediaTransformSpec }): MediaAsset {
    return this.createAsset({
      category: source.category,
      providerId: source.providerId,
      name: input.name,
      storageKey: input.storageKey,
      mediaType: source.mediaType,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      altText: source.altText,
      title: source.title,
      ...(source.description ? { description: source.description } : {}),
      ...(source.width ? { width: source.width } : {}),
      ...(source.height ? { height: source.height } : {}),
      ...(source.durationSeconds ? { durationSeconds: source.durationSeconds } : {}),
      tags: [...source.tags],
      rightsStatus: source.rightsStatus,
      ...(source.rightsHolder ? { rightsHolder: source.rightsHolder } : {}),
      ...(source.licenseExpiresAt ? { licenseExpiresAt: source.licenseExpiresAt } : {}),
      status: "draft",
      derivedFromAssetId: source.id,
      transform: { ...input.transform },
    });
  }

  private persist(): void {
    this.stateStore?.save("portal-media-assets.json", this.assets);
  }

  private persistSiteSeoAudits(): void {
    this.stateStore?.save("media-seo-audits.json", this.siteSeoAudits);
  }
}
