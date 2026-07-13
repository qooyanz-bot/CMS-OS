import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import { AuthServiceError, type AuthService } from "../domain/auth.js";
import { applicationSortValues, jobSortValues, PortalService, PortalServiceError, providerSortValues, requestSortValues } from "../application/portal-service.js";
import {
  ContentService,
  ContentServiceError,
  isContentAudience,
  isContentLocale,
  isContentType,
  parseOptionalStringArray,
} from "../application/content-service.js";
import { PublicationService, PublicationServiceError } from "../application/publication-service.js";
import { MediaService, MediaServiceError, mediaSortValues, type MediaRegisterInput, type MediaUpdateInput } from "../application/media-service.js";
import { applicationStatuses, categorySlugs, contentLocales, directoryGuideKinds, inquiryStatuses, jobStatuses, mediaRightsStatuses, mediaStatuses, mediaTypes, providerListingStatuses, requestStatuses, type ApplicationStatus, type CategorySlug, type ContentSeo, type DirectoryGuide, type InquiryStatus, type JobStatus, type MediaAsset, type MediaRightsStatus, type MediaStatus, type MediaTransformSpec, type MediaType, type PortalRole, type ProviderListingStatus, type RequestStatus } from "../domain/types.js";
import { FixedWindowRateLimiter } from "../security/rate-limit.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const staticAssets: Record<string, { file: string; contentType: string }> = {
  "/": { file: "public/index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": { file: "public/app.js", contentType: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "public/styles.css", contentType: "text/css; charset=utf-8" },
};

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(body));
}

async function serveStaticAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const asset = staticAssets[pathname];
  if (!asset) return false;

  try {
    const content = await readFile(resolve(process.cwd(), asset.file));
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": pathname === "/" ? "no-cache" : "public, max-age=300",
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("リクエストサイズが大きすぎます。");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSONオブジェクトが必要です。");
  return parsed as Record<string, unknown>;
}

function getBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === "string" && (categorySlugs as readonly string[]).includes(value);
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && (requestStatuses as readonly string[]).includes(value);
}

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (applicationStatuses as readonly string[]).includes(value);
}

function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (jobStatuses as readonly string[]).includes(value);
}

function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === "string" && (inquiryStatuses as readonly string[]).includes(value);
}

function isProviderListingStatus(value: unknown): value is ProviderListingStatus {
  return typeof value === "string" && (providerListingStatuses as readonly string[]).includes(value);
}

function hasOperatorKey(request: IncomingMessage): boolean {
  const expected = process.env.CMS_OS_OPERATOR_KEY?.trim();
  const provided = request.headers["x-cms-os-operator-key"];
  return Boolean(expected && typeof provided === "string" && provided === expected);
}

const categoryEnum = [...categorySlugs];

function isPortalRole(value: unknown): value is PortalRole {
  return value === "user" || value === "orderer" || value === "provider" || value === "candidate";
}

function isDirectoryGuideKind(value: unknown): value is DirectoryGuide["kind"] {
  return typeof value === "string" && (directoryGuideKinds as readonly string[]).includes(value);
}

function parseDirectoryGuideCreateInput(input: Record<string, unknown>): Omit<DirectoryGuide, "id"> {
  if (!isCategorySlug(input.category) || !isDirectoryGuideKind(input.kind) || typeof input.name !== "string" || typeof input.description !== "string" || typeof input.url !== "string" || typeof input.verifiedAt !== "string") {
    throw new Error("category、name、kind、description、url、verifiedAtを正しく指定してください。");
  }
  if (!Array.isArray(input.targetRoles) || input.targetRoles.some((role) => !isPortalRole(role))) {
    throw new Error("targetRolesを正しく指定してください。");
  }
  return {
    category: input.category,
    name: input.name,
    kind: input.kind,
    description: input.description,
    url: input.url,
    targetRoles: input.targetRoles,
    verifiedAt: input.verifiedAt,
  };
}

function parseDirectoryGuideUpdateInput(input: Record<string, unknown>): Partial<Omit<DirectoryGuide, "id">> {
  const patch: Partial<Omit<DirectoryGuide, "id">> = {};
  if (input.category !== undefined) {
    if (!isCategorySlug(input.category)) throw new Error("categoryが不正です。");
    patch.category = input.category;
  }
  if (input.name !== undefined) {
    if (typeof input.name !== "string") throw new Error("nameが不正です。");
    patch.name = input.name;
  }
  if (input.kind !== undefined) {
    if (!isDirectoryGuideKind(input.kind)) throw new Error("kindが不正です。");
    patch.kind = input.kind;
  }
  if (input.description !== undefined) {
    if (typeof input.description !== "string") throw new Error("descriptionが不正です。");
    patch.description = input.description;
  }
  if (input.url !== undefined) {
    if (typeof input.url !== "string") throw new Error("urlが不正です。");
    patch.url = input.url;
  }
  if (input.targetRoles !== undefined) {
    if (!Array.isArray(input.targetRoles) || input.targetRoles.some((role) => !isPortalRole(role))) throw new Error("targetRolesが不正です。");
    patch.targetRoles = input.targetRoles;
  }
  if (input.verifiedAt !== undefined) {
    if (typeof input.verifiedAt !== "string") throw new Error("verifiedAtが不正です。");
    patch.verifiedAt = input.verifiedAt;
  }
  if (Object.keys(patch).length === 0) throw new Error("更新項目を1つ以上指定してください。");
  return patch;
}

function mcpText(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(value) };
}

function parseContentSeoPatch(value: unknown): Partial<ContentSeo> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("seoはオブジェクトで指定してください。");
  const input = value as Record<string, unknown>;
  const result: Partial<ContentSeo> = {};
  const stringFields: Array<keyof Pick<ContentSeo, "title" | "description" | "canonicalPath" | "ogTitle" | "ogDescription">> = [
    "title",
    "description",
    "canonicalPath",
    "ogTitle",
    "ogDescription",
  ];
  for (const field of stringFields) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "string") throw new Error(`seo.${field}は文字列で指定してください。`);
      result[field] = input[field] as string;
    }
  }
  if (input.keywords !== undefined) {
    if (!Array.isArray(input.keywords) || input.keywords.some((item) => typeof item !== "string")) throw new Error("seo.keywordsは文字列配列で指定してください。");
    result.keywords = input.keywords as string[];
  }
  if (input.faq !== undefined) {
    if (!Array.isArray(input.faq) || input.faq.some((item) => !item || typeof item !== "object" || typeof (item as Record<string, unknown>).question !== "string" || typeof (item as Record<string, unknown>).answer !== "string")) {
      throw new Error("seo.faqはquestionとanswerを持つ配列で指定してください。");
    }
    result.faq = (input.faq as Array<{ question: string; answer: string }>).map((item) => ({ question: item.question, answer: item.answer }));
  }
  if (Object.keys(result).length === 0) throw new Error("seoの更新対象を1つ以上指定してください。");
  return result;
}

function parseStringMap(value: unknown, fieldName: string): Record<string, string | string[]> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${fieldName}はオブジェクトで指定してください。`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) throw new Error(`${fieldName}は50項目以内で指定してください。`);
  const result: Record<string, string | string[]> = {};
  for (const [key, item] of entries) {
    if (typeof item === "string") {
      result[key] = item;
      continue;
    }
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      result[key] = item as string[];
      continue;
    }
    throw new Error(`${fieldName}.${key}は文字列または文字列配列で指定してください。`);
  }
  return result;
}

function isMediaTypeValue(value: unknown): value is MediaType {
  return typeof value === "string" && (mediaTypes as readonly string[]).includes(value);
}

function isMediaStatusValue(value: unknown): value is MediaStatus {
  return typeof value === "string" && (mediaStatuses as readonly string[]).includes(value);
}

function isMediaRightsStatusValue(value: unknown): value is MediaRightsStatus {
  return typeof value === "string" && (mediaRightsStatuses as readonly string[]).includes(value);
}

function parseMediaNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${fieldName}は整数で指定してください。`);
  return value;
}

function parseMediaRegisterInput(input: Record<string, unknown>): MediaRegisterInput {
  if (!isCategorySlug(input.category) || typeof input.name !== "string" || typeof input.storageKey !== "string" || !isMediaTypeValue(input.mediaType) || typeof input.mimeType !== "string" || typeof input.sizeBytes !== "number" || typeof input.altText !== "string") {
    throw new Error("category、name、storageKey、mediaType、mimeType、sizeBytes、altTextを指定してください。");
  }
  const tags = parseOptionalStringArray(input.tags, "tags");
  const optionalStringFields = ["publicUrl", "title", "description", "rightsHolder", "licenseExpiresAt"] as const;
  for (const field of optionalStringFields) {
    if (input[field] !== undefined && typeof input[field] !== "string") throw new Error(`${field}は文字列で指定してください。`);
  }
  const width = parseMediaNumber(input.width, "width");
  const height = parseMediaNumber(input.height, "height");
  const durationSeconds = parseMediaNumber(input.durationSeconds, "durationSeconds");
  if (input.status !== undefined && !isMediaStatusValue(input.status)) throw new Error("statusが不正です。");
  if (input.rightsStatus !== undefined && !isMediaRightsStatusValue(input.rightsStatus)) throw new Error("rightsStatusが不正です。");
  return {
    category: input.category,
    name: input.name,
    storageKey: input.storageKey,
    mediaType: input.mediaType,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    altText: input.altText,
    ...(typeof input.publicUrl === "string" ? { publicUrl: input.publicUrl } : {}),
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(tags ? { tags } : {}),
    ...(isMediaRightsStatusValue(input.rightsStatus) ? { rightsStatus: input.rightsStatus } : {}),
    ...(typeof input.rightsHolder === "string" ? { rightsHolder: input.rightsHolder } : {}),
    ...(typeof input.licenseExpiresAt === "string" ? { licenseExpiresAt: input.licenseExpiresAt } : {}),
    ...(isMediaStatusValue(input.status) ? { status: input.status } : {}),
  };
}

function parseMediaUpdateInput(input: Record<string, unknown>): MediaUpdateInput {
  const result: MediaUpdateInput = {};
  const stringFields = ["name", "publicUrl", "altText", "title", "description", "rightsHolder", "licenseExpiresAt"] as const;
  for (const field of stringFields) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== "string") throw new Error(`${field}は文字列で指定してください。`);
      result[field] = input[field];
    }
  }
  const numericFields = ["width", "height", "durationSeconds"] as const;
  for (const field of numericFields) {
    const value = parseMediaNumber(input[field], field);
    if (value !== undefined) result[field] = value;
  }
  if (input.tags !== undefined) {
    const tags = parseOptionalStringArray(input.tags, "tags");
    if (tags !== undefined) result.tags = tags;
  }
  if (input.rightsStatus !== undefined) {
    if (!isMediaRightsStatusValue(input.rightsStatus)) throw new Error("rightsStatusが不正です。");
    result.rightsStatus = input.rightsStatus;
  }
  if (input.status !== undefined) {
    if (!isMediaStatusValue(input.status)) throw new Error("statusが不正です。");
    result.status = input.status;
  }
  return result;
}

