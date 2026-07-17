import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import { AuthServiceError, type AuthService } from "../domain/auth.js";
import { applicationSortValues, jobSortValues, PortalService, PortalServiceError, providerCompareLimit, providerSortValues, requestSortValues } from "../application/portal-service.js";
import {
  ContentService,
  ContentServiceError,
  proposalSortValues,
  contentSortValues,
  type ContentCreateInput,
  type ContentListQuery,
  type ContentProposalListQuery,
  type ContentProposalCreateInput,
  isContentAudience,
  isContentLocale,
  isContentType,
  parseOptionalStringArray,
} from "../application/content-service.js";
import { PublicationService, PublicationServiceError } from "../application/publication-service.js";
import { MediaService, MediaServiceError, mediaSortValues, type MediaRegisterInput, type MediaUpdateInput } from "../application/media-service.js";
import { WebhookService, WebhookServiceError, webhookDeliverySortValues, type WebhookSubscriptionCreateInput, type WebhookSubscriptionUpdateInput } from "../application/webhook-service.js";
import { MAX_BATCH_ITEMS, OperationService, OperationServiceError, type ContentCreateBatchInput, type ContentDraftBatchInput, type ContentPolishBatchInput, type ContentPrepareBatchInput, type ContentProposeBatchInput, type OperationSubmitInput } from "../application/operation-service.js";
import { PortalPlanningService, PortalPlanningServiceError, type PortalPlanCreateInput } from "../application/portal-planning-service.js";
import { operationTypes, type OperationType } from "../domain/operation-store.js";
import { applicationStatuses, bookingStatuses as bookingStatusValues, categorySlugs, contentAudiences, contentLocales, contentTypes, contentVisibilityValues, contentWorkflowStatuses, directoryGuideKinds, inquiryStatuses, jobStatuses, mediaRightsStatuses, mediaStatuses, mediaTypes, portalPlanGoals, portalRoles, providerListingStatuses, requestStatuses, webhookDeliveryStatuses, webhookEventTypes, webhookSubscriptionStatuses, type ApplicationStatus, type BookingStatus, type CategorySlug, type ContentJsonLdType, type ContentSeo, type DirectoryGuide, type InquiryStatus, type JobStatus, type MediaAsset, type MediaRightsStatus, type MediaStatus, type MediaTransformSpec, type MediaType, type PortalRole, type PortalPlanGoal, type ContentAudience, type ProviderListingStatus, type RequestStatus, type WebhookDeliveryStatus, type WebhookEventType } from "../domain/types.js";
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

function isContentJsonLdType(value: unknown): value is ContentJsonLdType {
  return typeof value === "string" && ["Organization", "Article", "BlogPosting", "JobPosting", "NewsArticle", "FAQPage"].includes(value);
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && (requestStatuses as readonly string[]).includes(value);
}

function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (bookingStatusValues as readonly string[]).includes(value);
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
  return typeof value === "string" && portalRoles.includes(value as PortalRole);
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

type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: "application/json";
};

function listMcpResources(portal: PortalService): McpResource[] {
  return [
    {
      uri: "cms-os://categories",
      name: "CMS-OSカテゴリ一覧",
      description: "CMS-OSで利用できる業界カテゴリと表示ナビゲーションの一覧です。",
      mimeType: "application/json",
    },
    ...portal.listCategories().flatMap((category) => [
      {
        uri: `cms-os://categories/${category.slug}/context`,
        name: `${category.label}のカテゴリコンテキスト`,
        description: "現在の認証ロールに応じた表示モジュール、操作権限、外部案内を返します。",
        mimeType: "application/json" as const,
      },
      {
        uri: `cms-os://categories/${category.slug}/experience`,
        name: `${category.label}の表示体験`,
        description: "現在の認証ロールに応じた表示対象と操作可能なアクションを返します。",
        mimeType: "application/json" as const,
      },
      {
        uri: "cms-os://categories/" + category.slug + "/summary",
        name: category.label + "のポータルサマリー",
        description: "現在の認証ロールで表示できる件数と次アクションを返します。",
        mimeType: "application/json" as const,
      },
      {
        uri: `cms-os://categories/${category.slug}/directories`,
        name: `${category.label}の外部案内`,
        description: "現在の認証ロールで表示できる外部ディレクトリ・予約・事業者向け案内を返します。",
        mimeType: "application/json" as const,
      },
    ]),
  ];
}

