import { randomUUID } from "node:crypto";
import { PortalService, PortalServiceError, type PortalPage } from "./portal-service.js";
import { MediaStore } from "../domain/media-store.js";
import { mediaRightsStatuses, mediaStatuses, mediaTypes, type AuthenticatedPrincipal, type MediaAsset, type MediaRightsStatus, type MediaSeoAuditIssue, type MediaSeoAuditResult, type MediaSiteSeoAuditResult, type MediaStatus, type MediaTransformSpec, type MediaType } from "../domain/types.js";
import type { WebhookService } from "./webhook-service.js";

export class MediaServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "MediaServiceError";
  }
}

export const mediaSortValues = ["updatedAt_desc", "name_asc", "size_desc"] as const;

export type MediaListFilters = {
  search?: string | undefined;
  mediaType?: MediaType | undefined;
  status?: MediaStatus | undefined;
  rightsStatus?: MediaRightsStatus | undefined;
  sort?: (typeof mediaSortValues)[number] | undefined;
};

export type MediaRegisterInput = {
  category: MediaAsset["category"];
  name: string;
  storageKey: string;
  publicUrl?: string | undefined;
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  altText: string;
  title?: string | undefined;
  description?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  durationSeconds?: number | undefined;
  tags?: string[] | undefined;
  rightsStatus?: MediaRightsStatus | undefined;
  rightsHolder?: string | undefined;
  licenseExpiresAt?: string | undefined;
  status?: MediaStatus | undefined;
};

export type MediaUpdateInput = Partial<Pick<MediaAsset, "name" | "publicUrl" | "altText" | "title" | "description" | "width" | "height" | "durationSeconds" | "tags" | "rightsStatus" | "rightsHolder" | "licenseExpiresAt" | "status">>;

export type MediaTransformInput = MediaTransformSpec;

function isMediaType(value: string): value is MediaType {
  return (mediaTypes as readonly string[]).includes(value);
}

function isMediaStatus(value: string): value is MediaStatus {
  return (mediaStatuses as readonly string[]).includes(value);
}

function isMediaRightsStatus(value: string): value is MediaRightsStatus {
  return (mediaRightsStatuses as readonly string[]).includes(value);
}