function parseMediaTransformInput(input: Record<string, unknown>): MediaTransformSpec {
  if (input.format !== undefined && typeof input.format !== "string") throw new Error("formatは文字列で指定してください。");
  const width = parseMediaNumber(input.width, "width");
  const height = parseMediaNumber(input.height, "height");
  const quality = parseMediaNumber(input.quality, "quality");
  return {
    ...(typeof input.format === "string" ? { format: input.format } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(quality !== undefined ? { quality } : {}),
  };
}

function parsePaginationValue(value: unknown, fieldName: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new Error(`${fieldName}は0以上の整数で指定してください。`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${fieldName}が不正です。`);
  return parsed;
}

function parsePaginationQuery(url: URL): { limit: number; cursor: number } {
  const limit = parsePaginationValue(url.searchParams.get("limit"), "limit", 50);
  const cursor = parsePaginationValue(url.searchParams.get("cursor"), "cursor", 0);
  if (limit < 1 || limit > 100) throw new Error("limitは1以上100以下で指定してください。");
  return { limit, cursor };
}

function parsePaginationArguments(argumentsObject: Record<string, unknown>): { limit: number; cursor: number } {
  const limit = parsePaginationValue(argumentsObject.limit, "limit", 50);
  const cursor = parsePaginationValue(argumentsObject.cursor, "cursor", 0);
  if (limit < 1 || limit > 100) throw new Error("limitは1以上100以下で指定してください。");
  return { limit, cursor };
}

function parseOptionalStringValue(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${fieldName}は文字列で指定してください。`);
  return value.trim() || undefined;
}

function parseOptionalEnumValue<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): T | undefined {
  const normalized = parseOptionalStringValue(value, fieldName);
  if (normalized === undefined) return undefined;
  if (!allowed.includes(normalized as T)) throw new Error(`${fieldName}の指定値が不正です。`);
  return normalized as T;
}

function parseQueryString(url: URL, fieldName: string): string | undefined {
  return parseOptionalStringValue(url.searchParams.get(fieldName), fieldName);
}

function serviceErrorStatus(error: unknown): number {
  return error instanceof AuthServiceError || error instanceof PortalServiceError || error instanceof ContentServiceError || error instanceof PublicationServiceError || error instanceof MediaServiceError ? error.statusCode : 400;
}

function getClientAddress(request: IncomingMessage): string {
  if (process.env.CMS_OS_TRUST_PROXY === "true") {
    const cloudflareAddress = request.headers["cf-connecting-ip"];
    if (typeof cloudflareAddress === "string" && cloudflareAddress.trim()) return cloudflareAddress.trim();
    const forwardedAddress = request.headers["x-forwarded-for"];
    if (typeof forwardedAddress === "string" && forwardedAddress.trim()) return forwardedAddress.split(",")[0]?.trim() || "unknown";
  }
  return request.socket.remoteAddress ?? "unknown";
}

function allowAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  limiter: FixedWindowRateLimiter,
  operation: string,
  identity?: string,
): boolean {
  const keys = [`ip:${getClientAddress(request)}:${operation}`];
  if (identity?.trim()) keys.push(`identity:${identity.trim().toLowerCase()}:${operation}`);
  for (const key of keys) {
    const result = limiter.consume(key);
    if (!result.allowed) {
      response.setHeader("retry-after", String(result.retryAfterSeconds));
      writeJson(response, 429, { error: "認証操作が多すぎます。しばらく待ってから再試行してください。", retryAfterSeconds: result.retryAfterSeconds });
      return false;
    }
  }
  return true;
}