function readMcpResource(uri: string, portal: PortalService, principal: ReturnType<AuthService["authenticate"]>): unknown {
  if (uri === "cms-os://categories") return { items: portal.listCategories() };
  const match = uri.match(/^cms-os:\/\/categories\/([^/]+)\/(context|experience|summary|directories)$/);
  if (!match || !isCategorySlug(match[1])) throw new Error("指定されたMCPリソースが見つかりません。");
  const category = match[1];
  if (match[2] === "context") return { item: portal.getCategoryContext(category, principal) };
  if (match[2] === "experience") return { item: portal.getExperience(category, principal) };
  if (match[2] === "summary") return { item: portal.getSummary(category, principal) };
  return { items: portal.listDirectoryGuides(category, principal) };
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
  if (input.jsonLdType !== undefined) {
    if (!isContentJsonLdType(input.jsonLdType)) throw new Error("seo.jsonLdTypeが不正です。");
    result.jsonLdType = input.jsonLdType;
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

function parseWebhookEvents(value: unknown): WebhookEventType[] {
  if (!Array.isArray(value) || value.some((event) => typeof event !== "string" || !webhookEventTypes.includes(event as WebhookEventType))) throw new Error("eventsは有効なWebhookイベントの配列で指定してください。");
  return value as WebhookEventType[];
}

function parseWebhookCreateInput(input: Record<string, unknown>): WebhookSubscriptionCreateInput {
  if (!isCategorySlug(input.category) || typeof input.endpointUrl !== "string") throw new Error("categoryとendpointUrlが必要です。");
  const events = parseWebhookEvents(input.events);
  if (input.description !== undefined && typeof input.description !== "string") throw new Error("descriptionは文字列で指定してください。");
  if (input.secret !== undefined && typeof input.secret !== "string") throw new Error("secretは文字列で指定してください。");
  return {
    category: input.category,
    endpointUrl: input.endpointUrl,
    events,
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.secret === "string" ? { secret: input.secret } : {}),
  };
}

function parseWebhookUpdateInput(input: Record<string, unknown>): WebhookSubscriptionUpdateInput {
  const patch: WebhookSubscriptionUpdateInput = {};
  if (input.endpointUrl !== undefined) {
    if (typeof input.endpointUrl !== "string") throw new Error("endpointUrlは文字列で指定してください。");
    patch.endpointUrl = input.endpointUrl;
  }
  if (input.events !== undefined) patch.events = parseWebhookEvents(input.events);
  if (input.description !== undefined) {
    if (typeof input.description !== "string") throw new Error("descriptionは文字列で指定してください。");
    patch.description = input.description;
  }
  if (input.status !== undefined) {
    if (typeof input.status !== "string" || !webhookSubscriptionStatuses.includes(input.status as (typeof webhookSubscriptionStatuses)[number])) throw new Error("statusが不正です。");
    patch.status = input.status as (typeof webhookSubscriptionStatuses)[number];
  }
  return patch;
}

function parseContentCreateInput(input: Record<string, unknown>): ContentCreateInput {
  if (!isCategorySlug(input.category) || !isContentType(input.contentType) || !isContentAudience(input.audience) || typeof input.title !== "string" || typeof input.summary !== "string" || (input.body !== undefined && typeof input.body !== "string") || (input.body === undefined && !Array.isArray(input.blocks))) {
    throw new Error("category、contentType、audience、title、summary、およびbodyまたはblocksが必要です。");
  }
  if (input.slug !== undefined && typeof input.slug !== "string") throw new Error("slugは文字列で指定してください。");
  if (input.locale !== undefined && !isContentLocale(input.locale)) throw new Error(`localeは${contentLocales.join(", ")}のいずれかを指定してください。`);
  if (input.proposalId !== undefined && typeof input.proposalId !== "string") throw new Error("proposalIdは文字列で指定してください。");
  const visibility = parseOptionalEnumValue(input.visibility, "visibility", contentVisibilityValues);
  const tags = parseOptionalStringArray(input.tags, "tags");
  if (input.series !== undefined && typeof input.series !== "string") throw new Error("seriesは文字列で指定してください。");
  if (input.featured !== undefined && typeof input.featured !== "boolean") throw new Error("featuredは真偽値で指定してください。");
  if (input.expiresAt !== undefined && typeof input.expiresAt !== "string") throw new Error("expiresAtは文字列で指定してください。");
  if (input.authors !== undefined && (!Array.isArray(input.authors) || input.authors.some((author) => !author || typeof author !== "object" || Array.isArray(author) || typeof (author as Record<string, unknown>).name !== "string"))) {
    throw new Error("authorsはnameを持つオブジェクトの配列で指定してください。");
  }
  const seo = parseContentSeoPatch(input.seo);
  const mediaIds = parseOptionalStringArray(input.mediaIds, "mediaIds");
  const sourceFacts = parseOptionalStringArray(input.sourceFacts, "sourceFacts");
  const sourceEvidence = parseOptionalSourceEvidence(input.sourceEvidence);
  return {
    category: input.category,
    contentType: input.contentType,
    audience: input.audience,
    ...(mediaIds ? { mediaIds } : {}),
    title: input.title,
    summary: input.summary,
    ...(typeof input.body === "string" ? { body: input.body } : {}),
    ...(Array.isArray(input.blocks) ? { blocks: input.blocks as ContentCreateInput["blocks"] } : {}),
    ...(input.structuredData !== undefined ? { structuredData: input.structuredData as ContentCreateInput["structuredData"] } : {}),
    ...(sourceEvidence ? { sourceEvidence } : {}),
    ...(typeof input.slug === "string" ? { slug: input.slug } : {}),
    ...(isContentLocale(input.locale) ? { locale: input.locale } : {}),
    ...(typeof input.proposalId === "string" ? { proposalId: input.proposalId } : {}),
    ...(sourceFacts ? { sourceFacts } : {}),
    ...(visibility ? { visibility } : {}),
    ...(tags ? { tags } : {}),
    ...(typeof input.series === "string" ? { series: input.series } : {}),
    ...(Array.isArray(input.authors) ? { authors: input.authors as ContentCreateInput["authors"] } : {}),
    ...(typeof input.featured === "boolean" ? { featured: input.featured } : {}),
    ...(typeof input.expiresAt === "string" ? { expiresAt: input.expiresAt } : {}),
    ...(seo ? { seo } : {}),
  };
}

function parseContentMetadataPatch(input: Record<string, unknown>): Pick<ContentCreateInput, "visibility" | "tags" | "series" | "authors" | "featured" | "expiresAt"> {
  const visibility = parseOptionalEnumValue(input.visibility, "visibility", contentVisibilityValues);
  const tags = parseOptionalStringArray(input.tags, "tags");
  if (input.series !== undefined && typeof input.series !== "string") throw new Error("seriesは文字列で指定してください。");
  if (input.featured !== undefined && typeof input.featured !== "boolean") throw new Error("featuredは真偽値で指定してください。");
  if (input.expiresAt !== undefined && typeof input.expiresAt !== "string") throw new Error("expiresAtは文字列で指定してください。");
  if (input.authors !== undefined && (!Array.isArray(input.authors) || input.authors.some((author) => !author || typeof author !== "object" || Array.isArray(author) || typeof (author as Record<string, unknown>).name !== "string"))) {
    throw new Error("authorsはnameを持つオブジェクトの配列で指定してください。");
  }
  return {
    ...(visibility ? { visibility } : {}),
    ...(tags ? { tags } : {}),
    ...(typeof input.series === "string" ? { series: input.series } : {}),
    ...(Array.isArray(input.authors) ? { authors: input.authors as ContentCreateInput["authors"] } : {}),
    ...(typeof input.featured === "boolean" ? { featured: input.featured } : {}),
    ...(typeof input.expiresAt === "string" ? { expiresAt: input.expiresAt } : {}),
  };
}

function parseOptionalSourceEvidence(value: unknown): ContentCreateInput["sourceEvidence"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("sourceEvidenceは配列で指定してください。");
  return value as ContentCreateInput["sourceEvidence"];
}

function parseContentCorrectionInput(input: Record<string, unknown>): {
  reason: string;
  body?: string;
  blocks?: ContentCreateInput["blocks"];
  structuredData?: ContentCreateInput["structuredData"];
  sourceEvidence?: ContentCreateInput["sourceEvidence"];
} {
  if (typeof input.reason !== "string" || (input.body !== undefined && typeof input.body !== "string") || (input.body === undefined && !Array.isArray(input.blocks))) {
    throw new Error("reason、および訂正後のbodyまたはblocksが必要です。");
  }
  if (input.blocks !== undefined && !Array.isArray(input.blocks)) throw new Error("blocksは配列で指定してください。");
  const sourceEvidence = parseOptionalSourceEvidence(input.sourceEvidence);
  return {
    reason: input.reason,
    ...(typeof input.body === "string" ? { body: input.body } : {}),
    ...(Array.isArray(input.blocks) ? { blocks: input.blocks as ContentCreateInput["blocks"] } : {}),
    ...(input.structuredData !== undefined ? { structuredData: input.structuredData as ContentCreateInput["structuredData"] } : {}),
    ...(sourceEvidence ? { sourceEvidence } : {}),
  };
}

function parseContentProposalInput(input: Record<string, unknown>): ContentProposalCreateInput {
  if (!isCategorySlug(input.category) || !isContentType(input.contentType) || !isContentAudience(input.audience) || typeof input.topic !== "string") {
    throw new Error("category、contentType、audience、topicが必要です。");
  }
  if (input.primaryKeyword !== undefined && typeof input.primaryKeyword !== "string") throw new Error("primaryKeywordは文字列で指定してください。");
  const relatedKeywords = parseOptionalStringArray(input.relatedKeywords, "relatedKeywords");
  const mediaIds = parseOptionalStringArray(input.mediaIds, "mediaIds");
  const sourceFacts = parseOptionalStringArray(input.sourceFacts, "sourceFacts");
  return {
    category: input.category,
    contentType: input.contentType,
    audience: input.audience,
    ...(mediaIds ? { mediaIds } : {}),
    topic: input.topic,
    ...(typeof input.primaryKeyword === "string" ? { primaryKeyword: input.primaryKeyword } : {}),
    ...(relatedKeywords ? { relatedKeywords } : {}),
    ...(sourceFacts ? { sourceFacts } : {}),
  };
}

function parseOperationSubmitInput(input: Record<string, unknown>): OperationSubmitInput {
  if (typeof input.operation !== "string" || !operationTypes.includes(input.operation as OperationType)) throw new Error("operationは有効な非同期操作を指定してください。");
  if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) throw new Error("inputはオブジェクトで指定してください。");
  const operationInput = input.input as Record<string, unknown>;
  if (input.operation === "content.create_batch") {
    if (!isCategorySlug(operationInput.category) || !Array.isArray(operationInput.items) || operationInput.items.length < 1 || operationInput.items.length > MAX_BATCH_ITEMS) {
      throw new Error(`content.create_batchはcategoryと1〜${MAX_BATCH_ITEMS}件のitemsが必要です。`);
    }
    const items = operationInput.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`items[${index}]はオブジェクトで指定してください。`);
      return parseContentCreateInput(item as Record<string, unknown>);
    });
    if (items.some((item) => item.category !== operationInput.category)) throw new Error("content.create_batchの全itemsは同じcategoryを指定してください。");
    const batch: ContentCreateBatchInput = { category: operationInput.category, items };
    return { operation: input.operation as OperationType, input: batch };
  }
  if (input.operation === "content.propose_batch") {
    if (!isCategorySlug(operationInput.category) || !Array.isArray(operationInput.items) || operationInput.items.length < 1 || operationInput.items.length > MAX_BATCH_ITEMS) {
      throw new Error(`content.propose_batchはcategoryと1〜${MAX_BATCH_ITEMS}件のitemsが必要です。`);
    }
    const items = operationInput.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`items[${index}]はオブジェクトで指定してください。`);
      return parseContentProposalInput(item as Record<string, unknown>);
    });
    if (items.some((item) => item.category !== operationInput.category)) throw new Error("content.propose_batchの全itemsは同じcategoryを指定してください。");
    const batch: ContentProposeBatchInput = { category: operationInput.category, items };
    return { operation: input.operation as OperationType, input: batch };
  }
  if (input.operation === "content.draft_batch") {
    if (!isCategorySlug(operationInput.category) || !Array.isArray(operationInput.proposalIds) || operationInput.proposalIds.length < 1 || operationInput.proposalIds.length > MAX_BATCH_ITEMS || operationInput.proposalIds.some((proposalId) => typeof proposalId !== "string" || proposalId.trim().length === 0)) {
      throw new Error(`content.draft_batchはcategoryと1〜${MAX_BATCH_ITEMS}件のproposalIdsが必要です。`);
    }
    const batch: ContentDraftBatchInput = { category: operationInput.category, proposalIds: (operationInput.proposalIds as string[]).map((proposalId) => proposalId.trim()) };
    return { operation: input.operation as OperationType, input: batch };
  }
  if (input.operation === "content.polish_batch") {
    if (!isCategorySlug(operationInput.category) || !Array.isArray(operationInput.contentIds) || operationInput.contentIds.length < 1 || operationInput.contentIds.length > MAX_BATCH_ITEMS || operationInput.contentIds.some((contentId) => typeof contentId !== "string" || contentId.trim().length === 0)) {
      throw new Error(`content.polish_batchはcategoryと1〜${MAX_BATCH_ITEMS}件のcontentIdsが必要です。`);
    }
    if (operationInput.instructions !== undefined && (typeof operationInput.instructions !== "string" || operationInput.instructions.length > 1000)) {
      throw new Error("content.polish_batchのinstructionsは1000文字以内で指定してください。");
    }
    const batch: ContentPolishBatchInput = {
      category: operationInput.category,
      contentIds: (operationInput.contentIds as string[]).map((contentId) => contentId.trim()),
      ...(typeof operationInput.instructions === "string" ? { instructions: operationInput.instructions } : {}),
    };
    return { operation: input.operation as OperationType, input: batch };
  }
  if (input.operation === "content.prepare_batch") {
    if (!isCategorySlug(operationInput.category) || !Array.isArray(operationInput.items) || operationInput.items.length < 1 || operationInput.items.length > MAX_BATCH_ITEMS) {
      throw new Error(`content.prepare_batchはcategoryと1〜${MAX_BATCH_ITEMS}件のitemsが必要です。`);
    }
    const items = operationInput.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`items[${index}]はオブジェクトで指定してください。`);
      return parseContentProposalInput(item as Record<string, unknown>);
    });
    if (items.some((item) => item.category !== operationInput.category)) throw new Error("content.prepare_batchの全itemsは同じcategoryを指定してください。");
    if (operationInput.instructions !== undefined && (typeof operationInput.instructions !== "string" || operationInput.instructions.length > 1000)) {
      throw new Error("content.prepare_batchのinstructionsは1000文字以内で指定してください。");
    }
    const batch: ContentPrepareBatchInput = {
      category: operationInput.category,
      items,
      ...(typeof operationInput.instructions === "string" ? { instructions: operationInput.instructions } : {}),
    };
    return { operation: input.operation as OperationType, input: batch };
  }
  return { operation: input.operation as OperationType, input: parseContentCreateInput(operationInput) };
}

