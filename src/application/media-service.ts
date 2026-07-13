import { randomUUID } from "node:crypto";
import { PortalService, PortalServiceError, type PortalPage } from "./portal-service.js";
import { MediaStore } from "../domain/media-store.js";
import { mediaRightsStatuses, mediaStatuses, mediaTypes, type AuthenticatedPrincipal, type MediaAsset, type MediaRightsStatus, type MediaStatus, type MediaTransformSpec, type MediaType } from "../domain/types.js";

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

  public registerAsset(principal: AuthenticatedPrincipal | null, input: MediaRegisterInput): MediaAsset {
    this.assertProvider(principal, "media.manage");
    if (!principal || input.category !== principal.category) throw new MediaServiceError(403, "現在のカテゴリ以外にはメディアを登録できません。");
    this.validateCommonInput(input);
    const name = input.name.trim();
    const title = (input.title ?? name).trim();
    if (!title || title.length > 200) throw new MediaServiceError(400, "titleは1〜200文字で指定してください。");
    return this.store.createAsset({
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
    return updated;
  }

  public archiveAsset(principal: AuthenticatedPrincipal | null, assetId: string): MediaAsset {
    this.assertProvider(principal, "media.manage");
    const asset = this.getOwnedAsset(principal, assetId);
    if (!asset) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    const archived = this.store.archiveAsset(asset.id);
    if (!archived) throw new MediaServiceError(404, "メディアアセットが見つかりません。");
    return archived;
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
    return updated;
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