async function handleMcp(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AuthService,
  portal: PortalService,
  content: ContentService,
  publication: PublicationService,
  media: MediaService,
  authRateLimiter: FixedWindowRateLimiter,
): Promise<void> {
  const body = await readJson(request);
  const id = body.id ?? null;
  const method = body.method;

  if (method === "initialize") {
    writeJson(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cms-os", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    writeJson(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "category.list",
            description: "利用可能なカテゴリ一覧を取得します。",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
          {
            name: "category.resolve_experience",
            description: "カテゴリと認証コンテキストに応じた表示モジュールと操作権限を取得します。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum } }, required: ["category"] },
          },
          {
            name: "category.get",
            description: "カテゴリ、現在のロールに対応する表示体験、外部案内をまとめて取得します。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum } }, required: ["category"] },
          },
          {
            name: "directory.create",
            description: "運営キーでカテゴリ別の外部案内を追加します。x-cms-os-operator-keyヘッダーが必要です。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                name: { type: "string" },
                kind: { enum: [...directoryGuideKinds] },
                description: { type: "string" },
                url: { type: "string", format: "uri" },
                targetRoles: { type: "array", items: { enum: ["user", "orderer", "provider", "candidate"] } },
                verifiedAt: { type: "string", format: "date" },
              },
              required: ["category", "name", "kind", "description", "url", "targetRoles", "verifiedAt"],
            },
          },
          {
            name: "directory.update",
            description: "運営キーで外部案内を更新します。x-cms-os-operator-keyヘッダーが必要です。",
            inputSchema: { type: "object", properties: { directoryId: { type: "string" }, category: { enum: categoryEnum }, name: { type: "string" }, kind: { enum: [...directoryGuideKinds] }, description: { type: "string" }, url: { type: "string", format: "uri" }, targetRoles: { type: "array", items: { enum: ["user", "orderer", "provider", "candidate"] } }, verifiedAt: { type: "string", format: "date" } }, required: ["directoryId"] },
          },
          {
            name: "directory.delete",
            description: "運営キーで外部案内を削除します。x-cms-os-operator-keyヘッダーが必要です。",
            inputSchema: { type: "object", properties: { directoryId: { type: "string" } }, required: ["directoryId"] },
          },
          {
            name: "directory.list",
            description: "カテゴリとロールに応じた外部ディレクトリ・予約・事業者向け案内を取得します。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum } }, required: ["category"] },
          },
          {
            name: "provider.search",
            description: "カテゴリ、テーマ、地域に応じて表示可能な事業者を検索します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                search: { type: "string" },
                theme: { type: "string" },
                location: { type: "string" },
                sort: { enum: [...providerSortValues] },
                limit: { type: "integer", minimum: 1, maximum: 100 },
                cursor: { type: "integer", minimum: 0 },
              },
              required: ["category"],
            },
          },
          {
            name: "provider.get",
            description: "事業者1件の表示情報を取得します。",
            inputSchema: { type: "object", properties: { providerId: { type: "string" } }, required: ["providerId"] },
          },
          {
            name: "provider.update",
            description: "事業者本人の公開掲載情報を更新します。",
            inputSchema: {
              type: "object",
              properties: {
                providerId: { type: "string" },
                name: { type: "string" },
                themes: { type: "array", items: { type: "string" } },
                location: { type: "string" },
                publicFields: { type: "object", additionalProperties: true },
              },
              required: ["providerId"],
            },
          },
          {
            name: "provider.listing_submit",
            description: "事業者本人の掲載情報を審査待ちへ送信します。公開検索からは審査完了まで除外されます。",
            inputSchema: { type: "object", properties: { providerId: { type: "string" } }, required: ["providerId"] },
          },
          {
            name: "provider.listing_review",
            description: "運営審査キーで審査待ち掲載情報を公開、差戻し、または停止へ更新します。x-cms-os-operator-keyヘッダーが必要です。",
            inputSchema: {
              type: "object",
              properties: { providerId: { type: "string" }, status: { enum: ["draft", "published", "suspended"] }, note: { type: "string" } },
              required: ["providerId", "status"],
            },
          },
          {
            name: "provider.listing_review_queue",
            description: "運営審査キーで審査対象の事業者掲載情報をページ単位で取得します。x-cms-os-operator-keyヘッダーが必要です。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: categoryEnum }, status: { enum: ["draft", "pending_review", "published", "suspended"] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } },
              required: [],
            },
          },
          {
            name: "media.list",
            description: "メディアアセット一覧を取得します。",
            inputSchema: {
              type: "object",
              properties: { search: { type: "string" }, mediaType: { enum: [...mediaTypes] }, status: { enum: [...mediaStatuses] }, rightsStatus: { enum: [...mediaRightsStatuses] }, sort: { enum: [...mediaSortValues] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } },
              required: [],
            },
          },
          {
            name: "media.get",
            description: "メディアアセットを取得します。",
            inputSchema: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] },
          },
          {
            name: "media.register",
            description: "メディアアセットを登録します。画像はaltTextを必須とします。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum }, name: { type: "string" }, storageKey: { type: "string" }, publicUrl: { type: "string", format: "uri" }, mediaType: { enum: [...mediaTypes] }, mimeType: { type: "string" }, sizeBytes: { type: "integer", minimum: 1 }, altText: { type: "string" }, title: { type: "string" }, description: { type: "string" }, width: { type: "integer" }, height: { type: "integer" }, durationSeconds: { type: "integer" }, tags: { type: "array", items: { type: "string" } }, rightsStatus: { enum: [...mediaRightsStatuses] }, rightsHolder: { type: "string" }, licenseExpiresAt: { type: "string", format: "date-time" }, status: { enum: [...mediaStatuses] } }, required: ["category", "name", "storageKey", "mediaType", "mimeType", "sizeBytes", "altText"] },
          },
          {
            name: "media.update",
            description: "メディアアセットのメタデータを更新します。",
            inputSchema: { type: "object", properties: { assetId: { type: "string" }, name: { type: "string" }, publicUrl: { type: "string", format: "uri" }, altText: { type: "string" }, title: { type: "string" }, description: { type: "string" }, width: { type: "integer" }, height: { type: "integer" }, durationSeconds: { type: "integer" }, tags: { type: "array", items: { type: "string" } }, rightsStatus: { enum: [...mediaRightsStatuses] }, rightsHolder: { type: "string" }, licenseExpiresAt: { type: "string", format: "date-time" }, status: { enum: [...mediaStatuses] } }, required: ["assetId"] },
          },
          {
            name: "media.archive",
            description: "メディアアセットを論理アーカイブします。",
            inputSchema: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] },
          },
          {
            name: "media.transform",
            description: "画像・動画の変換アセットを作成します。実体変換はストレージアダプターへ委譲できます。",
            inputSchema: { type: "object", properties: { assetId: { type: "string" }, format: { type: "string" }, width: { type: "integer" }, height: { type: "integer" }, quality: { type: "integer", minimum: 1, maximum: 100 } }, required: ["assetId"] },
          },
          {
            name: "media.seo_audit",
            description: "現在の事業者が管理するメディア全体のSEO・アクセシビリティ監査を実行します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "media.asset_seo_audit",
            description: "指定したメディアアセットのSEO・アクセシビリティ監査を実行します。",
            inputSchema: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] },
          },
          {
            name: "auth.login",
            description: "ログインします。",
            inputSchema: {
              type: "object",
              properties: {
                email: { type: "string" },
                password: { type: "string" },
                category: { enum: categoryEnum },
                role: { enum: ["user", "orderer", "provider", "candidate"] },
              },
              required: ["email", "password", "category"],
            },
          },
          {
            name: "auth.me",
            description: "現在のユーザー情報を取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "auth.logout",
            description: "ログアウトします。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "auth.config",
            description: "利用可能なログイン方式とMFA登録可否を取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "auth.switch_context",
            description: "許可されたカテゴリとロールへ操作コンテキストを切り替えます。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: categoryEnum }, role: { enum: ["user", "orderer", "provider", "candidate"] } },
              required: ["category", "role"],
            },
          },
          {
            name: "auth.oidc_start",
            description: "OIDC Authorization Code + PKCE認証を開始します。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: categoryEnum }, role: { enum: ["user", "orderer", "provider", "candidate"] } },
              required: ["category"],
            },
          },
          {
            name: "auth.oidc_callback",
            description: "OIDCプロバイダーから返されたcodeとstateを検証してログインを完了します。",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" }, state: { type: "string" } },
              required: ["code", "state"],
            },
          },
          {
            name: "auth.mfa_enroll",
            description: "ログイン中のアカウントにTOTP MFAを登録します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "auth.mfa_confirm",
            description: "TOTPコードを検証してMFA登録を確定します。",
            inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
          },
          {
            name: "auth.mfa_complete",
            description: "MFAチャレンジをTOTPコードで完了してセッションを発行します。",
            inputSchema: { type: "object", properties: { challengeToken: { type: "string" }, code: { type: "string" } }, required: ["challengeToken", "code"] },
          },
          {
            name: "request.create",
            description: "発注者として事業者への依頼を作成します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                providerId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
              },
              required: ["category", "providerId", "title", "description"],
            },
          },
          {
            name: "request.list",
            description: "発注者自身の依頼、または事業者に割り当てられた依頼を取得します。",
            inputSchema: { type: "object", properties: { search: { type: "string" }, status: { enum: [...requestStatuses] }, sort: { enum: [...requestSortValues] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "request.update_status",
            description: "依頼の所有者または担当事業者が、受付・完了状態を更新します。",
            inputSchema: { type: "object", properties: { requestId: { type: "string" }, status: { enum: ["submitted", "accepted", "closed"] } }, required: ["requestId", "status"] },
          },
          {
            name: "inquiry.create",
            description: "ログイン済みのユーザー、発注者、リクルーターが公開事業者へ問い合わせを送信します。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: categoryEnum }, providerId: { type: "string" }, subject: { type: "string" }, message: { type: "string" } },
              required: ["category", "providerId", "subject", "message"],
            },
          },
          {
            name: "inquiry.list",
            description: "送信者本人の問い合わせ、または事業者本人宛ての問い合わせを取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "inquiry.update_status",
            description: "問い合わせの送信者または担当事業者が、返信済みまたは終了へ更新します。",
            inputSchema: { type: "object", properties: { inquiryId: { type: "string" }, status: { enum: ["open", "responded", "closed"] } }, required: ["inquiryId", "status"] },
          },
          {
            name: "notification.list",
            description: "ログイン中の本人または事業者に届いた通知を新しい順でページ取得します。",
            inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "notification.mark_read",
            description: "本人または自社事業者に届いた通知を既読・未読へ更新します。",
            inputSchema: { type: "object", properties: { notificationId: { type: "string" }, read: { type: "boolean" } }, required: ["notificationId", "read"] },
          },
          {
            name: "job.search",
            description: "カテゴリ別の公開求人を検索します。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum }, search: { type: "string" }, employmentType: { type: "string" }, location: { type: "string" }, status: { enum: [...jobStatuses] }, sort: { enum: [...jobSortValues] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: ["category"] },
          },
          {
            name: "job.create",
            description: "事業者本人の求人を作成します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                title: { type: "string" },
                employmentType: { type: "string" },
                location: { type: "string" },
                description: { type: "string" },
                status: { enum: ["published", "closed"] },
              },
              required: ["category", "title", "employmentType", "location", "description"],
            },
          },
          {
            name: "job.update",
            description: "事業者本人の求人情報または公開状態を更新します。",
            inputSchema: {
              type: "object",
              properties: {
                jobId: { type: "string" },
                title: { type: "string" },
                employmentType: { type: "string" },
                location: { type: "string" },
                description: { type: "string" },
                status: { enum: ["published", "closed"] },
              },
              required: ["jobId"],
            },
          },
          {
            name: "application.create",
            description: "リクルーターとして求人へ応募します。",
            inputSchema: {
              type: "object",
              properties: { jobId: { type: "string" }, message: { type: "string" } },
              required: ["jobId", "message"],
            },
          },
          {
            name: "application.list",
            description: "リクルーター本人、または事業者自身の求人への応募一覧を取得します。",
            inputSchema: { type: "object", properties: { search: { type: "string" }, jobId: { type: "string" }, status: { enum: [...applicationStatuses] }, sort: { enum: [...applicationSortValues] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "application.update_status",
            description: "担当事業者が応募を選考中または終了へ更新します。",
            inputSchema: { type: "object", properties: { applicationId: { type: "string" }, status: { enum: ["submitted", "screening", "closed"] } }, required: ["applicationId", "status"] },
          },
          {
            name: "content.propose",
            description: "対象ポジションと検索意図に応じたコンテンツ企画案を作成します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                contentType: { enum: ["company", "blog", "job", "pr", "ir"] },
                audience: { enum: ["customer", "candidate", "media", "investor", "beginner", "existingCustomer"] },
                topic: { type: "string" },
                primaryKeyword: { type: "string" },
                relatedKeywords: { type: "array", items: { type: "string" } },
                sourceFacts: { type: "array", items: { type: "string" } },
              },
              required: ["category", "contentType", "audience", "topic"],
            },
          },
          {
            name: "content.create",
            description: "検証済み本文をAIエージェントまたは外部APIから下書きとして登録します。登録後は既存の版管理・SEO監査・承認フローを利用します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                contentType: { enum: ["company", "blog", "job", "pr", "ir"] },
                audience: { enum: ["customer", "candidate", "media", "investor", "beginner", "existingCustomer"] },
                title: { type: "string" },
                summary: { type: "string" },
                body: { type: "string" },
                slug: { type: "string" },
                locale: { enum: [...contentLocales] },
                proposalId: { type: "string" },
                sourceFacts: { type: "array", items: { type: "string" } },
                seo: { type: "object", additionalProperties: true },
              },
              required: ["category", "contentType", "audience", "title", "summary", "body"],
            },
          },
          {
            name: "content.list",
            description: "事業者自身の企画案とコンテンツを一覧取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "content.get",
            description: "事業者自身のコンテンツを1件取得します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.versions",
            description: "コンテンツの版履歴を取得します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.version_get",
            description: "指定したコンテンツ版のスナップショットを取得します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" }, version: { type: "integer", minimum: 1 } }, required: ["contentId", "version"] },
          },
          {
            name: "content.version_restore",
            description: "指定したコンテンツ版を新しい下書き版として復元します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" }, version: { type: "integer", minimum: 1 } }, required: ["contentId", "version"] },
          },
          {
            name: "content.draft",
            description: "企画案から対象ポジション向けの下書きを生成します。",
            inputSchema: {
              type: "object",
              properties: { proposalId: { type: "string" } },
              required: ["proposalId"],
            },
          },
          {
            name: "content.update",
            description: "事業者自身のコンテンツ本文、要約、SEO情報、確認済み情報を更新します。",
            inputSchema: {
              type: "object",
              properties: {
                contentId: { type: "string" },
                title: { type: "string" },
                summary: { type: "string" },
                body: { type: "string" },
                sourceFacts: { type: "array", items: { type: "string" } },
                seo: { type: "object", additionalProperties: true },
              },
              required: ["contentId"],
            },
          },
          {
            name: "content.translate",
            description: "原文の指定バージョンから言語別の翻訳下書きを作成します。",
            inputSchema: {
              type: "object",
              properties: {
                contentId: { type: "string" },
                targetLocale: { enum: [...contentLocales] },
                title: { type: "string" },
                summary: { type: "string" },
                body: { type: "string" },
                instructions: { type: "string" },
                seo: { type: "object", additionalProperties: true },
              },
              required: ["contentId", "targetLocale"],
            },
          },
          {
            name: "content.duplicate",
            description: "事業者自身のコンテンツを新しい下書きとして複製します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.archive",
            description: "事業者自身のコンテンツをアーカイブし、公開対象から外します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.restore",
            description: "アーカイブ済みコンテンツを下書きとして復元します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.polish",
            description: "事業者の下書きを清書し、読みやすさと表記を整えます。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" }, instructions: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "seo.audit",
            description: "タイトル、説明文、見出し、キーワード、出典をSEO監査します。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "seo.site_audit",
            description: "サイト全体のcanonical、内部リンク、構造化データ、監査証跡を確認します。",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
          {
            name: "content.fact_check",
            description: "本文に紐づく一次情報の登録状況を確認します。本番では外部検証アダプターへ差し替えます。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "workflow.approve",
            description: "清書済みコンテンツを人間の確認済み状態へ進めます。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "workflow.reviews",
            description: "コンテンツのレビュー履歴を取得します。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "workflow.request_review",
            description: "事実確認とSEO監査を通過したコンテンツのレビューを依頼します。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" }, note: { type: "string", maxLength: 1000 } },
              required: ["contentId"],
            },
          },
          {
            name: "workflow.request_changes",
            description: "レビュー中のコンテンツを理由付きで差し戻します。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" }, note: { type: "string", minLength: 3, maxLength: 1000 } },
              required: ["contentId", "note"],
            },
          },
          {
            name: "publication.build",
            description: "承認済みコンテンツからCloudflare Pages向け静的ファイルを生成します。",
            inputSchema: {
              type: "object",
              properties: {
                contentIds: { type: "array", items: { type: "string" } },
                baseUrl: { type: "string" },
              },
              required: [],
            },
          },
          {
            name: "publication.deploy",
            description: "承認済みコンテンツをBuilderOS Adapter経由でCloudflare Pagesへ公開します。",
            inputSchema: {
              type: "object",
              properties: {
                contentIds: { type: "array", items: { type: "string" } },
                baseUrl: { type: "string" },
              },
              required: [],
            },
          },
          {
            name: "publication.publish",
            description: "承認済みコンテンツをBuilderOS Adapter経由でCloudflare Pagesへ公開し、成功時に公開状態へ更新します。",
            inputSchema: {
              type: "object",
              properties: {
                contentIds: { type: "array", items: { type: "string" } },
                baseUrl: { type: "string" },
              },
              required: [],
            },
          },
          {
            name: "publication.unpublish",
            description: "公開中コンテンツを除外した静的スナップショットをデプロイし、成功時に公開取消します。",
            inputSchema: {
              type: "object",
              properties: {
                contentIds: { type: "array", items: { type: "string" }, minItems: 1 },
                baseUrl: { type: "string" },
              },
              required: ["contentIds"],
            },
          },
          {
            name: "publication.schedule",
            description: "承認済みコンテンツを指定日時にBuilderOS Adapterで公開する予約を保存します。",
            inputSchema: {
              type: "object",
              properties: {
                contentIds: { type: "array", items: { type: "string" } },
                baseUrl: { type: "string" },
                scheduledFor: { type: "string", format: "date-time" },
              },
              required: ["scheduledFor"],
            },
          },
          {
            name: "publication.schedule_list",
            description: "事業者自身の予約公開一覧を取得します。",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
          {
            name: "publication.schedule_cancel",
            description: "事業者自身の未実行の予約公開を取り消します。",
            inputSchema: { type: "object", properties: { scheduleId: { type: "string" } }, required: ["scheduleId"] },
          },
          {
            name: "publication.schedule_execute",
            description: "外部Cronから呼び出し、期限を迎えた予約公開を実行します。",
            inputSchema: { type: "object", properties: { before: { type: "string", format: "date-time" } }, required: [] },
          },
          {
            name: "publication.history",
            description: "事業者自身の静的公開履歴を取得します。公開ファイル本体は含めず、ロールバック可能な履歴情報を返します。",
            inputSchema: { type: "object", properties: {}, required: [] },
          },
          {
            name: "publication.rollback",
            description: "過去にデプロイまたは公開した静的ファイルスナップショットをBuilderOS Adapter経由で再公開します。",
            inputSchema: {
              type: "object",
              properties: {
                publicationId: { type: "string" },
                baseUrl: { type: "string" },
              },
              required: ["publicationId"],
            },
          },
        ],
      },
    });
    return;
  }

  if (method !== "tools/call") {
    writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "未対応のMCPメソッドです。" } });
    return;
  }

  const params = (body.params ?? {}) as Record<string, unknown>;
  const name = params.name;
  const argumentsObject = (params.arguments ?? {}) as Record<string, unknown>;
  const principal = auth.authenticate(getBearerToken(request));

  try {
    if (name === "auth.login") {
      if (
        typeof argumentsObject.email !== "string" ||
        typeof argumentsObject.password !== "string" ||
        !isCategorySlug(argumentsObject.category) ||
        (argumentsObject.role !== undefined && !isPortalRole(argumentsObject.role))
      ) {
        throw new Error("email、password、category、roleの指定が不正です。");
      }
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.login", argumentsObject.email)) return;
      const result = auth.login(
        argumentsObject.email,
        argumentsObject.password,
        argumentsObject.category,
        isPortalRole(argumentsObject.role) ? argumentsObject.role : "user",
      );
      if (!result) throw new Error("認証情報またはカテゴリ・ロールが正しくありません。");
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.me") {
      if (!principal) throw new Error("ログインが必要です。");
      const result = { principal, experience: portal.getExperience(principal.category, principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.logout") {
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.logout")) return;
      auth.logout(getBearerToken(request));
      const result = { ok: true };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.config") {
      const result = auth.getAuthCapabilities();
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "category.list") {
      const result = { items: portal.listCategories() };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "category.resolve_experience") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.getExperience(argumentsObject.category, principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "category.get") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = { item: portal.getCategoryContext(argumentsObject.category, principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "directory.list") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = { items: portal.listDirectoryGuides(argumentsObject.category, principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "directory.create") {
      const result = portal.createDirectoryGuide(parseDirectoryGuideCreateInput(argumentsObject), hasOperatorKey(request));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "directory.update") {
      if (typeof argumentsObject.directoryId !== "string") throw new Error("directoryIdが必要です。");
      const result = portal.updateDirectoryGuide(argumentsObject.directoryId, parseDirectoryGuideUpdateInput(argumentsObject), hasOperatorKey(request));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "directory.delete") {
      if (typeof argumentsObject.directoryId !== "string") throw new Error("directoryIdが必要です。");
      const result = portal.deleteDirectoryGuide(argumentsObject.directoryId, hasOperatorKey(request));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.search") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.searchProvidersPage(argumentsObject.category, principal, {
        search: parseOptionalStringValue(argumentsObject.search, "search"),
        theme: parseOptionalStringValue(argumentsObject.theme, "theme"),
        location: parseOptionalStringValue(argumentsObject.location, "location"),
        sort: parseOptionalEnumValue(argumentsObject.sort, "sort", providerSortValues),
      }, parsePaginationArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.get") {
      if (typeof argumentsObject.providerId !== "string") throw new Error("providerIdが必要です。");
      const result = portal.getProvider(argumentsObject.providerId, principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.update") {
      if (typeof argumentsObject.providerId !== "string") throw new Error("providerIdが必要です。");
      const themes = parseOptionalStringArray(argumentsObject.themes, "themes");
      const publicFields = parseStringMap(argumentsObject.publicFields, "publicFields");
      const result = portal.updateProvider(principal, argumentsObject.providerId, {
        ...(typeof argumentsObject.name === "string" ? { name: argumentsObject.name } : {}),
        ...(themes ? { themes } : {}),
        ...(typeof argumentsObject.location === "string" ? { location: argumentsObject.location } : {}),
        ...(publicFields ? { publicFields } : {}),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.listing_submit") {
      if (typeof argumentsObject.providerId !== "string") throw new Error("providerIdが必要です。");
      const result = portal.submitProviderListing(principal, argumentsObject.providerId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.listing_review") {
      if (typeof argumentsObject.providerId !== "string" || !isProviderListingStatus(argumentsObject.status)) {
        throw new Error("providerIdと有効な審査結果statusが必要です。");
      }
      const result = portal.reviewProviderListing(
        argumentsObject.providerId,
        argumentsObject.status,
        typeof argumentsObject.note === "string" ? argumentsObject.note : undefined,
        hasOperatorKey(request),
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.listing_review_queue") {
      if (argumentsObject.category !== undefined && !isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      if (argumentsObject.status !== undefined && !isProviderListingStatus(argumentsObject.status)) throw new Error("statusが不正です。");
      const result = portal.listListingReviewQueue(
        hasOperatorKey(request),
        isCategorySlug(argumentsObject.category) ? argumentsObject.category : undefined,
        isProviderListingStatus(argumentsObject.status) ? argumentsObject.status : "pending_review",
        parsePaginationArguments(argumentsObject),
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.switch_context") {
      const token = getBearerToken(request);
      if (!token || !isCategorySlug(argumentsObject.category) || !isPortalRole(argumentsObject.role)) {
        throw new Error("認証トークン、category、roleが必要です。");
      }
      const result = portal.switchContext(token, argumentsObject.category, argumentsObject.role);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.oidc_start") {
      if (!isCategorySlug(argumentsObject.category) || (argumentsObject.role !== undefined && !isPortalRole(argumentsObject.role))) {
        throw new Error("categoryとroleが不正です。");
      }
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.oidc_start")) return;
      const result = await auth.startOidc(argumentsObject.category, isPortalRole(argumentsObject.role) ? argumentsObject.role : "user");
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.oidc_callback") {
      if (typeof argumentsObject.code !== "string" || typeof argumentsObject.state !== "string") {
        throw new Error("codeとstateが必要です。");
      }
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.oidc_callback")) return;
      const result = await auth.completeOidc(argumentsObject.state, argumentsObject.code);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.mfa_enroll") {
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.mfa_enroll")) return;
      const result = auth.enrollMfa(getBearerToken(request));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.mfa_confirm") {
      if (typeof argumentsObject.code !== "string") throw new Error("codeが必要です。");
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.mfa_confirm")) return;
      const result = auth.confirmMfaEnrollment(getBearerToken(request), argumentsObject.code);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.mfa_complete") {
      if (typeof argumentsObject.challengeToken !== "string" || typeof argumentsObject.code !== "string") {
        throw new Error("challengeTokenとcodeが必要です。");
      }
      if (!allowAuthRequest(request, response, authRateLimiter, "mcp:auth.mfa_complete")) return;
      const result = auth.completeMfa(argumentsObject.challengeToken, argumentsObject.code);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "request.create") {
      if (!isCategorySlug(argumentsObject.category) || typeof argumentsObject.providerId !== "string" || typeof argumentsObject.title !== "string" || typeof argumentsObject.description !== "string") {
        throw new Error("category、providerId、title、descriptionが必要です。");
      }
      const result = portal.createRequest(principal, {
        category: argumentsObject.category,
        providerId: argumentsObject.providerId,
        title: argumentsObject.title,
        description: argumentsObject.description,
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "request.list") {
      const result = portal.listRequestsPage(principal, parsePaginationArguments(argumentsObject), {
        search: parseOptionalStringValue(argumentsObject.search, "search"),
        status: parseOptionalEnumValue(argumentsObject.status, "status", requestStatuses),
        sort: parseOptionalEnumValue(argumentsObject.sort, "sort", requestSortValues),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "request.update_status") {
      if (typeof argumentsObject.requestId !== "string" || !isRequestStatus(argumentsObject.status)) {
        throw new Error("requestIdと有効なstatusが必要です。");
      }
      const result = portal.updateRequestStatus(principal, argumentsObject.requestId, argumentsObject.status);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "inquiry.create") {
      if (!isCategorySlug(argumentsObject.category) || typeof argumentsObject.providerId !== "string" || typeof argumentsObject.subject !== "string" || typeof argumentsObject.message !== "string") {
        throw new Error("category、providerId、subject、messageが必要です。");
      }
      const result = portal.createInquiry(principal, {
        category: argumentsObject.category,
        providerId: argumentsObject.providerId,
        subject: argumentsObject.subject,
        message: argumentsObject.message,
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "inquiry.list") {
      const result = portal.listInquiries(principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "inquiry.update_status") {
      if (typeof argumentsObject.inquiryId !== "string" || !isInquiryStatus(argumentsObject.status)) {
        throw new Error("inquiryIdと有効なstatusが必要です。");
      }
      const result = portal.updateInquiryStatus(principal, argumentsObject.inquiryId, argumentsObject.status);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "notification.list") {
      const result = portal.listNotifications(principal, parsePaginationArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "notification.mark_read") {
      if (typeof argumentsObject.notificationId !== "string" || typeof argumentsObject.read !== "boolean") {
        throw new Error("notificationIdとreadが必要です。");
      }
      const result = portal.markNotificationRead(principal, argumentsObject.notificationId, argumentsObject.read);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "job.search") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.listJobsPage(argumentsObject.category, principal, parsePaginationArguments(argumentsObject), {
        search: parseOptionalStringValue(argumentsObject.search, "search"),
        employmentType: parseOptionalStringValue(argumentsObject.employmentType, "employmentType"),
        location: parseOptionalStringValue(argumentsObject.location, "location"),
        status: parseOptionalEnumValue(argumentsObject.status, "status", jobStatuses),
        sort: parseOptionalEnumValue(argumentsObject.sort, "sort", jobSortValues),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "job.create") {
      if (!isCategorySlug(argumentsObject.category) || typeof argumentsObject.title !== "string" || typeof argumentsObject.employmentType !== "string" || typeof argumentsObject.location !== "string" || typeof argumentsObject.description !== "string") {
        throw new Error("category、title、employmentType、location、descriptionが必要です。");
      }
      if (argumentsObject.status !== undefined && !isJobStatus(argumentsObject.status)) {
        throw new Error("statusが不正です。");
      }
      const result = portal.createJob(principal, {
        category: argumentsObject.category,
        title: argumentsObject.title,
        employmentType: argumentsObject.employmentType,
        location: argumentsObject.location,
        description: argumentsObject.description,
        ...(isJobStatus(argumentsObject.status) ? { status: argumentsObject.status } : {}),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "job.update") {
      if (typeof argumentsObject.jobId !== "string") throw new Error("jobIdが必要です。");
      if (argumentsObject.status !== undefined && !isJobStatus(argumentsObject.status)) {
        throw new Error("statusが不正です。");
      }
      const result = portal.updateJob(principal, argumentsObject.jobId, {
        ...(typeof argumentsObject.title === "string" ? { title: argumentsObject.title } : {}),
        ...(typeof argumentsObject.employmentType === "string" ? { employmentType: argumentsObject.employmentType } : {}),
        ...(typeof argumentsObject.location === "string" ? { location: argumentsObject.location } : {}),
        ...(typeof argumentsObject.description === "string" ? { description: argumentsObject.description } : {}),
        ...(isJobStatus(argumentsObject.status) ? { status: argumentsObject.status } : {}),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "application.create") {
      if (typeof argumentsObject.jobId !== "string" || typeof argumentsObject.message !== "string") {
        throw new Error("jobIdとmessageが必要です。");
      }
      const result = portal.createApplication(principal, argumentsObject.jobId, argumentsObject.message);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "application.list") {
      const result = portal.listApplicationsPage(principal, parsePaginationArguments(argumentsObject), {
        search: parseOptionalStringValue(argumentsObject.search, "search"),
        jobId: parseOptionalStringValue(argumentsObject.jobId, "jobId"),
        status: parseOptionalEnumValue(argumentsObject.status, "status", applicationStatuses),
        sort: parseOptionalEnumValue(argumentsObject.sort, "sort", applicationSortValues),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "application.update_status") {
      if (typeof argumentsObject.applicationId !== "string" || !isApplicationStatus(argumentsObject.status)) {
        throw new Error("applicationIdと有効なstatusが必要です。");
      }
      const result = portal.updateApplicationStatus(principal, argumentsObject.applicationId, argumentsObject.status);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.list") {
      const result = media.listAssets(principal, {
        search: parseOptionalStringValue(argumentsObject.search, "search"),
        mediaType: parseOptionalEnumValue(argumentsObject.mediaType, "mediaType", mediaTypes),
        status: parseOptionalEnumValue(argumentsObject.status, "status", mediaStatuses),
        rightsStatus: parseOptionalEnumValue(argumentsObject.rightsStatus, "rightsStatus", mediaRightsStatuses),
        sort: parseOptionalEnumValue(argumentsObject.sort, "sort", mediaSortValues),
      }, parsePaginationArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.get") {
      if (typeof argumentsObject.assetId !== "string") throw new Error("assetIdを指定してください。");
      const result = media.getAsset(principal, argumentsObject.assetId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.register") {
      const result = media.registerAsset(principal, parseMediaRegisterInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.update") {
      if (typeof argumentsObject.assetId !== "string") throw new Error("assetIdを指定してください。");
      const result = media.updateAsset(principal, argumentsObject.assetId, parseMediaUpdateInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.archive") {
      if (typeof argumentsObject.assetId !== "string") throw new Error("assetIdを指定してください。");
      const result = media.archiveAsset(principal, argumentsObject.assetId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.transform") {
      if (typeof argumentsObject.assetId !== "string") throw new Error("assetIdを指定してください。");
      const result = media.transformAsset(principal, argumentsObject.assetId, parseMediaTransformInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.seo_audit") {
      const result = media.auditSiteSeo(principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "media.asset_seo_audit") {
      if (typeof argumentsObject.assetId !== "string") throw new Error("assetIdを指定してください。");
      const result = media.auditAssetSeo(principal, argumentsObject.assetId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.propose") {
      if (!isCategorySlug(argumentsObject.category) || !isContentType(argumentsObject.contentType) || !isContentAudience(argumentsObject.audience) || typeof argumentsObject.topic !== "string") {
        throw new Error("category、contentType、audience、topicが必要です。");
      }
      const result = content.createProposal(principal, {
        category: argumentsObject.category,
        contentType: argumentsObject.contentType,
        audience: argumentsObject.audience,
        topic: argumentsObject.topic,
        primaryKeyword: typeof argumentsObject.primaryKeyword === "string" ? argumentsObject.primaryKeyword : undefined,
        relatedKeywords: parseOptionalStringArray(argumentsObject.relatedKeywords, "relatedKeywords"),
        sourceFacts: parseOptionalStringArray(argumentsObject.sourceFacts, "sourceFacts"),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.create") {
      if (!isCategorySlug(argumentsObject.category) || !isContentType(argumentsObject.contentType) || !isContentAudience(argumentsObject.audience) || typeof argumentsObject.title !== "string" || typeof argumentsObject.summary !== "string" || typeof argumentsObject.body !== "string") {
        throw new Error("category、contentType、audience、title、summary、bodyが必要です。");
      }
      if (argumentsObject.slug !== undefined && typeof argumentsObject.slug !== "string") throw new Error("slugは文字列で指定してください。");
      if (argumentsObject.locale !== undefined && !isContentLocale(argumentsObject.locale)) throw new Error(`localeは${contentLocales.join(", ")}のいずれかを指定してください。`);
      if (argumentsObject.proposalId !== undefined && typeof argumentsObject.proposalId !== "string") throw new Error("proposalIdは文字列で指定してください。");
      const seo = parseContentSeoPatch(argumentsObject.seo);
      const sourceFacts = parseOptionalStringArray(argumentsObject.sourceFacts, "sourceFacts");
      const result = content.createContent(principal, {
        category: argumentsObject.category,
        contentType: argumentsObject.contentType,
        audience: argumentsObject.audience,
        title: argumentsObject.title,
        summary: argumentsObject.summary,
        body: argumentsObject.body,
        ...(typeof argumentsObject.slug === "string" ? { slug: argumentsObject.slug } : {}),
        ...(isContentLocale(argumentsObject.locale) ? { locale: argumentsObject.locale } : {}),
        ...(typeof argumentsObject.proposalId === "string" ? { proposalId: argumentsObject.proposalId } : {}),
        ...(sourceFacts ? { sourceFacts } : {}),
        ...(seo ? { seo } : {}),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.list") {
      const result = { proposals: content.listProposals(principal), items: content.listContent(principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.get") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.getContent(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.versions") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = { items: content.listVersions(principal, argumentsObject.contentId) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.version_get") {
      if (typeof argumentsObject.contentId !== "string" || typeof argumentsObject.version !== "number") throw new Error("contentIdとversionが必要です。");
      const result = content.getVersion(principal, argumentsObject.contentId, argumentsObject.version);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.version_restore") {
      if (typeof argumentsObject.contentId !== "string" || typeof argumentsObject.version !== "number") throw new Error("contentIdとversionが必要です。");
      const result = content.restoreVersion(principal, argumentsObject.contentId, argumentsObject.version);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.draft") {
      if (typeof argumentsObject.proposalId !== "string") throw new Error("proposalIdが必要です。");
      const result = content.createDraft(principal, argumentsObject.proposalId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.update") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const seo = parseContentSeoPatch(argumentsObject.seo);
      const sourceFacts = parseOptionalStringArray(argumentsObject.sourceFacts, "sourceFacts");
      const result = content.updateContent(principal, argumentsObject.contentId, {
        ...(typeof argumentsObject.title === "string" ? { title: argumentsObject.title } : {}),
        ...(typeof argumentsObject.summary === "string" ? { summary: argumentsObject.summary } : {}),
        ...(typeof argumentsObject.body === "string" ? { body: argumentsObject.body } : {}),
        ...(seo ? { seo } : {}),
        ...(sourceFacts ? { sourceFacts } : {}),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.translate") {
      if (typeof argumentsObject.contentId !== "string" || !isContentLocale(argumentsObject.targetLocale)) {
        throw new Error("contentIdとtargetLocaleを正しく指定してください。");
      }
      const seo = parseContentSeoPatch(argumentsObject.seo);
      const result = content.translateContent(principal, argumentsObject.contentId, {
        targetLocale: argumentsObject.targetLocale,
        ...(typeof argumentsObject.title === "string" ? { title: argumentsObject.title } : {}),
        ...(typeof argumentsObject.summary === "string" ? { summary: argumentsObject.summary } : {}),
        ...(typeof argumentsObject.body === "string" ? { body: argumentsObject.body } : {}),
        ...(seo ? { seo } : {}),
        ...(typeof argumentsObject.instructions === "string" ? { instructions: argumentsObject.instructions } : {}),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.duplicate") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.duplicateContent(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.archive") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.archiveContent(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.restore") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.restoreContent(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.polish") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.polishContent(principal, argumentsObject.contentId, typeof argumentsObject.instructions === "string" ? argumentsObject.instructions : undefined);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "seo.audit") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.auditSeo(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "seo.site_audit") {
      const result = content.auditSiteSeo(principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.fact_check") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.factCheck(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "workflow.reviews") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = { items: content.listReviews(principal, argumentsObject.contentId) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "workflow.request_review") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      if (argumentsObject.note !== undefined && typeof argumentsObject.note !== "string") throw new Error("noteは文字列で指定してください。");
      const result = content.requestReview(principal, argumentsObject.contentId, typeof argumentsObject.note === "string" ? argumentsObject.note : undefined);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "workflow.request_changes") {
      if (typeof argumentsObject.contentId !== "string" || typeof argumentsObject.note !== "string") throw new Error("contentIdとnoteが必要です。");
      const result = content.requestChanges(principal, argumentsObject.contentId, argumentsObject.note);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "workflow.approve") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.approveContent(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.build") {
      const result = publication.build(
        principal,
        parseOptionalStringArray(argumentsObject.contentIds, "contentIds"),
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.deploy") {
      const result = await publication.deploy(
        principal,
        parseOptionalStringArray(argumentsObject.contentIds, "contentIds"),
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.publish") {
      const result = await publication.publish(
        principal,
        parseOptionalStringArray(argumentsObject.contentIds, "contentIds"),
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.unpublish") {
      const contentIds = parseOptionalStringArray(argumentsObject.contentIds, "contentIds");
      if (!contentIds || contentIds.length === 0) throw new Error("contentIdsを1件以上指定してください。");
      const result = await publication.unpublish(
        principal,
        contentIds,
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.schedule") {
      if (typeof argumentsObject.scheduledFor !== "string") throw new Error("scheduledForは必須です。");
      const result = publication.schedule(
        principal,
        argumentsObject.scheduledFor,
        parseOptionalStringArray(argumentsObject.contentIds, "contentIds"),
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: { item: result } } });
      return;
    }

    if (name === "publication.schedule_list") {
      const result = { items: publication.listSchedules(principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.schedule_cancel") {
      if (typeof argumentsObject.scheduleId !== "string") throw new Error("scheduleIdは必須です。");
      const result = publication.cancelSchedule(principal, argumentsObject.scheduleId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: { item: result } } });
      return;
    }

    if (name === "publication.schedule_execute") {
      if (argumentsObject.before !== undefined && typeof argumentsObject.before !== "string") throw new Error("beforeは文字列で指定してください。");
      const result = await publication.executeSchedules(principal, typeof argumentsObject.before === "string" ? argumentsObject.before : undefined);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: { items: result } } });
      return;
    }

    if (name === "publication.history") {
      const result = { items: publication.listHistory(principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.rollback") {
      if (typeof argumentsObject.publicationId !== "string") throw new Error("publicationIdが必要です。");
      const result = await publication.rollback(
        principal,
        argumentsObject.publicationId,
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "未対応のMCPツールです。" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP操作に失敗しました。";
    writeJson(response, 200, { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: message }] } });
  }
}

export function createHttpServer(
  auth: AuthService,
  portal: PortalService,
  content = new ContentService(portal),
  publication = new PublicationService(portal, content),
  media = new MediaService(portal),
): Server {
  const authRateLimiter = new FixedWindowRateLimiter(10, 10 * 60 * 1000);
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const token = getBearerToken(request);
    const principal = auth.authenticate(token);

    try {
      if (request.method === "GET" && (await serveStaticAsset(url.pathname, response))) {
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, { ok: true, service: "cms-os" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/auth/config") {
        writeJson(response, 200, { item: auth.getAuthCapabilities() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/login") {
        const body = await readJson(request);
        const email = body.email;
        const password = body.password;
        const category = body.category;
        const role = body.role ?? "user";
        if (typeof email !== "string" || typeof password !== "string" || !isCategorySlug(category) || !isPortalRole(role)) {
          writeJson(response, 400, { error: "email、password、category、roleが必要です。" });
          return;
        }
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.login", email)) return;
        const login = auth.login(email, password, category, role);
        if (!login) {
          writeJson(response, 401, { error: "認証情報またはカテゴリ・ロールが正しくありません。" });
          return;
        }
        writeJson(response, 200, login);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/oidc/start") {
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isPortalRole(body.role ?? "user")) {
          writeJson(response, 400, { error: "categoryとroleが必要です。" });
          return;
        }
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.oidc_start")) return;
        try {
          const result = await auth.startOidc(body.category, body.role as PortalRole);
          writeJson(response, 200, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "OIDC認証を開始できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/auth/oidc/callback") {
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.oidc_callback")) return;
        try {
          const result = await auth.completeOidc(state ?? "", code ?? "");
          writeJson(response, 200, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "OIDC認証を完了できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/mfa/enroll") {
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.mfa_enroll")) return;
        try {
          writeJson(response, 200, { item: auth.enrollMfa(token) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "MFA登録を開始できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/mfa/confirm") {
        const body = await readJson(request);
        if (typeof body.code !== "string") {
          writeJson(response, 400, { error: "codeが必要です。" });
          return;
        }
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.mfa_confirm")) return;
        try {
          writeJson(response, 200, { item: auth.confirmMfaEnrollment(token, body.code) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "MFA登録を確定できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/mfa/complete") {
        const body = await readJson(request);
        if (typeof body.challengeToken !== "string" || typeof body.code !== "string") {
          writeJson(response, 400, { error: "challengeTokenとcodeが必要です。" });
          return;
        }
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.mfa_complete")) return;
        try {
          writeJson(response, 200, auth.completeMfa(body.challengeToken, body.code));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "MFA認証を完了できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/logout") {
        if (!allowAuthRequest(request, response, authRateLimiter, "rest:auth.logout")) return;
        auth.logout(token);
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/auth/me") {
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        writeJson(response, 200, { principal, experience: portal.getExperience(principal.category, principal) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/seo/audit") {
        try {
          writeJson(response, 200, { item: content.auditSiteSeo(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "サイト全体SEO監査に失敗しました。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/context") {
        if (!token || !principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isPortalRole(body.role)) {
          writeJson(response, 400, { error: "categoryとroleが必要です。" });
          return;
        }
        try {
          const switched = portal.switchContext(token, body.category, body.role);
          writeJson(response, 200, { principal: switched, experience: portal.getExperience(switched.category, switched) });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 403;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "コンテキストを切り替えられません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/categories") {
        writeJson(response, 200, { items: portal.listCategories() });
        return;
      }

      const categoryDetailMatch = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)$/);
      if (request.method === "GET" && categoryDetailMatch) {
        const category = categoryDetailMatch[1];
        if (!isCategorySlug(category)) {
          writeJson(response, 404, { error: "カテゴリが見つかりません。" });
          return;
        }
        writeJson(response, 200, { item: portal.getCategoryContext(category, principal) });
        return;
      }

      const experienceMatch = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)\/experience$/);
      if (request.method === "GET" && experienceMatch) {
        const category = experienceMatch[1];
        if (!isCategorySlug(category)) {
          writeJson(response, 404, { error: "カテゴリが見つかりません。" });
          return;
        }
        writeJson(response, 200, { experience: portal.getExperience(category, principal) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/directories") {
        try {
          const body = await readJson(request);
          const item = portal.createDirectoryGuide(parseDirectoryGuideCreateInput(body), hasOperatorKey(request));
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "外部案内を作成できません。" });
        }
        return;
      }

      const directoryManagementMatch = url.pathname.match(/^\/api\/v1\/directories\/([^/]+)$/);
      if (directoryManagementMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        const directoryId = directoryManagementMatch[1];
        if (!directoryId) {
          writeJson(response, 400, { error: "directoryIdが必要です。" });
          return;
        }
        try {
          if (request.method === "PATCH") {
            const body = await readJson(request);
            const item = portal.updateDirectoryGuide(directoryId, parseDirectoryGuideUpdateInput(body), hasOperatorKey(request));
            writeJson(response, 200, { item });
          } else {
            writeJson(response, 200, portal.deleteDirectoryGuide(directoryId, hasOperatorKey(request)));
          }
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "外部案内を更新できません。" });
        }
        return;
      }

      const directoryMatch = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)\/directories$/);
      if (request.method === "GET" && directoryMatch) {
        const category = directoryMatch[1];
        if (!isCategorySlug(category)) {
          writeJson(response, 404, { error: "カテゴリが見つかりません。" });
          return;
        }
        writeJson(response, 200, { items: portal.listDirectoryGuides(category, principal) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/providers") {
        const category = url.searchParams.get("category");
        if (!isCategorySlug(category)) {
          writeJson(response, 400, { error: "categoryが有効なカテゴリである必要があります。" });
          return;
        }
        try {
          writeJson(response, 200, {
            ...portal.searchProvidersPage(category, principal, {
              search: parseQueryString(url, "search"),
              theme: parseQueryString(url, "theme"),
              location: parseQueryString(url, "location"),
              sort: parseOptionalEnumValue(url.searchParams.get("sort"), "sort", providerSortValues),
            }, parsePaginationQuery(url)),
          });
        } catch (error) {
          writeJson(response, 400, { error: error instanceof Error ? error.message : "事業者を取得できません。" });
        }
        return;
      }

      const providerMatch = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
      if (providerMatch && request.method === "GET") {
        const providerId = providerMatch[1];
        if (!providerId) {
          writeJson(response, 400, { error: "providerIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.getProvider(providerId, principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "事業者情報を取得できません。" });
        }
        return;
      }

      if (providerMatch && request.method === "PATCH") {
        const providerId = providerMatch[1];
        if (!providerId) {
          writeJson(response, 400, { error: "providerIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        const themes = parseOptionalStringArray(body.themes, "themes");
        const publicFields = parseStringMap(body.publicFields, "publicFields");
        if (body.name !== undefined && typeof body.name !== "string") {
          writeJson(response, 400, { error: "nameは文字列で指定してください。" });
          return;
        }
        if (body.location !== undefined && typeof body.location !== "string") {
          writeJson(response, 400, { error: "locationは文字列で指定してください。" });
          return;
        }
        try {
          writeJson(response, 200, {
            item: portal.updateProvider(principal, providerId, {
              ...(typeof body.name === "string" ? { name: body.name } : {}),
              ...(themes ? { themes } : {}),
              ...(typeof body.location === "string" ? { location: body.location } : {}),
              ...(publicFields ? { publicFields } : {}),
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "事業者情報を更新できません。" });
        }
        return;
      }

      const providerListingSubmitMatch = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/listing-submission$/);
      if (request.method === "POST" && providerListingSubmitMatch) {
        const providerId = providerListingSubmitMatch[1];
        if (!providerId) {
          writeJson(response, 400, { error: "providerIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.submitProviderListing(principal, providerId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "掲載審査へ送信できません。" });
        }
        return;
      }

      const providerListingReviewMatch = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/listing-review$/);
      if (request.method === "PATCH" && providerListingReviewMatch) {
        const providerId = providerListingReviewMatch[1];
        if (!providerId) {
          writeJson(response, 400, { error: "providerIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isProviderListingStatus(body.status) || body.status === "pending_review") {
          writeJson(response, 400, { error: "statusはdraft、published、suspendedのいずれかで指定してください。" });
          return;
        }
        if (body.note !== undefined && typeof body.note !== "string") {
          writeJson(response, 400, { error: "noteは文字列で指定してください。" });
          return;
        }
        try {
          writeJson(response, 200, {
            item: portal.reviewProviderListing(providerId, body.status, typeof body.note === "string" ? body.note : undefined, hasOperatorKey(request)),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "掲載審査を更新できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/provider-listing-reviews") {
        const categoryValue = url.searchParams.get("category");
        const statusValue = url.searchParams.get("status");
        if (categoryValue !== null && !isCategorySlug(categoryValue)) {
          writeJson(response, 400, { error: "categoryが不正です。" });
          return;
        }
        if (statusValue !== null && !isProviderListingStatus(statusValue)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          writeJson(response, 200, {
            ...portal.listListingReviewQueue(
              hasOperatorKey(request),
              categoryValue && isCategorySlug(categoryValue) ? categoryValue : undefined,
              statusValue && isProviderListingStatus(statusValue) ? statusValue : "pending_review",
              parsePaginationQuery(url),
            ),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "掲載審査キューを取得できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/media") {
        try {
          writeJson(response, 200, media.listAssets(principal, {
            search: parseQueryString(url, "search"),
            mediaType: parseOptionalEnumValue(url.searchParams.get("mediaType"), "mediaType", mediaTypes),
            status: parseOptionalEnumValue(url.searchParams.get("status"), "status", mediaStatuses),
            rightsStatus: parseOptionalEnumValue(url.searchParams.get("rightsStatus"), "rightsStatus", mediaRightsStatuses),
            sort: parseOptionalEnumValue(url.searchParams.get("sort"), "sort", mediaSortValues),
          }, parsePaginationQuery(url)));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "メディア一覧を取得できませんでした。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/media") {
        try {
          const item = media.registerAsset(principal, parseMediaRegisterInput(await readJson(request)));
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "メディアを登録できませんでした。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/media/seo-audit") {
        try {
          const item = media.auditSiteSeo(principal);
          writeJson(response, 200, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "メディア全体のSEO監査に失敗しました。" });
        }
        return;
      }

      const mediaSeoAuditMatch = url.pathname.match(/^\/api\/v1\/media\/([^/]+)\/seo-audit$/);
      if (request.method === "POST" && mediaSeoAuditMatch) {
        const assetId = mediaSeoAuditMatch[1];
        if (!assetId) {
          writeJson(response, 400, { error: "assetIdを指定してください。" });
          return;
        }
        try {
          const item = media.auditAssetSeo(principal, assetId);
          writeJson(response, 200, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "メディアSEO監査に失敗しました。" });
        }
        return;
      }

      const mediaTransformMatch = url.pathname.match(/^\/api\/v1\/media\/([^/]+)\/transform$/);
      if (request.method === "POST" && mediaTransformMatch) {
        const assetId = mediaTransformMatch[1];
        if (!assetId) {
          writeJson(response, 400, { error: "assetIdを指定してください。" });
          return;
        }
        try {
          const item = media.transformAsset(principal, assetId, parseMediaTransformInput(await readJson(request)));
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "メディアを変換できませんでした。" });
        }
        return;
      }

      const mediaMatch = url.pathname.match(/^\/api\/v1\/media\/([^/]+)$/);
      if (mediaMatch && (request.method === "GET" || request.method === "PATCH" || request.method === "DELETE")) {
        const assetId = mediaMatch[1];
        if (!assetId) {
          writeJson(response, 400, { error: "assetIdを指定してください。" });
          return;
        }
        try {
          if (request.method === "GET") writeJson(response, 200, { item: media.getAsset(principal, assetId) });
          else if (request.method === "PATCH") writeJson(response, 200, { item: media.updateAsset(principal, assetId, parseMediaUpdateInput(await readJson(request))) });
          else writeJson(response, 200, { item: media.archiveAsset(principal, assetId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "メディアを操作できませんでした。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/content/proposals") {
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isContentType(body.contentType) || !isContentAudience(body.audience) || typeof body.topic !== "string") {
          writeJson(response, 400, { error: "category、contentType、audience、topicが必要です。" });
          return;
        }
        try {
          const item = content.createProposal(principal, {
            category: body.category,
            contentType: body.contentType,
            audience: body.audience,
            topic: body.topic,
            primaryKeyword: typeof body.primaryKeyword === "string" ? body.primaryKeyword : undefined,
            relatedKeywords: parseOptionalStringArray(body.relatedKeywords, "relatedKeywords"),
            sourceFacts: parseOptionalStringArray(body.sourceFacts, "sourceFacts"),
          });
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "企画案を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/content/proposals") {
        try {
          writeJson(response, 200, { items: content.listProposals(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "企画案を取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/content/drafts") {
        const body = await readJson(request);
        if (typeof body.proposalId !== "string") {
          writeJson(response, 400, { error: "proposalIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 201, { item: content.createDraft(principal, body.proposalId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "下書きを作成できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/content") {
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isContentType(body.contentType) || !isContentAudience(body.audience) || typeof body.title !== "string" || typeof body.summary !== "string" || typeof body.body !== "string") {
          writeJson(response, 400, { error: "category、contentType、audience、title、summary、bodyが必要です。" });
          return;
        }
        if (body.slug !== undefined && typeof body.slug !== "string") {
          writeJson(response, 400, { error: "slugは文字列で指定してください。" });
          return;
        }
        if (body.locale !== undefined && !isContentLocale(body.locale)) {
          writeJson(response, 400, { error: `localeは${contentLocales.join(", ")}のいずれかを指定してください。` });
          return;
        }
        if (body.proposalId !== undefined && typeof body.proposalId !== "string") {
          writeJson(response, 400, { error: "proposalIdは文字列で指定してください。" });
          return;
        }
        try {
          const seo = parseContentSeoPatch(body.seo);
          const sourceFacts = parseOptionalStringArray(body.sourceFacts, "sourceFacts");
          const item = content.createContent(principal, {
            category: body.category,
            contentType: body.contentType,
            audience: body.audience,
            title: body.title,
            summary: body.summary,
            body: body.body,
            ...(typeof body.slug === "string" ? { slug: body.slug } : {}),
            ...(isContentLocale(body.locale) ? { locale: body.locale } : {}),
            ...(typeof body.proposalId === "string" ? { proposalId: body.proposalId } : {}),
            ...(sourceFacts ? { sourceFacts } : {}),
            ...(seo ? { seo } : {}),
          });
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/content") {
        try {
          writeJson(response, 200, { items: content.listContent(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを取得できません。" });
        }
        return;
      }

      const contentReviewsMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/reviews$/);
      if (request.method === "GET" && contentReviewsMatch) {
        const contentId = contentReviewsMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { items: content.listReviews(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "レビュー履歴を取得できません。" });
        }
        return;
      }

      const contentReviewActionMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/(review-request|request-changes)$/);
      if (request.method === "POST" && contentReviewActionMatch) {
        const contentId = contentReviewActionMatch[1];
        const action = contentReviewActionMatch[2];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (body.note !== undefined && typeof body.note !== "string") {
          writeJson(response, 400, { error: "noteは文字列で指定してください。" });
          return;
        }
        if (action === "request-changes" && typeof body.note !== "string") {
          writeJson(response, 400, { error: "差し戻し理由を指定してください。" });
          return;
        }
        try {
          const item = action === "review-request"
            ? content.requestReview(principal, contentId, typeof body.note === "string" ? body.note : undefined)
            : content.requestChanges(principal, contentId, body.note as string);
          writeJson(response, action === "review-request" ? 201 : 200, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "レビュー操作に失敗しました。" });
        }
        return;
      }

      const contentActionMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/(translate|polish|seo-audit|fact-check|approve)$/);
      if (request.method === "POST" && contentActionMatch) {
        const contentId = contentActionMatch[1];
        const action = contentActionMatch[2];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          if (action === "translate") {
            const body = await readJson(request);
            if (!isContentLocale(body.targetLocale)) {
              writeJson(response, 400, { error: `targetLocaleは${contentLocales.join(", ")}のいずれかを指定してください。` });
              return;
            }
            const seo = parseContentSeoPatch(body.seo);
            writeJson(response, 201, {
              item: content.translateContent(principal, contentId, {
                targetLocale: body.targetLocale,
                ...(typeof body.title === "string" ? { title: body.title } : {}),
                ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
                ...(typeof body.body === "string" ? { body: body.body } : {}),
                ...(seo ? { seo } : {}),
                ...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}),
              }),
            });
          } else if (action === "polish") {
            const body = await readJson(request);
            if (body.instructions !== undefined && typeof body.instructions !== "string") {
              writeJson(response, 400, { error: "instructionsは文字列で指定してください。" });
              return;
            }
            writeJson(response, 200, { item: content.polishContent(principal, contentId, typeof body.instructions === "string" ? body.instructions : undefined) });
          } else if (action === "seo-audit") {
            writeJson(response, 200, { item: content.auditSeo(principal, contentId) });
          } else if (action === "fact-check") {
            writeJson(response, 200, { item: content.factCheck(principal, contentId) });
          } else {
            writeJson(response, 200, { item: content.approveContent(principal, contentId) });
          }
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツ操作に失敗しました。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/build") {
        const body = await readJson(request);
        if (body.contentIds !== undefined && (!Array.isArray(body.contentIds) || body.contentIds.some((item) => typeof item !== "string"))) {
          writeJson(response, 400, { error: "contentIdsは文字列配列で指定してください。" });
          return;
        }
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const result = publication.build(
            principal,
            Array.isArray(body.contentIds) ? body.contentIds as string[] : undefined,
            typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          );
          writeJson(response, 201, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "静的公開ファイルを生成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/publications") {
        try {
          writeJson(response, 200, { items: publication.listHistory(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "公開履歴を取得できません。" });
        }
        return;
      }

      const rollbackPublicationMatch = url.pathname.match(/^\/api\/v1\/publications\/([^/]+)\/rollback$/);
      if (request.method === "POST" && rollbackPublicationMatch) {
        const publicationId = rollbackPublicationMatch[1];
        if (!publicationId) {
          writeJson(response, 400, { error: "publicationIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const result = await publication.rollback(principal, publicationId, typeof body.baseUrl === "string" ? body.baseUrl : undefined);
          writeJson(response, 202, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "公開履歴をロールバックできません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/deploy") {
        const body = await readJson(request);
        if (body.contentIds !== undefined && (!Array.isArray(body.contentIds) || body.contentIds.some((item) => typeof item !== "string"))) {
          writeJson(response, 400, { error: "contentIdsは文字列配列で指定してください。" });
          return;
        }
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const result = await publication.deploy(
            principal,
            Array.isArray(body.contentIds) ? body.contentIds as string[] : undefined,
            typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          );
          writeJson(response, 202, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Cloudflare Pagesへの公開に失敗しました。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/publish") {
        const body = await readJson(request);
        if (body.contentIds !== undefined && (!Array.isArray(body.contentIds) || body.contentIds.some((item) => typeof item !== "string"))) {
          writeJson(response, 400, { error: "contentIdsは文字列配列で指定してください。" });
          return;
        }
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const result = await publication.publish(
            principal,
            Array.isArray(body.contentIds) ? body.contentIds as string[] : undefined,
            typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          );
          writeJson(response, 202, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを公開できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/unpublish") {
        const body = await readJson(request);
        if (!Array.isArray(body.contentIds) || body.contentIds.length === 0 || body.contentIds.some((item) => typeof item !== "string")) {
          writeJson(response, 400, { error: "contentIdsは1件以上の文字列配列で指定してください。" });
          return;
        }
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const item = await publication.unpublish(
            principal,
            body.contentIds as string[],
            typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          );
          writeJson(response, 202, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "公開取消できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/schedules") {
        const body = await readJson(request);
        if (typeof body.scheduledFor !== "string") {
          writeJson(response, 400, { error: "scheduledForは必須です。" });
          return;
        }
        if (body.contentIds !== undefined && (!Array.isArray(body.contentIds) || body.contentIds.some((item) => typeof item !== "string"))) {
          writeJson(response, 400, { error: "contentIdsは文字列配列で指定してください。" });
          return;
        }
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const item = publication.schedule(
            principal,
            body.scheduledFor,
            Array.isArray(body.contentIds) ? body.contentIds as string[] : undefined,
            typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          );
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約公開を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/publications/schedules") {
        try {
          writeJson(response, 200, { items: publication.listSchedules(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約公開一覧を取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/schedules/execute") {
        const body = await readJson(request);
        if (body.before !== undefined && typeof body.before !== "string") {
          writeJson(response, 400, { error: "beforeはISO 8601形式の日時で指定してください。" });
          return;
        }
        try {
          const items = await publication.executeSchedules(principal, typeof body.before === "string" ? body.before : undefined);
          writeJson(response, 200, { items });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約公開を実行できません。" });
        }
        return;
      }

      const scheduleCancelMatch = url.pathname.match(/^\/api\/v1\/publications\/schedules\/([^/]+)\/cancel$/);
      if (request.method === "POST" && scheduleCancelMatch) {
        const scheduleId = scheduleCancelMatch[1];
        if (!scheduleId) {
          writeJson(response, 400, { error: "scheduleIdは必須です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: publication.cancelSchedule(principal, scheduleId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約公開を取り消せません。" });
        }
        return;
      }

      const contentVersionRestoreMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/versions\/(\d+)\/restore$/);
      if (request.method === "POST" && contentVersionRestoreMatch) {
        const contentId = contentVersionRestoreMatch[1];
        const versionNumber = Number(contentVersionRestoreMatch[2]);
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: content.restoreVersion(principal, contentId, versionNumber) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツ版を復元できません。" });
        }
        return;
      }

      const contentVersionsMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/versions(?:\/(\d+))?$/);
      if (request.method === "GET" && contentVersionsMatch) {
        const contentId = contentVersionsMatch[1];
        const versionParam = contentVersionsMatch[2];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          if (versionParam === undefined) {
            writeJson(response, 200, { items: content.listVersions(principal, contentId) });
          } else {
            writeJson(response, 200, { item: content.getVersion(principal, contentId, Number(versionParam)) });
          }
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツ版を取得できません。" });
        }
        return;
      }

      const contentMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)$/);
      if (request.method === "GET" && contentMatch) {
        const contentId = contentMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: content.getContent(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを取得できません。" });
        }
        return;
      }

      if (request.method === "PATCH" && contentMatch) {
        const contentId = contentMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (body.title !== undefined && typeof body.title !== "string") {
          writeJson(response, 400, { error: "titleは文字列で指定してください。" });
          return;
        }
        if (body.summary !== undefined && typeof body.summary !== "string") {
          writeJson(response, 400, { error: "summaryは文字列で指定してください。" });
          return;
        }
        if (body.body !== undefined && typeof body.body !== "string") {
          writeJson(response, 400, { error: "bodyは文字列で指定してください。" });
          return;
        }
        try {
          const seo = parseContentSeoPatch(body.seo);
          const sourceFacts = parseOptionalStringArray(body.sourceFacts, "sourceFacts");
          writeJson(response, 200, {
            item: content.updateContent(principal, contentId, {
              ...(typeof body.title === "string" ? { title: body.title } : {}),
              ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
              ...(typeof body.body === "string" ? { body: body.body } : {}),
              ...(seo ? { seo } : {}),
              ...(sourceFacts ? { sourceFacts } : {}),
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを更新できません。" });
        }
        return;
      }

      if (request.method === "DELETE" && contentMatch) {
        const contentId = contentMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: content.archiveContent(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツをアーカイブできません。" });
        }
        return;
      }

      const duplicateMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/duplicate$/);
      if (request.method === "POST" && duplicateMatch) {
        const contentId = duplicateMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 201, { item: content.duplicateContent(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを複製できません。" });
        }
        return;
      }

      const restoreMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/restore$/);
      if (request.method === "POST" && restoreMatch) {
        const contentId = restoreMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: content.restoreContent(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを復元できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/requests") {
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || typeof body.providerId !== "string" || typeof body.title !== "string" || typeof body.description !== "string") {
          writeJson(response, 400, { error: "category、providerId、title、descriptionが必要です。" });
          return;
        }
        try {
          const result = portal.createRequest(principal, {
            category: body.category,
            providerId: body.providerId,
            title: body.title,
            description: body.description,
          });
          writeJson(response, 201, { item: result });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "依頼を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/requests") {
        try {
          writeJson(response, 200, {
            ...portal.listRequestsPage(principal, parsePaginationQuery(url), {
              search: parseQueryString(url, "search"),
              status: parseOptionalEnumValue(url.searchParams.get("status"), "status", requestStatuses),
              sort: parseOptionalEnumValue(url.searchParams.get("sort"), "sort", requestSortValues),
            }),
          });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "依頼を取得できません。" });
        }
        return;
      }

      const requestMatch = url.pathname.match(/^\/api\/v1\/requests\/([^/]+)$/);
      if (request.method === "PATCH" && requestMatch) {
        const requestId = requestMatch[1];
        if (!requestId) {
          writeJson(response, 400, { error: "requestIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isRequestStatus(body.status)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.updateRequestStatus(principal, requestId, body.status) });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "依頼の状態を更新できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/inquiries") {
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || typeof body.providerId !== "string" || typeof body.subject !== "string" || typeof body.message !== "string") {
          writeJson(response, 400, { error: "category、providerId、subject、messageが必要です。" });
          return;
        }
        try {
          writeJson(response, 201, {
            item: portal.createInquiry(principal, {
              category: body.category,
              providerId: body.providerId,
              subject: body.subject,
              message: body.message,
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "問い合わせを作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/inquiries") {
        try {
          writeJson(response, 200, { items: portal.listInquiries(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "問い合わせを取得できません。" });
        }
        return;
      }

      const inquiryMatch = url.pathname.match(/^\/api\/v1\/inquiries\/([^/]+)$/);
      if (request.method === "PATCH" && inquiryMatch) {
        const inquiryId = inquiryMatch[1];
        if (!inquiryId) {
          writeJson(response, 400, { error: "inquiryIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isInquiryStatus(body.status)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.updateInquiryStatus(principal, inquiryId, body.status) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "問い合わせの状態を更新できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/notifications") {
        try {
          writeJson(response, 200, { ...portal.listNotifications(principal, parsePaginationQuery(url)) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "通知を取得できません。" });
        }
        return;
      }

      const notificationMatch = url.pathname.match(/^\/api\/v1\/notifications\/([^/]+)$/);
      if (request.method === "PATCH" && notificationMatch) {
        const notificationId = notificationMatch[1];
        if (!notificationId) {
          writeJson(response, 400, { error: "notificationIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (typeof body.read !== "boolean") {
          writeJson(response, 400, { error: "readはbooleanで指定してください。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.markNotificationRead(principal, notificationId, body.read) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "通知を更新できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/jobs") {
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || typeof body.title !== "string" || typeof body.employmentType !== "string" || typeof body.location !== "string" || typeof body.description !== "string") {
          writeJson(response, 400, { error: "category、title、employmentType、location、descriptionが必要です。" });
          return;
        }
        if (body.status !== undefined && !isJobStatus(body.status)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          const item = portal.createJob(principal, {
            category: body.category,
            title: body.title,
            employmentType: body.employmentType,
            location: body.location,
            description: body.description,
            ...(isJobStatus(body.status) ? { status: body.status } : {}),
          });
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "求人を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/jobs") {
        const category = url.searchParams.get("category");
        if (!isCategorySlug(category)) {
          writeJson(response, 400, { error: "categoryが有効なカテゴリである必要があります。" });
          return;
        }
        try {
          writeJson(response, 200, {
            ...portal.listJobsPage(category, principal, parsePaginationQuery(url), {
              search: parseQueryString(url, "search"),
              employmentType: parseQueryString(url, "employmentType"),
              location: parseQueryString(url, "location"),
              status: parseOptionalEnumValue(url.searchParams.get("status"), "status", jobStatuses),
              sort: parseOptionalEnumValue(url.searchParams.get("sort"), "sort", jobSortValues),
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "求人を取得できません。" });
        }
        return;
      }

      const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
      if (request.method === "PATCH" && jobMatch) {
        const jobId = jobMatch[1];
        if (!jobId) {
          writeJson(response, 400, { error: "jobIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (body.title !== undefined && typeof body.title !== "string") {
          writeJson(response, 400, { error: "titleは文字列で指定してください。" });
          return;
        }
        if (body.employmentType !== undefined && typeof body.employmentType !== "string") {
          writeJson(response, 400, { error: "employmentTypeは文字列で指定してください。" });
          return;
        }
        if (body.location !== undefined && typeof body.location !== "string") {
          writeJson(response, 400, { error: "locationは文字列で指定してください。" });
          return;
        }
        if (body.description !== undefined && typeof body.description !== "string") {
          writeJson(response, 400, { error: "descriptionは文字列で指定してください。" });
          return;
        }
        if (body.status !== undefined && !isJobStatus(body.status)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          writeJson(response, 200, {
            item: portal.updateJob(principal, jobId, {
              ...(typeof body.title === "string" ? { title: body.title } : {}),
              ...(typeof body.employmentType === "string" ? { employmentType: body.employmentType } : {}),
              ...(typeof body.location === "string" ? { location: body.location } : {}),
              ...(typeof body.description === "string" ? { description: body.description } : {}),
              ...(isJobStatus(body.status) ? { status: body.status } : {}),
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "求人を更新できません。" });
        }
        return;
      }

      const applicationMatch = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/applications$/);
      if (request.method === "POST" && applicationMatch) {
        const jobId = applicationMatch[1];
        if (!jobId) {
          writeJson(response, 400, { error: "jobIdが必要です。" });
          return;
        }
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (typeof body.message !== "string") {
          writeJson(response, 400, { error: "messageが必要です。" });
          return;
        }
        try {
          const result = portal.createApplication(principal, jobId, body.message);
          writeJson(response, 201, { item: result });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "応募を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/applications") {
        try {
          writeJson(response, 200, {
            ...portal.listApplicationsPage(principal, parsePaginationQuery(url), {
              search: parseQueryString(url, "search"),
              jobId: parseQueryString(url, "jobId"),
              status: parseOptionalEnumValue(url.searchParams.get("status"), "status", applicationStatuses),
              sort: parseOptionalEnumValue(url.searchParams.get("sort"), "sort", applicationSortValues),
            }),
          });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "応募情報を取得できません。" });
        }
        return;
      }

      const applicationStatusMatch = url.pathname.match(/^\/api\/v1\/applications\/([^/]+)$/);
      if (request.method === "PATCH" && applicationStatusMatch) {
        const applicationId = applicationStatusMatch[1];
        if (!applicationId) {
          writeJson(response, 400, { error: "applicationIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isApplicationStatus(body.status)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.updateApplicationStatus(principal, applicationId, body.status) });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "応募の状態を更新できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/mcp") {
        await handleMcp(request, response, auth, portal, content, publication, media, authRateLimiter);
        return;
      }

      const categoryCandidate = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)$/)?.[1];
      if (categoryCandidate && isCategorySlug(categoryCandidate)) {
        writeJson(response, 404, { error: "カテゴリの操作は未実装です。" });
        return;
      }

      writeJson(response, 404, { error: "エンドポイントが見つかりません。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "サーバーエラーが発生しました。";
      writeJson(response, 400, { error: message });
    }
  });
}