function parsePortalPlanCreateInput(input: Record<string, unknown>): PortalPlanCreateInput {
  if (!isCategorySlug(input.category) || typeof input.theme !== "string" || typeof input.audience !== "string" || !contentAudiences.includes(input.audience as ContentAudience)) {
    throw new Error("category、theme、audienceを正しく指定してください。");
  }
  if (input.region !== undefined && typeof input.region !== "string") throw new Error("regionは文字列で指定してください。");
  if (input.goal !== undefined && (typeof input.goal !== "string" || !portalPlanGoals.includes(input.goal as PortalPlanGoal))) throw new Error("goalが不正です。");
  return {
    category: input.category,
    theme: input.theme,
    audience: input.audience as ContentAudience,
    ...(typeof input.region === "string" ? { region: input.region } : {}),
    ...(typeof input.goal === "string" ? { goal: input.goal as PortalPlanGoal } : {}),
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

function parseContentListQueryFromArguments(argumentsObject: Record<string, unknown>): ContentListQuery {
  const search = parseOptionalStringValue(argumentsObject.search, "search");
  const status = parseOptionalEnumValue(argumentsObject.status, "status", contentWorkflowStatuses);
  const audience = parseOptionalEnumValue(argumentsObject.audience, "audience", contentAudiences);
  const contentType = parseOptionalEnumValue(argumentsObject.contentType, "contentType", contentTypes);
  const locale = parseOptionalEnumValue(argumentsObject.locale, "locale", contentLocales);
  const visibility = parseOptionalEnumValue(argumentsObject.visibility, "visibility", contentVisibilityValues);
  const tags = parseOptionalStringArray(argumentsObject.tags, "tags");
  const series = parseOptionalStringValue(argumentsObject.series, "series");
  const featured = argumentsObject.featured === undefined ? undefined : argumentsObject.featured;
  if (featured !== undefined && typeof featured !== "boolean") throw new Error("featuredは真偽値で指定してください。");
  const sort = parseOptionalEnumValue(argumentsObject.sort, "sort", contentSortValues);
  return {
    ...parsePaginationArguments(argumentsObject),
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(audience ? { audience } : {}),
    ...(contentType ? { contentType } : {}),
    ...(locale ? { locale } : {}),
    ...(visibility ? { visibility } : {}),
    ...(tags ? { tags } : {}),
    ...(series ? { series } : {}),
    ...(featured !== undefined ? { featured } : {}),
    ...(sort ? { sort } : {}),
  };
}

function parseContentListQueryFromUrl(url: URL): ContentListQuery {
  const search = parseQueryString(url, "search");
  const status = parseOptionalEnumValue(url.searchParams.get("status"), "status", contentWorkflowStatuses);
  const audience = parseOptionalEnumValue(url.searchParams.get("audience"), "audience", contentAudiences);
  const contentType = parseOptionalEnumValue(url.searchParams.get("contentType"), "contentType", contentTypes);
  const locale = parseOptionalEnumValue(url.searchParams.get("locale"), "locale", contentLocales);
  const visibility = parseOptionalEnumValue(url.searchParams.get("visibility"), "visibility", contentVisibilityValues);
  const tags = parseOptionalStringArray(url.searchParams.get("tags")?.split(","), "tags");
  const series = parseQueryString(url, "series");
  const featuredValue = url.searchParams.get("featured");
  const featured = featuredValue === null ? undefined : featuredValue === "true" ? true : featuredValue === "false" ? false : (() => { throw new Error("featuredはtrueまたはfalseで指定してください。"); })();
  const sort = parseOptionalEnumValue(url.searchParams.get("sort"), "sort", contentSortValues);
  return {
    ...parsePaginationQuery(url),
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(audience ? { audience } : {}),
    ...(contentType ? { contentType } : {}),
    ...(locale ? { locale } : {}),
    ...(visibility ? { visibility } : {}),
    ...(tags ? { tags } : {}),
    ...(series ? { series } : {}),
    ...(featured !== undefined ? { featured } : {}),
    ...(sort ? { sort } : {}),
  };
}

function parseProposalListQueryFromArguments(argumentsObject: Record<string, unknown>): ContentProposalListQuery {
  const search = parseOptionalStringValue(argumentsObject.search, "search");
  const audience = parseOptionalEnumValue(argumentsObject.audience, "audience", contentAudiences);
  const contentType = parseOptionalEnumValue(argumentsObject.contentType, "contentType", contentTypes);
  const sort = parseOptionalEnumValue(argumentsObject.sort, "sort", proposalSortValues);
  return {
    ...parsePaginationArguments(argumentsObject),
    ...(search ? { search } : {}),
    ...(audience ? { audience } : {}),
    ...(contentType ? { contentType } : {}),
    ...(sort ? { sort } : {}),
  };
}

function parseProposalListQueryFromUrl(url: URL): ContentProposalListQuery {
  const search = parseQueryString(url, "search");
  const audience = parseOptionalEnumValue(url.searchParams.get("audience"), "audience", contentAudiences);
  const contentType = parseOptionalEnumValue(url.searchParams.get("contentType"), "contentType", contentTypes);
  const sort = parseOptionalEnumValue(url.searchParams.get("sort"), "sort", proposalSortValues);
  return {
    ...parsePaginationQuery(url),
    ...(search ? { search } : {}),
    ...(audience ? { audience } : {}),
    ...(contentType ? { contentType } : {}),
    ...(sort ? { sort } : {}),
  };
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
  return error instanceof AuthServiceError || error instanceof PortalServiceError || error instanceof ContentServiceError || error instanceof PublicationServiceError || error instanceof MediaServiceError || error instanceof WebhookServiceError || error instanceof OperationServiceError || error instanceof PortalPlanningServiceError ? error.statusCode : 400;
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
  webhook: WebhookService,
  operation: OperationService,
  portalPlanning: PortalPlanningService,
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
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "cms-os", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "resources/list") {
    writeJson(response, 200, { jsonrpc: "2.0", id, result: { resources: listMcpResources(portal) } });
    return;
  }

  if (method === "resources/read") {
    const params = (body.params ?? {}) as Record<string, unknown>;
    if (typeof params.uri !== "string" || !params.uri.trim()) {
      writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "uriが必要です。" } });
      return;
    }
    try {
      const uri = params.uri.trim();
      const value = readMcpResource(uri, portal, auth.authenticate(getBearerToken(request)));
      writeJson(response, 200, {
        jsonrpc: "2.0",
        id,
        result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value) }] },
      });
    } catch (error) {
      writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: error instanceof Error ? error.message : "MCPリソースを取得できません。" } });
    }
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
            name: "category.summary",
            description: "カテゴリとロールに応じた件数サマリーと次アクションを取得します。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum } }, required: ["category"] },
          },
          {
            name: "category.get",
            description: "カテゴリ、現在のロールに対応する表示体験、外部案内をまとめて取得します。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum } }, required: ["category"] },
          },
          {
            name: "portal.plan",
            description: "カテゴリ、テーマ、地域、対象ポジションから検索意図とSEOページ案を生成します。事業者向けです。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                theme: { type: "string", minLength: 2, maxLength: 100 },
                region: { type: "string", maxLength: 100 },
                audience: { enum: [...contentAudiences] },
                goal: { enum: [...portalPlanGoals] },
              },
              required: ["category", "theme", "audience"],
            },
          },
          {
            name: "portal.plan.list",
            description: "現在の事業者が作成したポータル計画を取得します。",
            inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "portal.plan.get",
            description: "作成済みポータル計画を1件取得します。",
            inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
          },
          {
            name: "portal.plan.apply",
            description: "ポータル計画のページ案から対象ポジション別のコンテンツ企画案を冪等に作成します。",
            inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
          },
          {
            name: "portal.plan.draft",
            description: "ポータル計画の企画案から対象ポジション別のコンテンツ下書きを冪等に作成します。",
            inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
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
                targetRoles: { type: "array", items: { enum: [...portalRoles] } },
                verifiedAt: { type: "string", format: "date" },
              },
              required: ["category", "name", "kind", "description", "url", "targetRoles", "verifiedAt"],
            },
          },
          {
            name: "directory.update",
            description: "運営キーで外部案内を更新します。x-cms-os-operator-keyヘッダーが必要です。",
            inputSchema: { type: "object", properties: { directoryId: { type: "string" }, category: { enum: categoryEnum }, name: { type: "string" }, kind: { enum: [...directoryGuideKinds] }, description: { type: "string" }, url: { type: "string", format: "uri" }, targetRoles: { type: "array", items: { enum: [...portalRoles] } }, verifiedAt: { type: "string", format: "date" } }, required: ["directoryId"] },
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
            name: "provider.compare",
            description: "現在のカテゴリで表示可能な事業者を最大3件まで比較します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                providerIds: { type: "array", minItems: 2, maxItems: providerCompareLimit, items: { type: "string" } },
              },
              required: ["category", "providerIds"],
            },
          },
          {
            name: "favorite.list",
            description: "ログイン中の本人がカテゴリ内で保存した公開事業者を取得します。",
            inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "favorite.add",
            description: "現在のカテゴリの公開事業者をお気に入りへ保存します。",
            inputSchema: { type: "object", properties: { providerId: { type: "string" } }, required: ["providerId"] },
          },
          {
            name: "favorite.remove",
            description: "本人が保存したお気に入りを削除します。",
            inputSchema: { type: "object", properties: { favoriteId: { type: "string" } }, required: ["favoriteId"] },
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
            name: "webhook.list",
            description: "現在の事業者が管理するWebhook購読を取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "webhook.create",
            description: "Webhook購読を作成します。secretは作成時に一度だけ返されます。",
            inputSchema: { type: "object", properties: { category: { enum: categoryEnum }, endpointUrl: { type: "string", format: "uri" }, events: { type: "array", items: { enum: [...webhookEventTypes] } }, description: { type: "string" }, secret: { type: "string" } }, required: ["category", "endpointUrl", "events"] },
          },
          {
            name: "webhook.update",
            description: "Webhook購読の送信先、イベント、状態を更新します。",
            inputSchema: { type: "object", properties: { subscriptionId: { type: "string" }, endpointUrl: { type: "string", format: "uri" }, events: { type: "array", items: { enum: [...webhookEventTypes] } }, description: { type: "string" }, status: { enum: [...webhookSubscriptionStatuses] } }, required: ["subscriptionId"] },
          },
          {
            name: "webhook.revoke",
            description: "Webhook購読を取り消します。既存の配信履歴は保持します。",
            inputSchema: { type: "object", properties: { subscriptionId: { type: "string" } }, required: ["subscriptionId"] },
          },
          {
            name: "webhook.deliveries",
            description: "Webhook配信アウトボックスの状態を取得します。",
            inputSchema: { type: "object", properties: { status: { enum: [...webhookDeliveryStatuses] }, eventType: { enum: [...webhookEventTypes] }, sort: { enum: [...webhookDeliverySortValues] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "webhook.retry",
            description: "失敗または再試行待ちのWebhook配信を手動再試行キューへ戻します。",
            inputSchema: { type: "object", properties: { deliveryId: { type: "string" } }, required: ["deliveryId"] },
          },
          {
            name: "webhook.deliver",
            description: "指定したWebhook配信を送信します。",
            inputSchema: { type: "object", properties: { deliveryId: { type: "string" } }, required: ["deliveryId"] },
          },
          {
            name: "webhook.deliver_pending",
            description: "再試行時刻を迎えたWebhook配信を上限件数まで送信します。",
            inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, required: [] },
          },
          {
            name: "operation.submit",
            description: "単一登録、検証済み本文の一括登録、対象ポジション別の企画案・下書き・清書・監査準備を非同期ジョブとして投入します。Idempotency-Keyで重複投入を防止できます。",
            inputSchema: {
              type: "object",
              properties: {
                operation: { enum: [...operationTypes] },
                input: {
                  type: "object",
                  description: "content.createは単一入力、各batch操作はcategoryと同一カテゴリの1〜50件を指定します。content.propose_batchはitems、content.draft_batchはproposalIds、content.polish_batchはcontentIds、content.prepare_batchは対象ポジション別itemsと任意のinstructionsを指定します。",
                },
                idempotencyKey: { type: "string", maxLength: 200 },
              },
              required: ["operation", "input"],
            },
          },
          {
            name: "operation.list",
            description: "現在の事業者が投入した非同期ジョブを取得します。",
            inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "operation.get",
            description: "非同期ジョブの状態を取得します。",
            inputSchema: { type: "object", properties: { operationId: { type: "string" } }, required: ["operationId"] },
          },
          {
            name: "operation.execute",
            description: "指定した非同期ジョブを実行します。",
            inputSchema: { type: "object", properties: { operationId: { type: "string" } }, required: ["operationId"] },
          },
          {
            name: "operation.execute_pending",
            description: "キューにある非同期ジョブを上限件数まで実行します。",
            inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, required: [] },
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
                role: { enum: [...portalRoles] },
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
            name: "auth.login_options",
            description: "ログイン前にカテゴリごとの表示対象ロールとナビゲーションを取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "auth.switch_context",
            description: "許可されたカテゴリとロールへ操作コンテキストを切り替えます。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: categoryEnum }, role: { enum: [...portalRoles] } },
              required: ["category", "role"],
            },
          },
          {
            name: "auth.oidc_start",
            description: "OIDC Authorization Code + PKCE認証を開始します。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: categoryEnum }, role: { enum: [...portalRoles] } },
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
            name: "booking.create",
            description: "美容カテゴリで発注者が予約リクエストを作成します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: categoryEnum },
                providerId: { type: "string" },
                menu: { type: "string" },
                requestedFor: { type: "string", format: "date-time" },
                note: { type: "string" },
              },
              required: ["category", "providerId", "menu", "requestedFor"],
            },
          },
          {
            name: "booking.list",
            description: "発注者自身または担当事業者の予約リクエストを取得します。",
            inputSchema: { type: "object", properties: { status: { enum: [...bookingStatusValues] }, limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }, required: [] },
          },
          {
            name: "booking.update_status",
            description: "予約リクエストの状態を確定または取消へ更新します。",
            inputSchema: { type: "object", properties: { bookingId: { type: "string" }, status: { enum: [...bookingStatusValues] } }, required: ["bookingId", "status"] },
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
            name: "job.get",
            description: "リクルーターは公開求人、事業者は自社求人の詳細を取得します。",
            inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
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
                mediaIds: { type: "array", maxItems: 20, items: { type: "string" } },
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
                mediaIds: { type: "array", maxItems: 20, items: { type: "string" } },
                title: { type: "string" },
                summary: { type: "string" },
                body: { type: "string" },
                blocks: { type: "array", maxItems: 100, items: { type: "object" } },
                structuredData: { type: "object", additionalProperties: true },
                slug: { type: "string" },
                locale: { enum: [...contentLocales] },
                visibility: { enum: [...contentVisibilityValues] },
                tags: { type: "array", maxItems: 30, items: { type: "string" } },
                series: { type: "string" },
                authors: { type: "array", maxItems: 10, items: { type: "object", required: ["name"], additionalProperties: true } },
                featured: { type: "boolean" },
                expiresAt: { type: "string" },
                proposalId: { type: "string" },
                sourceFacts: { type: "array", items: { type: "string" } },
                sourceEvidence: { type: "array", maxItems: 20, items: { type: "object" } },
                seo: { type: "object", additionalProperties: true },
              },
              required: ["category", "contentType", "audience", "title", "summary"],
            },
          },
          {
            name: "content.proposals",
            description: "事業者自身の企画案を検索・ページング付きで一覧取得します。",
            inputSchema: {
              type: "object",
              properties: {
                search: { type: "string", maxLength: 200 },
                audience: { type: "string", enum: [...contentAudiences] },
                contentType: { type: "string", enum: [...contentTypes] },
                sort: { type: "string", enum: [...proposalSortValues] },
                limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
                cursor: { type: "integer", minimum: 0, default: 0 },
              },
            },
          },
          {
            name: "content.list",
            description: "事業者自身の企画案とコンテンツを検索・ページング付きで一覧取得します。",
            inputSchema: {
              type: "object",
              properties: {
                search: { type: "string", maxLength: 200 },
                status: { type: "string", enum: [...contentWorkflowStatuses] },
                audience: { type: "string", enum: [...contentAudiences] },
                contentType: { type: "string", enum: [...contentTypes] },
                locale: { type: "string", enum: [...contentLocales] },
                tags: { type: "array", maxItems: 30, items: { type: "string" } },
                series: { type: "string", maxLength: 120 },
                featured: { type: "boolean" },
                sort: { type: "string", enum: [...contentSortValues] },
                visibility: { type: "string", enum: [...contentVisibilityValues] },
                limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
                cursor: { type: "integer", minimum: 0, default: 0 },
              },
            },
          },
          {
            name: "content.get",
            description: "事業者自身のコンテンツを1件取得します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.editorial_actions",
            description: "公開済みコンテンツの訂正・撤回履歴を取得します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" } }, required: ["contentId"] },
          },
          {
            name: "content.correction",
            description: "公開済みコンテンツを上書きせず、訂正前後の本文・ブロック・構造化データ・出典を履歴へ記録します。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" }, reason: { type: "string", minLength: 3, maxLength: 1000 }, body: { type: "string" }, blocks: { type: "array", maxItems: 100, items: { type: "object" } }, structuredData: { type: "object", additionalProperties: true }, sourceEvidence: { type: "array", maxItems: 20, items: { type: "object" } } },
              required: ["contentId", "reason"],
            },
          },
          {
            name: "content.withdrawal",
            description: "公開済みコンテンツを削除せず、撤回理由を履歴へ記録して公開を停止します。",
            inputSchema: { type: "object", properties: { contentId: { type: "string" }, reason: { type: "string", minLength: 3, maxLength: 1000 } }, required: ["contentId", "reason"] },
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
                blocks: { type: "array", maxItems: 100, items: { type: "object" } },
                structuredData: { type: "object", additionalProperties: true },
                mediaIds: { type: "array", maxItems: 20, items: { type: "string" } },
                sourceFacts: { type: "array", items: { type: "string" } },
                sourceEvidence: { type: "array", maxItems: 20, items: { type: "object" } },
                visibility: { enum: [...contentVisibilityValues] },
                tags: { type: "array", maxItems: 30, items: { type: "string" } },
                series: { type: "string" },
                authors: { type: "array", maxItems: 10, items: { type: "object", required: ["name"], additionalProperties: true } },
                featured: { type: "boolean" },
                expiresAt: { type: "string" },
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
            description: "事業者の予約公開を実行します。運営キーを付けた外部Cronから呼び出すと、全カテゴリの期限到来分を実行します。",
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

    if (name === "auth.login_options") {
      const result = { items: portal.listLoginOptions() };
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

    if (name === "category.summary") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.getSummary(argumentsObject.category, principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "category.get") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = { item: portal.getCategoryContext(argumentsObject.category, principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "portal.plan") {
      const result = await portalPlanning.create(principal, parsePortalPlanCreateInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "portal.plan.list") {
      const result = portalPlanning.list(principal, parsePaginationArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "portal.plan.get") {
      if (typeof argumentsObject.planId !== "string") throw new Error("planIdが必要です。");
      const result = { item: portalPlanning.get(principal, argumentsObject.planId) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "portal.plan.apply") {
      if (typeof argumentsObject.planId !== "string") throw new Error("planIdが必要です。");
      const result = await portalPlanning.apply(principal, argumentsObject.planId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "portal.plan.draft") {
      if (typeof argumentsObject.planId !== "string") throw new Error("planIdが必要です。");
      const result = await portalPlanning.draft(principal, argumentsObject.planId);
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

    if (name === "provider.compare") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      if (!Array.isArray(argumentsObject.providerIds) || argumentsObject.providerIds.some((providerId) => typeof providerId !== "string")) {
        throw new Error("providerIdsは文字列配列で指定してください。");
      }
      const result = portal.compareProviders(argumentsObject.category, principal, argumentsObject.providerIds as string[]);
      const payload = { items: result };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(payload)], structuredContent: payload } });
      return;
    }

    if (name === "favorite.list") {
      const result = portal.listFavorites(principal, parsePaginationArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "favorite.add") {
      if (typeof argumentsObject.providerId !== "string" || !argumentsObject.providerId.trim()) throw new Error("providerIdが必要です。");
      const result = portal.createFavorite(principal, argumentsObject.providerId.trim());
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "favorite.remove") {
      if (typeof argumentsObject.favoriteId !== "string" || !argumentsObject.favoriteId.trim()) throw new Error("favoriteIdが必要です。");
      const result = portal.deleteFavorite(principal, argumentsObject.favoriteId.trim());
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

    if (name === "booking.create") {
      if (!isCategorySlug(argumentsObject.category) || typeof argumentsObject.providerId !== "string" || typeof argumentsObject.menu !== "string" || typeof argumentsObject.requestedFor !== "string" || (argumentsObject.note !== undefined && typeof argumentsObject.note !== "string")) {
        throw new Error("category、providerId、menu、requestedFor、noteを正しく指定してください。");
      }
      const result = portal.createBooking(principal, {
        category: argumentsObject.category,
        providerId: argumentsObject.providerId,
        menu: argumentsObject.menu,
        requestedFor: argumentsObject.requestedFor,
        note: typeof argumentsObject.note === "string" ? argumentsObject.note : undefined,
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "booking.list") {
      const result = portal.listBookingsPage(principal, parsePaginationArguments(argumentsObject), {
        status: parseOptionalEnumValue(argumentsObject.status, "status", bookingStatusValues),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "booking.update_status") {
      if (typeof argumentsObject.bookingId !== "string" || !isBookingStatus(argumentsObject.status)) {
        throw new Error("bookingIdと有効なstatusが必要です。");
      }
      const result = portal.updateBookingStatus(principal, argumentsObject.bookingId, argumentsObject.status);
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

    if (name === "job.get") {
      if (typeof argumentsObject.jobId !== "string") throw new Error("jobIdが必要です。");
      const result = portal.getJob(principal, argumentsObject.jobId);
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

    if (name === "webhook.list") {
      const result = { items: webhook.listSubscriptions(principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.create") {
      const result = webhook.createSubscription(principal, parseWebhookCreateInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.update") {
      if (typeof argumentsObject.subscriptionId !== "string") throw new Error("subscriptionIdを指定してください。");
      const result = webhook.updateSubscription(principal, argumentsObject.subscriptionId, parseWebhookUpdateInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.revoke") {
      if (typeof argumentsObject.subscriptionId !== "string") throw new Error("subscriptionIdを指定してください。");
      const result = webhook.revokeSubscription(principal, argumentsObject.subscriptionId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.deliveries") {
      const status = parseOptionalEnumValue(argumentsObject.status, "status", webhookDeliveryStatuses);
      const eventType = parseOptionalEnumValue(argumentsObject.eventType, "eventType", webhookEventTypes);
      const sort = parseOptionalEnumValue(argumentsObject.sort, "sort", webhookDeliverySortValues);
      const result = webhook.listDeliveries(principal, {
        ...(status ? { status } : {}),
        ...(eventType ? { eventType } : {}),
        ...(sort ? { sort } : {}),
      }, parsePaginationArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.retry") {
      if (typeof argumentsObject.deliveryId !== "string") throw new Error("deliveryIdを指定してください。");
      const result = webhook.retryDelivery(principal, argumentsObject.deliveryId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.deliver") {
      if (typeof argumentsObject.deliveryId !== "string") throw new Error("deliveryIdを指定してください。");
      const result = await webhook.deliverDelivery(principal, argumentsObject.deliveryId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "webhook.deliver_pending") {
      const limit = argumentsObject.limit === undefined ? 10 : argumentsObject.limit;
      if (typeof limit !== "number") throw new Error("limitは整数で指定してください。");
      const result = await webhook.deliverPending(principal, limit);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: { items: result } } });
      return;
    }

    if (name === "operation.submit") {
      const idempotencyKey = typeof argumentsObject.idempotencyKey === "string" ? argumentsObject.idempotencyKey : undefined;
      const result = operation.submit(principal, parseOperationSubmitInput(argumentsObject), idempotencyKey);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "operation.list") {
      const limit = argumentsObject.limit === undefined ? undefined : argumentsObject.limit;
      const cursor = argumentsObject.cursor === undefined ? undefined : argumentsObject.cursor;
      if (limit !== undefined && typeof limit !== "number") throw new Error("limitは整数で指定してください。");
      if (cursor !== undefined && typeof cursor !== "number") throw new Error("cursorは整数で指定してください。");
      const result = operation.list(principal, { ...(limit !== undefined ? { limit } : {}), ...(cursor !== undefined ? { cursor } : {}) });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "operation.get") {
      if (typeof argumentsObject.operationId !== "string") throw new Error("operationIdを指定してください。");
      const result = operation.get(principal, argumentsObject.operationId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "operation.execute") {
      if (typeof argumentsObject.operationId !== "string") throw new Error("operationIdを指定してください。");
      const result = await operation.execute(principal, argumentsObject.operationId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "operation.execute_pending") {
      const limit = argumentsObject.limit === undefined ? 10 : argumentsObject.limit;
      if (typeof limit !== "number") throw new Error("limitは整数で指定してください。");
      const result = await operation.executePending(principal, limit);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: { items: result } } });
      return;
    }

    if (name === "content.propose") {
      if (!isCategorySlug(argumentsObject.category) || !isContentType(argumentsObject.contentType) || !isContentAudience(argumentsObject.audience) || typeof argumentsObject.topic !== "string") {
        throw new Error("category、contentType、audience、topicが必要です。");
      }
      const result = await content.createProposal(principal, {
        category: argumentsObject.category,
        contentType: argumentsObject.contentType,
        audience: argumentsObject.audience,
        mediaIds: parseOptionalStringArray(argumentsObject.mediaIds, "mediaIds"),
        topic: argumentsObject.topic,
        primaryKeyword: typeof argumentsObject.primaryKeyword === "string" ? argumentsObject.primaryKeyword : undefined,
        relatedKeywords: parseOptionalStringArray(argumentsObject.relatedKeywords, "relatedKeywords"),
        sourceFacts: parseOptionalStringArray(argumentsObject.sourceFacts, "sourceFacts"),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.create") {
      const result = content.createContent(principal, parseContentCreateInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.proposals") {
      const result = content.listProposalsPage(principal, parseProposalListQueryFromArguments(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.list") {
      const result = {
        proposals: content.listProposals(principal),
        ...content.listContentPage(principal, parseContentListQueryFromArguments(argumentsObject)),
      };
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

    if (name === "content.editorial_actions") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = { items: content.listEditorialActions(principal, argumentsObject.contentId) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.correction") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.recordCorrection(principal, argumentsObject.contentId, parseContentCorrectionInput(argumentsObject));
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.withdrawal") {
      if (typeof argumentsObject.contentId !== "string" || typeof argumentsObject.reason !== "string") throw new Error("contentIdとreasonが必要です。");
      const result = content.withdrawContent(principal, argumentsObject.contentId, argumentsObject.reason);
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
      const result = await content.createDraft(principal, argumentsObject.proposalId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.update") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      if (argumentsObject.blocks !== undefined && !Array.isArray(argumentsObject.blocks)) throw new Error("blocksは配列で指定してください。");
      const seo = parseContentSeoPatch(argumentsObject.seo);
      const mediaIds = parseOptionalStringArray(argumentsObject.mediaIds, "mediaIds");
      const sourceFacts = parseOptionalStringArray(argumentsObject.sourceFacts, "sourceFacts");
      const sourceEvidence = parseOptionalSourceEvidence(argumentsObject.sourceEvidence);
      const result = content.updateContent(principal, argumentsObject.contentId, {
        ...(typeof argumentsObject.title === "string" ? { title: argumentsObject.title } : {}),
        ...(typeof argumentsObject.summary === "string" ? { summary: argumentsObject.summary } : {}),
        ...(typeof argumentsObject.body === "string" ? { body: argumentsObject.body } : {}),
        ...(Array.isArray(argumentsObject.blocks) ? { blocks: argumentsObject.blocks as ContentCreateInput["blocks"] } : {}),
        ...(argumentsObject.structuredData !== undefined ? { structuredData: argumentsObject.structuredData as ContentCreateInput["structuredData"] } : {}),
        ...(sourceEvidence ? { sourceEvidence } : {}),
        ...(seo ? { seo } : {}),
        ...(mediaIds ? { mediaIds } : {}),
        ...(sourceFacts ? { sourceFacts } : {}),
        ...parseContentMetadataPatch(argumentsObject),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.translate") {
      if (typeof argumentsObject.contentId !== "string" || !isContentLocale(argumentsObject.targetLocale)) {
        throw new Error("contentIdとtargetLocaleを正しく指定してください。");
      }
      const seo = parseContentSeoPatch(argumentsObject.seo);
      const result = await content.translateContent(principal, argumentsObject.contentId, {
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
      const result = await content.polishContent(principal, argumentsObject.contentId, typeof argumentsObject.instructions === "string" ? argumentsObject.instructions : undefined);
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
      const result = hasOperatorKey(request)
        ? await publication.executeSchedulesAsOperator(typeof argumentsObject.before === "string" ? argumentsObject.before : undefined)
        : await publication.executeSchedules(principal, typeof argumentsObject.before === "string" ? argumentsObject.before : undefined);
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
  content?: ContentService,
  publication?: PublicationService,
  media?: MediaService,
  webhook = new WebhookService(portal),
  operation?: OperationService,
  portalPlanning?: PortalPlanningService,
): Server {
  media ??= new MediaService(portal, undefined, webhook);
  content ??= new ContentService(portal, undefined, webhook, undefined, media);
  publication ??= new PublicationService(portal, content, undefined, undefined, undefined, webhook, media);
  operation ??= new OperationService(portal, content);
  portalPlanning ??= new PortalPlanningService(portal, undefined, undefined, content);
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

      if (request.method === "GET" && url.pathname === "/api/v1/auth/login-options") {
        writeJson(response, 200, { items: portal.listLoginOptions() });
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

      const summaryMatch = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)\/summary$/);
      if (request.method === "GET" && summaryMatch) {
        const category = summaryMatch[1];
        if (!isCategorySlug(category)) {
          writeJson(response, 404, { error: "カテゴリが見つかりません。" });
          return;
        }
        writeJson(response, 200, { summary: portal.getSummary(category, principal) });
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

      if (request.method === "POST" && url.pathname === "/api/v1/portal-plans") {
        try {
          const body = await readJson(request);
          writeJson(response, 201, { item: await portalPlanning.create(principal, parsePortalPlanCreateInput(body)) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "ポータル計画を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/portal-plans") {
        try {
          writeJson(response, 200, portalPlanning.list(principal, parsePaginationQuery(url)));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "ポータル計画を取得できません。" });
        }
        return;
      }

      const portalPlanMatch = url.pathname.match(/^\/api\/v1\/portal-plans\/([^/]+)$/);
      const portalPlanApplyMatch = url.pathname.match(/^\/api\/v1\/portal-plans\/([^/]+)\/apply$/);
      const portalPlanDraftMatch = url.pathname.match(/^\/api\/v1\/portal-plans\/([^/]+)\/draft$/);
      if (request.method === "POST" && portalPlanApplyMatch) {
        const planId = portalPlanApplyMatch[1];
        if (!planId) {
          writeJson(response, 400, { error: "planIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 201, await portalPlanning.apply(principal, planId));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "ポータル計画を企画案へ反映できません。" });
        }
        return;
      }
      if (request.method === "POST" && portalPlanDraftMatch) {
        const planId = portalPlanDraftMatch[1];
        if (!planId) {
          writeJson(response, 400, { error: "planIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 201, await portalPlanning.draft(principal, planId));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "ポータル計画から下書きを作成できません。" });
        }
        return;
      }
      if (request.method === "GET" && portalPlanMatch) {
        const planId = portalPlanMatch[1];
        if (!planId) {
          writeJson(response, 400, { error: "planIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portalPlanning.get(principal, planId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "ポータル計画を取得できません。" });
        }
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

      if (request.method === "GET" && url.pathname === "/api/v1/providers/compare") {
        const category = url.searchParams.get("category");
        if (!isCategorySlug(category)) {
          writeJson(response, 400, { error: "categoryが有効なカテゴリである必要があります。" });
          return;
        }
        const providerIds = (url.searchParams.get("ids") ?? "").split(",").map((providerId) => providerId.trim()).filter(Boolean);
        try {
          writeJson(response, 200, { items: portal.compareProviders(category, principal, providerIds) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "事業者を比較できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/favorites") {
        try {
          writeJson(response, 200, portal.listFavorites(principal, parsePaginationQuery(url)));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "お気に入りを取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/favorites") {
        const body = await readJson(request);
        if (typeof body.providerId !== "string" || !body.providerId.trim()) {
          writeJson(response, 400, { error: "providerIdが必要です。" });
          return;
        }
        try {
          const result = portal.createFavorite(principal, body.providerId.trim());
          writeJson(response, result.created ? 201 : 200, result);
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "お気に入りを登録できません。" });
        }
        return;
      }

      const favoriteMatch = url.pathname.match(/^\/api\/v1\/favorites\/([^/]+)$/);
      if (request.method === "DELETE" && favoriteMatch) {
        const favoriteId = favoriteMatch[1];
        if (!favoriteId) {
          writeJson(response, 400, { error: "favoriteIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, portal.deleteFavorite(principal, favoriteId));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "お気に入りを削除できません。" });
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

      if (request.method === "GET" && url.pathname === "/api/v1/webhooks") {
        try {
          writeJson(response, 200, { items: webhook.listSubscriptions(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Webhook購読を取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/webhooks") {
        try {
          const result = webhook.createSubscription(principal, parseWebhookCreateInput(await readJson(request)));
          writeJson(response, 201, { item: result.subscription, secret: result.secret });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Webhook購読を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/webhooks/deliveries") {
        try {
          const status = parseOptionalEnumValue(url.searchParams.get("status"), "status", webhookDeliveryStatuses);
          const eventType = parseOptionalEnumValue(url.searchParams.get("eventType"), "eventType", webhookEventTypes);
          const sort = parseOptionalEnumValue(url.searchParams.get("sort"), "sort", webhookDeliverySortValues);
          writeJson(response, 200, {
            ...webhook.listDeliveries(principal, {
              ...(status ? { status } : {}),
              ...(eventType ? { eventType } : {}),
              ...(sort ? { sort } : {}),
            }, parsePaginationQuery(url)),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Webhook配信を取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/webhooks/deliveries/deliver-pending") {
        try {
          const body = await readJson(request);
          const limit = body.limit === undefined ? 10 : body.limit;
          if (typeof limit !== "number") throw new Error("limitは整数で指定してください。");
          writeJson(response, 200, { items: await webhook.deliverPending(principal, limit) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Webhook配信に失敗しました。" });
        }
        return;
      }

      const webhookDeliveryActionMatch = url.pathname.match(/^\/api\/v1\/webhooks\/deliveries\/([^/]+)\/(retry|deliver)$/);
      if (request.method === "POST" && webhookDeliveryActionMatch) {
        const deliveryId = webhookDeliveryActionMatch[1];
        const action = webhookDeliveryActionMatch[2];
        if (!deliveryId) {
          writeJson(response, 400, { error: "deliveryIdを指定してください。" });
          return;
        }
        try {
          const item = action === "retry" ? webhook.retryDelivery(principal, deliveryId) : await webhook.deliverDelivery(principal, deliveryId);
          writeJson(response, 200, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Webhook配信を操作できません。" });
        }
        return;
      }

      const webhookSubscriptionMatch = url.pathname.match(/^\/api\/v1\/webhooks\/([^/]+)$/);
      if (webhookSubscriptionMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        const subscriptionId = webhookSubscriptionMatch[1];
        if (!subscriptionId) {
          writeJson(response, 400, { error: "subscriptionIdを指定してください。" });
          return;
        }
        try {
          const item = request.method === "DELETE"
            ? webhook.revokeSubscription(principal, subscriptionId)
            : webhook.updateSubscription(principal, subscriptionId, parseWebhookUpdateInput(await readJson(request)));
          writeJson(response, 200, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "Webhook購読を操作できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/operations") {
        try {
          const body = await readJson(request);
          const rawIdempotencyKey = request.headers["idempotency-key"];
          const idempotencyKey = typeof rawIdempotencyKey === "string" ? rawIdempotencyKey : undefined;
          const item = operation.submit(principal, parseOperationSubmitInput(body), idempotencyKey);
          writeJson(response, 202, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "非同期ジョブを投入できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/operations") {
        try {
          writeJson(response, 200, operation.list(principal, parsePaginationQuery(url)));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "非同期ジョブを取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/operations/execute-pending") {
        try {
          const body = await readJson(request);
          const limit = body.limit === undefined ? 10 : body.limit;
          if (typeof limit !== "number") throw new Error("limitは整数で指定してください。");
          writeJson(response, 200, { items: await operation.executePending(principal, limit) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "非同期ジョブを実行できません。" });
        }
        return;
      }

      const operationActionMatch = url.pathname.match(/^\/api\/v1\/operations\/([^/]+)\/(execute)$/);
      if (request.method === "POST" && operationActionMatch) {
        const operationId = operationActionMatch[1];
        if (!operationId) {
          writeJson(response, 400, { error: "operationIdを指定してください。" });
          return;
        }
        try {
          writeJson(response, 200, { item: await operation.execute(principal, operationId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "非同期ジョブを実行できません。" });
        }
        return;
      }

      const operationMatch = url.pathname.match(/^\/api\/v1\/operations\/([^/]+)$/);
      if (request.method === "GET" && operationMatch) {
        const operationId = operationMatch[1];
        if (!operationId) {
          writeJson(response, 400, { error: "operationIdを指定してください。" });
          return;
        }
        try {
          writeJson(response, 200, { item: operation.get(principal, operationId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "非同期ジョブを取得できません。" });
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
          const item = await content.createProposal(principal, {
            category: body.category,
            contentType: body.contentType,
            audience: body.audience,
            mediaIds: parseOptionalStringArray(body.mediaIds, "mediaIds"),
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
          writeJson(response, 200, content.listProposalsPage(principal, parseProposalListQueryFromUrl(url)));
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
          writeJson(response, 201, { item: await content.createDraft(principal, body.proposalId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "下書きを作成できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/content") {
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isContentType(body.contentType) || !isContentAudience(body.audience) || typeof body.title !== "string" || typeof body.summary !== "string" || (body.body !== undefined && typeof body.body !== "string") || (body.body === undefined && !Array.isArray(body.blocks))) {
          writeJson(response, 400, { error: "category、contentType、audience、title、summary、およびbodyまたはblocksが必要です。" });
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
          const item = content.createContent(principal, parseContentCreateInput(body));
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/content") {
        try {
          writeJson(response, 200, content.listContentPage(principal, parseContentListQueryFromUrl(url)));
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを取得できません。" });
        }
        return;
      }

      const editorialActionsMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/editorial-actions$/);
      if (request.method === "GET" && editorialActionsMatch) {
        const contentId = editorialActionsMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { items: content.listEditorialActions(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "訂正・撤回履歴を取得できません。" });
        }
        return;
      }

      const correctionMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/correction$/);
      if (request.method === "POST" && correctionMatch) {
        const contentId = correctionMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          const body = await readJson(request);
          writeJson(response, 201, { item: content.recordCorrection(principal, contentId, parseContentCorrectionInput(body)) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "訂正履歴を登録できません。" });
        }
        return;
      }

      const withdrawalMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/withdrawal$/);
      if (request.method === "POST" && withdrawalMatch) {
        const contentId = withdrawalMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          const body = await readJson(request);
          if (typeof body.reason !== "string") throw new ContentServiceError(400, "reasonが必要です。");
          writeJson(response, 200, { item: content.withdrawContent(principal, contentId, body.reason) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "撤回履歴を登録できません。" });
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
              item: await content.translateContent(principal, contentId, {
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
            writeJson(response, 200, { item: await content.polishContent(principal, contentId, typeof body.instructions === "string" ? body.instructions : undefined) });
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
          const items = hasOperatorKey(request)
            ? await publication.executeSchedulesAsOperator(typeof body.before === "string" ? body.before : undefined)
            : await publication.executeSchedules(principal, typeof body.before === "string" ? body.before : undefined);
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
        if (body.blocks !== undefined && !Array.isArray(body.blocks)) {
          writeJson(response, 400, { error: "blocksは配列で指定してください。" });
          return;
        }
        try {
          const seo = parseContentSeoPatch(body.seo);
          const mediaIds = parseOptionalStringArray(body.mediaIds, "mediaIds");
          const sourceFacts = parseOptionalStringArray(body.sourceFacts, "sourceFacts");
          const sourceEvidence = parseOptionalSourceEvidence(body.sourceEvidence);
          writeJson(response, 200, {
            item: content.updateContent(principal, contentId, {
              ...(typeof body.title === "string" ? { title: body.title } : {}),
              ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
              ...(typeof body.body === "string" ? { body: body.body } : {}),
              ...(Array.isArray(body.blocks) ? { blocks: body.blocks as ContentCreateInput["blocks"] } : {}),
              ...(body.structuredData !== undefined ? { structuredData: body.structuredData as ContentCreateInput["structuredData"] } : {}),
              ...(sourceEvidence ? { sourceEvidence } : {}),
              ...(mediaIds ? { mediaIds } : {}),
              ...(seo ? { seo } : {}),
              ...(sourceFacts ? { sourceFacts } : {}),
              ...parseContentMetadataPatch(body),
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

      if (request.method === "POST" && url.pathname === "/api/v1/bookings") {
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || typeof body.providerId !== "string" || typeof body.menu !== "string" || typeof body.requestedFor !== "string" || (body.note !== undefined && typeof body.note !== "string")) {
          writeJson(response, 400, { error: "category、providerId、menu、requestedFor、noteを正しく指定してください。" });
          return;
        }
        try {
          writeJson(response, 201, {
            item: portal.createBooking(principal, {
              category: body.category,
              providerId: body.providerId,
              menu: body.menu,
              requestedFor: body.requestedFor,
              note: typeof body.note === "string" ? body.note : undefined,
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約リクエストを作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/bookings") {
        try {
          writeJson(response, 200, {
            ...portal.listBookingsPage(principal, parsePaginationQuery(url), {
              status: parseOptionalEnumValue(url.searchParams.get("status"), "status", bookingStatusValues),
            }),
          });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約リクエストを取得できません。" });
        }
        return;
      }

      const bookingMatch = url.pathname.match(/^\/api\/v1\/bookings\/([^/]+)$/);
      if (request.method === "PATCH" && bookingMatch) {
        const bookingId = bookingMatch[1];
        if (!bookingId) {
          writeJson(response, 400, { error: "bookingIdが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isBookingStatus(body.status)) {
          writeJson(response, 400, { error: "statusが不正です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.updateBookingStatus(principal, bookingId, body.status) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "予約リクエストの状態を更新できません。" });
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
      if (request.method === "GET" && jobMatch) {
        const jobId = jobMatch[1];
        if (!jobId) {
          writeJson(response, 400, { error: "jobIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: portal.getJob(principal, jobId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "求人を取得できません。" });
        }
        return;
      }
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
        await handleMcp(request, response, auth, portal, content, publication, media, webhook, operation, portalPlanning, authRateLimiter);
        return;
      }

      writeJson(response, 404, { error: "エンドポイントが見つかりません。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "サーバーエラーが発生しました。";
      writeJson(response, 400, { error: message });
    }
  });
}