function cloneTags(tags: string[]): string[] {
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function mimeMatches(mediaType: MediaType, mimeType: string): boolean {
  if (mediaType === "image") return mimeType.startsWith("image/");
  if (mediaType === "video") return mimeType.startsWith("video/");
  return mimeType === "application/pdf";
}

function transformMimeType(mediaType: MediaType, format?: string): string | undefined {
  if (!format) return undefined;
  if (mediaType === "image") {
    return format === "webp" ? "image/webp" : format === "avif" ? "image/avif" : format === "jpg" || format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : undefined;
  }
  if (mediaType === "video") return format === "mp4" ? "video/mp4" : format === "webm" ? "video/webm" : undefined;
  return undefined;
}

export class MediaService {
  public constructor(
    private readonly portal: PortalService,
    private readonly store = new MediaStore(),
    private readonly webhook?: WebhookService,
  ) {}

  public listAssets(
    principal: AuthenticatedPrincipal | null,
    filters: MediaListFilters = {},
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<MediaAsset> {
    this.assertProvider(principal, "media.read");
    const limit = pagination.limit ?? 50;
    const cursor = pagination.cursor ?? 0;
    this.validatePagination(limit, cursor);
    const providerId = principal?.providerId;
    const search = filters.search?.trim().toLocaleLowerCase("ja-JP") ?? "";
    const items = this.store.listAssets()
      .filter((asset) => asset.category === principal?.category && asset.providerId === providerId)
      .filter((asset) => !filters.mediaType || asset.mediaType === filters.mediaType)
      .filter((asset) => !filters.status || asset.status === filters.status)
      .filter((asset) => !filters.rightsStatus || asset.rightsStatus === filters.rightsStatus)
      .filter((asset) => !search || `${asset.name} ${asset.title} ${asset.altText} ${asset.tags.join(" ")}`.toLocaleLowerCase("ja-JP").includes(search));

    if (filters.sort === "name_asc") items.sort((left, right) => left.name.localeCompare(right.name, "ja"));
    else if (filters.sort === "size_desc") items.sort((left, right) => right.sizeBytes - left.sizeBytes || right.updatedAt.localeCompare(left.updatedAt));
    else items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    const pageItems = items.slice(cursor, cursor + limit);
    const nextCursor = cursor + pageItems.length < items.length ? String(cursor + pageItems.length) : undefined;
    return { items: pageItems, page: { limit, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public getAsset(principal: AuthenticatedPrincipal | null, assetId: string): MediaAsset {
    this.assertProvider(principal, "media.read");
    const asset = this.getOwnedAsset(principal, assetId);
    if (!asset) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    return asset;
  }

  /** コンテンツへの関連付け時に、同一事業者が管理するアセットだけを返します。 */
  public getOwnedAssets(principal: AuthenticatedPrincipal | null, assetIds: string[]): MediaAsset[] {
    this.assertProvider(principal, "media.read");
    const normalizedIds = [...new Set(assetIds.map((assetId) => assetId.trim()).filter(Boolean))];
    if (normalizedIds.length > 20) throw new MediaServiceError(400, "mediaIdsは20件以内で指定してください。");
    return normalizedIds.map((assetId) => {
      const asset = this.getOwnedAsset(principal, assetId);
      if (!asset) throw new MediaServiceError(404, `メディアアセットが見つかりません: ${assetId}`);
      return asset;
    });
  }

  /** 静的公開で参照できる状態かを確認し、公開HTMLへ渡すアセットを返します。 */
  public getPublicationAssets(principal: AuthenticatedPrincipal | null, assetIds: string[]): MediaAsset[] {
    const assets = this.getOwnedAssets(principal, assetIds);
    const now = Date.now();
    for (const asset of assets) {
      if (asset.status !== "published") throw new MediaServiceError(409, `メディアアセット「${asset.name}」は公開状態ではありません。`);
      if (!asset.publicUrl) throw new MediaServiceError(409, `メディアアセット「${asset.name}」にpublicUrlがありません。`);
      if (asset.rightsStatus === "expired" || (asset.licenseExpiresAt && Date.parse(asset.licenseExpiresAt) <= now)) {
        throw new MediaServiceError(409, `メディアアセット「${asset.name}」の利用権限が期限切れです。`);
      }
    }
    return assets;
  }

  public registerAsset(principal: AuthenticatedPrincipal | null, input: MediaRegisterInput): MediaAsset {
    this.assertProvider(principal, "media.manage");
    if (!principal || input.category !== principal.category) throw new MediaServiceError(403, "現在のカテゴリ以外にはメディアを登録できません。");
    this.validateCommonInput(input);
    const name = input.name.trim();
    const title = (input.title ?? name).trim();
    if (!title || title.length > 200) throw new MediaServiceError(400, "titleは1〜200文字で指定してください。");
    const created = this.store.createAsset({
      category: input.category,
      providerId: principal.providerId as string,
      name,
      storageKey: input.storageKey.trim(),
      ...(input.publicUrl ? { publicUrl: input.publicUrl.trim() } : {}),
      mediaType: input.mediaType,
      mimeType: input.mimeType.trim().toLowerCase(),
      sizeBytes: input.sizeBytes,
      altText: input.altText.trim(),
      title,
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
      tags: cloneTags(input.tags ?? []),
      rightsStatus: input.rightsStatus ?? "unknown",
      ...(input.rightsHolder ? { rightsHolder: input.rightsHolder.trim() } : {}),
      ...(input.licenseExpiresAt ? { licenseExpiresAt: input.licenseExpiresAt } : {}),
      status: input.status ?? "draft",
    });
    this.webhook?.emit(created.category, created.providerId, "media.created", { assetId: created.id, mediaType: created.mediaType, status: created.status });
    return created;
  }

  public updateAsset(principal: AuthenticatedPrincipal | null, assetId: string, input: MediaUpdateInput): MediaAsset {
    this.assertProvider(principal, "media.manage");
    const asset = this.getOwnedAsset(principal, assetId);
    if (!asset) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    if (Object.keys(input).length === 0) throw new MediaServiceError(400, "更新項目を1つ以上指定してください。");
    if (input.name !== undefined && (input.name.trim().length < 1 || input.name.trim().length > 200)) throw new MediaServiceError(400, "nameは1〜200文字で指定してください。");
    if (input.title !== undefined && (input.title.trim().length < 1 || input.title.trim().length > 200)) throw new MediaServiceError(400, "titleは1〜200文字で指定してください。");
    if (input.altText !== undefined && asset.mediaType === "image" && input.altText.trim().length === 0) throw new MediaServiceError(400, "画像にはaltTextが必要です。");
    if (input.publicUrl !== undefined) this.validatePublicUrl(input.publicUrl);
    if (input.tags !== undefined) this.validateTags(input.tags);
    if (input.rightsStatus !== undefined && !isMediaRightsStatus(input.rightsStatus)) throw new MediaServiceError(400, "rightsStatusが不正です。");
    if (input.status !== undefined && !isMediaStatus(input.status)) throw new MediaServiceError(400, "statusが不正です。");
    if (input.licenseExpiresAt !== undefined) this.validateDate(input.licenseExpiresAt, "licenseExpiresAt");
    this.validateOptionalNumber(input.width, "width", 1, 20000);
    this.validateOptionalNumber(input.height, "height", 1, 20000);
    this.validateOptionalNumber(input.durationSeconds, "durationSeconds", 1, 86_400);
    const updated = this.store.updateAsset(asset.id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.publicUrl !== undefined ? { publicUrl: input.publicUrl.trim() } : {}),
      ...(input.altText !== undefined ? { altText: input.altText.trim() } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
      ...(input.tags !== undefined ? { tags: cloneTags(input.tags) } : {}),
      ...(input.rightsStatus !== undefined ? { rightsStatus: input.rightsStatus } : {}),
      ...(input.rightsHolder !== undefined ? { rightsHolder: input.rightsHolder.trim() } : {}),
      ...(input.licenseExpiresAt !== undefined ? { licenseExpiresAt: input.licenseExpiresAt } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (!updated) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    this.webhook?.emit(updated.category, updated.providerId, "media.updated", { assetId: updated.id, mediaType: updated.mediaType, status: updated.status });
    return updated;
  }

  public archiveAsset(principal: AuthenticatedPrincipal | null, assetId: string): MediaAsset {
    this.assertProvider(principal, "media.manage");
    const asset = this.getOwnedAsset(principal, assetId);
    if (!asset) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    const archived = this.store.archiveAsset(asset.id);
    if (!archived) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    this.webhook?.emit(archived.category, archived.providerId, "media.archived", { assetId: archived.id, mediaType: archived.mediaType, status: archived.status });
    return archived;
  }

  public auditAssetSeo(principal: AuthenticatedPrincipal | null, assetId: string): MediaSeoAuditResult {
    this.assertProvider(principal, "media.read");
    const asset = this.getOwnedAsset(principal, assetId);
    if (!asset) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    const result = this.createAssetSeoAudit(asset, new Date());
    if (!this.store.saveSeoAudit(asset.id, result)) throw new MediaServiceError(500, "メディアSEO監査結果を保存できませんでした。");
    this.webhook?.emit(result.category, result.providerId, "media.seo_audited", { assetId: result.assetId, score: result.score, issueCount: result.issues.length });
    return result;
  }

  public auditSiteSeo(principal: AuthenticatedPrincipal | null): MediaSiteSeoAuditResult {
    this.assertProvider(principal, "media.read");
    const assets = this.store.listAssets().filter((asset) => asset.category === principal.category && asset.providerId === principal.providerId);
    const auditedAt = new Date();
    const results = assets.map((asset) => {
      const result = this.createAssetSeoAudit(asset, auditedAt);
      this.store.saveSeoAudit(asset.id, result);
      return result;
    });
    const issues = results.flatMap((result) => result.issues.map((issue) => ({ ...issue, assetId: result.assetId })));
    const score = results.length === 0 ? 100 : Math.round(results.reduce((total, result) => total + result.score, 0) / results.length);
    const result = this.store.saveSiteSeoAudit({
      category: principal.category,
      providerId: principal.providerId,
      assetCount: assets.length,
      score,
      issues,
      auditedAt: auditedAt.toISOString(),
    });
    this.webhook?.emit(result.category, result.providerId, "media.seo_audited", { assetCount: result.assetCount, score: result.score, issueCount: result.issues.length });
    return result;
  }

  public transformAsset(principal: AuthenticatedPrincipal | null, assetId: string, input: MediaTransformInput): MediaAsset {
    this.assertProvider(principal, "media.manage");
    const source = this.getOwnedAsset(principal, assetId);
    if (!source) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    if (source.status === "archived") throw new MediaServiceError(409, "アーカイブ済みアセットは変換できません。");
    if (source.mediaType === "pdf") throw new MediaServiceError(400, "PDFの変換は現在のメディアアダプターでは対応していません。");
    const transform = this.validateTransform(source.mediaType, input);
    const suffix = [transform.format ?? "derived", transform.width, transform.height, transform.quality].filter((value) => value !== undefined).join("-");
    const derived = this.store.createDerivedAsset(source, {
      storageKey: `${source.storageKey}.transform-${suffix}-${randomUUID().slice(0, 8)}`,
      name: `${source.name}（変換）`,
      transform,
    });
    const mimeType = transformMimeType(source.mediaType, transform.format);
    const updated = mimeType
      ? this.store.updateAsset(derived.id, {
          mimeType,
          ...(transform.width !== undefined ? { width: transform.width } : {}),
          ...(transform.height !== undefined ? { height: transform.height } : {}),
        })
      : derived;
    if (!updated) throw new MediaServiceError(500, "変換アセットを保存できませんでした。");
    this.webhook?.emit(updated.category, updated.providerId, "media.created", { assetId: updated.id, derivedFromAssetId: source.id, mediaType: updated.mediaType, status: updated.status });
    return updated;
  }

  private createAssetSeoAudit(asset: MediaAsset, auditedAt: Date): MediaSeoAuditResult {
    const issues: MediaSeoAuditIssue[] = [];
    const addIssue = (issue: MediaSeoAuditIssue): void => { issues.push(issue); };
    const altText = asset.altText.trim();
    const title = asset.title.trim();

    if (asset.mediaType === "image" && !altText) {
      addIssue({ code: "MEDIA_ALT_MISSING", severity: "error", field: "altText", message: "画像のaltTextが空です。", recommendation: "画像の内容と役割を具体的に説明してください。" });
    } else if (altText.length > 0 && altText.length < 10) {
      addIssue({ code: "MEDIA_ALT_TOO_SHORT", severity: "warning", field: "altText", message: "altTextが短く、検索エンジンや読み上げ利用者に文脈が伝わりにくい可能性があります。", recommendation: "対象・場所・用途が分かる自然な説明へ整えてください。" });
    }
    if (altText && altText.localeCompare(asset.name.trim(), "ja", { sensitivity: "base" }) === 0) {
      addIssue({ code: "MEDIA_ALT_GENERIC", severity: "warning", field: "altText", message: "altTextがファイル名または表示名と同じです。", recommendation: "ファイル名ではなく、画像が伝える情報を記述してください。" });
    }
    if (title.length < 3) {
      addIssue({ code: "MEDIA_TITLE_MISSING", severity: "warning", field: "title", message: "メディアタイトルが短すぎます。", recommendation: "検索結果やページ文脈で意味が伝わるタイトルを設定してください。" });
    }
    if (asset.status === "published" && !asset.publicUrl) {
      addIssue({ code: "MEDIA_PUBLIC_URL_MISSING", severity: "warning", field: "publicUrl", message: "公開状態ですが配信URLがありません。", recommendation: "BuilderOS Adapterまたは接続ストレージで公開URLを確定してください。" });
    }
    if (asset.mediaType === "image" && asset.sizeBytes > 2 * 1024 * 1024) {
      addIssue({ code: "MEDIA_IMAGE_TOO_LARGE", severity: "warning", field: "sizeBytes", message: "画像サイズが2MBを超えています。", recommendation: "WebPまたはAVIFへ変換し、表示用途に合わせて軽量化してください。" });
    }
    if (asset.mediaType === "video" && asset.sizeBytes > 10 * 1024 * 1024) {
      addIssue({ code: "MEDIA_VIDEO_TOO_LARGE", severity: "warning", field: "sizeBytes", message: "動画サイズが10MBを超えています。", recommendation: "配信品質を保ちながら圧縮し、遅延読み込みを設定してください。" });
    }
    if ((asset.mediaType === "image" || asset.mediaType === "video") && (asset.width === undefined || asset.height === undefined)) {
      addIssue({ code: "MEDIA_DIMENSIONS_MISSING", severity: "warning", field: "width,height", message: "表示寸法が未設定で、レイアウトシフトの原因になる可能性があります。", recommendation: "実寸または表示枠のwidthとheightを登録してください。" });
    }
    if (!this.mimeMatchesAsset(asset)) {
      addIssue({ code: "MEDIA_MIME_MISMATCH", severity: "error", field: "mimeType", message: "mediaTypeとMIMEタイプが一致していません。", recommendation: "実体ファイルとメタデータの種別を揃えてください。" });
    }
    const licenseExpired = asset.rightsStatus === "expired" || (asset.licenseExpiresAt !== undefined && Date.parse(asset.licenseExpiresAt) <= auditedAt.getTime());
    if (licenseExpired) {
      addIssue({ code: "MEDIA_RIGHTS_EXPIRED", severity: "error", field: "rightsStatus,licenseExpiresAt", message: "メディアの利用権限が期限切れです。", recommendation: "公開を停止し、権利更新または代替アセットを確認してください。" });
    } else if ((asset.rightsStatus === "owned" || asset.rightsStatus === "licensed") && !asset.rightsHolder?.trim()) {
      addIssue({ code: "MEDIA_RIGHTS_HOLDER_MISSING", severity: "warning", field: "rightsHolder", message: "権利状態は確認済みですが権利者情報がありません。", recommendation: "権利者またはライセンス提供元を登録してください。" });
    } else if (asset.status === "published" && asset.rightsStatus === "unknown") {
      addIssue({ code: "MEDIA_RIGHTS_UNKNOWN", severity: "warning", field: "rightsStatus", message: "公開中メディアの権利状態が未確認です。", recommendation: "公開前に利用許諾と掲載範囲を確認してください。" });
    }
    if (Date.parse(asset.updatedAt) < auditedAt.getTime() - 180 * 24 * 60 * 60 * 1000) {
      addIssue({ code: "MEDIA_METADATA_STALE", severity: "warning", field: "updatedAt", message: "メタデータが180日以上更新されていません。", recommendation: "公開URL、権利、altText、表示寸法を再確認してください。" });
    }
    if (asset.status === "archived") {
      addIssue({ code: "MEDIA_ARCHIVED", severity: "info", field: "status", message: "アーカイブ済みアセットです。", recommendation: "公開ページから参照されていないことを確認し、不要なら保管期限を決めてください。" });
    }

    const score = Math.max(0, Math.min(100, 100 - issues.reduce((total, issue) => total + (issue.severity === "error" ? 25 : issue.severity === "warning" ? 10 : 2), 0)));
    return { assetId: asset.id, category: asset.category, providerId: asset.providerId, score, issues, auditedAt: auditedAt.toISOString() };
  }

  private mimeMatchesAsset(asset: MediaAsset): boolean {
    return mimeMatches(asset.mediaType, asset.mimeType.trim().toLowerCase());
  }

  private assertProvider(principal: AuthenticatedPrincipal | null, action: "media.read" | "media.manage"): asserts principal is AuthenticatedPrincipal & { role: "provider"; providerId: string } {
    if (!principal) throw new MediaServiceError(401, "ログインが必要です。");
    if (principal.role !== "provider" || !principal.providerId) throw new MediaServiceError(403, "メディア管理は事業者のみ利用できます。");
    try {
      this.portal.assertAction(principal, principal.category, action);
    } catch (error) {
      if (error instanceof PortalServiceError) throw new MediaServiceError(error.statusCode, error.message);
      throw error;
    }
  }

  private getOwnedAsset(principal: AuthenticatedPrincipal, assetId: string): MediaAsset | undefined {
    const asset = this.store.getAsset(assetId);
    if (!asset || asset.category !== principal.category || asset.providerId !== principal.providerId) return undefined;
    return asset;
  }

  private validateCommonInput(input: MediaRegisterInput): void {
    if (!isMediaType(input.mediaType)) throw new MediaServiceError(400, "mediaTypeが不正です。");
    if (!isMediaStatus(input.status ?? "draft")) throw new MediaServiceError(400, "statusが不正です。");
    if (!isMediaRightsStatus(input.rightsStatus ?? "unknown")) throw new MediaServiceError(400, "rightsStatusが不正です。");
    if (input.name.trim().length < 1 || input.name.trim().length > 200) throw new MediaServiceError(400, "nameは1〜200文字で指定してください。");
    if (input.storageKey.trim().length < 1 || input.storageKey.trim().length > 500 || input.storageKey.includes("..") || input.storageKey.startsWith("/")) throw new MediaServiceError(400, "storageKeyが不正です。");
    if (!input.mimeType.trim() || !mimeMatches(input.mediaType, input.mimeType.trim().toLowerCase())) throw new MediaServiceError(400, "mediaTypeとmimeTypeが一致していません。");
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 500 * 1024 * 1024) throw new MediaServiceError(400, "sizeBytesは1〜500MBの整数で指定してください。");
    if (input.mediaType === "image" && input.altText.trim().length === 0) throw new MediaServiceError(400, "画像にはaltTextが必要です。");
    if (input.publicUrl !== undefined) this.validatePublicUrl(input.publicUrl);
    this.validateTags(input.tags ?? []);
    this.validateOptionalNumber(input.width, "width", 1, 20000);
    this.validateOptionalNumber(input.height, "height", 1, 20000);
    this.validateOptionalNumber(input.durationSeconds, "durationSeconds", 1, 86_400);
    if (input.licenseExpiresAt !== undefined) this.validateDate(input.licenseExpiresAt, "licenseExpiresAt");
  }

  private validatePublicUrl(value: string): void {
    try {
      const url = new URL(value);
      if (!(["http:", "https:"].includes(url.protocol))) throw new Error("invalid");
    } catch {
      throw new MediaServiceError(400, "publicUrlはhttpまたはhttpsのURLで指定してください。");
    }
  }

  private validateTags(tags: string[]): void {
    if (tags.length > 30 || tags.some((tag) => typeof tag !== "string" || tag.trim().length < 1 || tag.trim().length > 50)) throw new MediaServiceError(400, "tagsは1〜30件、各1〜50文字で指定してください。");
  }

  private validateOptionalNumber(value: number | undefined, fieldName: string, minimum: number, maximum: number): void {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum || value > maximum)) throw new MediaServiceError(400, `${fieldName}が不正です。`);
  }

  private validateDate(value: string, fieldName: string): void {
    if (!value || Number.isNaN(Date.parse(value))) throw new MediaServiceError(400, `${fieldName}はISO 8601形式で指定してください。`);
  }

  private validateTransform(mediaType: MediaType, input: MediaTransformInput): MediaTransformSpec {
    if (Object.keys(input).length === 0) throw new MediaServiceError(400, "変換条件を1つ以上指定してください。");
    const format = input.format?.trim().toLowerCase();
    const allowedFormats = mediaType === "image" ? ["webp", "avif", "jpg", "jpeg", "png"] : ["mp4", "webm"];
    if (format !== undefined && !allowedFormats.includes(format)) throw new MediaServiceError(400, "formatが対応形式ではありません。");
    this.validateOptionalNumber(input.width, "width", 1, 20000);
    this.validateOptionalNumber(input.height, "height", 1, 20000);
    if (input.quality !== undefined && (!Number.isSafeInteger(input.quality) || input.quality < 1 || input.quality > 100)) throw new MediaServiceError(400, "qualityは1〜100で指定してください。");
    return {
      ...(format ? { format } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.quality !== undefined ? { quality: input.quality } : {}),
    };
  }

  private validatePagination(limit: number, cursor: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MediaServiceError(400, "limitは1〜100で指定してください。");
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new MediaServiceError(400, "cursorは0以上の整数で指定してください。");
  }
}
