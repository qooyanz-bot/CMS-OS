export const portalRoles = ["user", "orderer", "provider", "candidate", "recruiter"] as const;
export const categorySlugs = [
  "legal",
  "beauty",
  "ai-business",
  "labor-shortage",
  "tourism",
  "mobility-dx",
  "gx",
  "regional-revitalization",
] as const;
/** UIと認証応答で提示する正規の切り替えロール。candidateは互換入力としてのみ受け付ける。 */
export const contextRoles = ["user", "orderer", "provider", "recruiter"] as const;

export type PortalRole = (typeof portalRoles)[number];
export type CategorySlug = (typeof categorySlugs)[number];
export type ContextRole = (typeof contextRoles)[number];

/** 求職者向けの公開ロール。candidateは既存クライアント互換の別名として扱う。 */
export function isRecruiterRole(role: PortalRole): boolean {
  return role === "candidate" || role === "recruiter";
}

export const directoryGuideKinds = ["directory", "booking", "provider_resource"] as const;
export type DirectoryGuideKind = (typeof directoryGuideKinds)[number];

export interface DirectoryGuide {
  id: string;
  category: CategorySlug;
  name: string;
  kind: DirectoryGuideKind;
  description: string;
  url: string;
  targetRoles: PortalRole[];
  verifiedAt: string;
}

export interface RoleAssignment {
  role: PortalRole;
  category: CategorySlug | "*";
  organizationId?: string;
}

/** 公開ログインロールとは分離した、CMS編集・承認・公開の内部ロールです。 */
export const contentInternalRoles = ["enterprise_admin", "tenant_admin", "editor", "hr", "pr", "ir", "legal_reviewer", "approver", "publisher", "partner_editor", "partner_viewer"] as const;
export type ContentInternalRole = (typeof contentInternalRoles)[number];

export interface ContentInternalRoleAssignment {
  role: ContentInternalRole;
  category: CategorySlug | "*";
  providerId?: string;
  organizationId?: string;
}

export interface AuthContextOption {
  category: CategorySlug;
  roles: ContextRole[];
}

export interface Account {
  id: string;
  email: string;
  passwordHash?: string;
  displayName: string;
  assignments: RoleAssignment[];
  internalRoleAssignments?: ContentInternalRoleAssignment[];
  providerId?: string;
  oidcIssuer?: string;
  oidcSubject?: string;
  mfaEnabled?: boolean;
  mfaSecretCiphertext?: string;
}

export interface AuthenticatedPrincipal {
  accountId: string;
  email: string;
  displayName: string;
  category: CategorySlug;
  role: PortalRole;
  availableContexts: AuthContextOption[];
  internalRoleAssignments?: ContentInternalRoleAssignment[];
  providerId?: string;
}

export interface CategoryModule {
  id: string;
  label: string;
}

export interface CategoryExperience {
  category: CategorySlug;
  categoryLabel: string;
  role: PortalRole;
  authenticated: boolean;
  navigation: CategoryModule[];
  visibleModules: string[];
  visibleFields: string[];
  allowedActions: string[];
  notices: string[];
}

/** ログイン後にカテゴリ・ロール別で表示するポータルの集計値です。内部IDや個人情報は含めません。 */
export interface PortalSummaryMetric {
  id: string;
  label: string;
  value: number;
  module: string;
  description: string;
}

/** サマリーから直接移動できる、現在のロール向けの次アクションです。 */
export interface PortalSummaryAction {
  id: string;
  label: string;
  module: string;
  action: string;
  reason: string;
}

/** カテゴリとロールで表示対象を切り替えたポータルの状態サマリーです。 */
export interface PortalSummary {
  category: CategorySlug;
  categoryLabel: string;
  role: PortalRole;
  authenticated: boolean;
  metrics: PortalSummaryMetric[];
  nextActions: PortalSummaryAction[];
}

export interface PortalCategoryContext {
  slug: CategorySlug;
  label: string;
  navigation: CategoryModule[];
  themeOptions: string[];
  experience: CategoryExperience;
  directoryGuides: DirectoryGuide[];
}

/** ログイン前にカテゴリごとの表示対象を選択するためのロール定義です。 */
export interface CategoryLoginRoleOption {
  role: ContextRole;
  label: string;
  audience: string;
  visibleModules: string[];
  navigation: CategoryModule[];
}

/** ログイン画面とAIエージェントが利用するカテゴリ別ログイン候補です。 */
export interface CategoryLoginOption {
  category: CategorySlug;
  categoryLabel: string;
  roles: CategoryLoginRoleOption[];
}

export interface ProviderRecord {
  id: string;
  category: CategorySlug;
  name: string;
  themes: string[];
  location: string;
  listingStatus?: ProviderListingStatus;
  listingSubmittedAt?: string;
  listingReviewedAt?: string;
  listingReviewNote?: string;
  publicFields: Record<string, string | string[]>;
  ordererFields: Record<string, string | string[]>;
  providerFields: Record<string, string | string[]>;
  candidateFields: Record<string, string | string[]>;
}

export interface VisibleProvider extends Record<string, unknown> {
  id: string;
  category: CategorySlug;
  name: string;
  themes: string[];
  location: string;
}

/** アカウントごとに保存する、カテゴリ内の公開事業者へのお気に入り登録。 */
export interface ProviderFavorite {
  id: string;
  accountId: string;
  category: CategorySlug;
  providerId: string;
  createdAt: string;
}

export interface VisibleProviderFavorite {
  id: string;
  category: CategorySlug;
  providerId: string;
  provider: VisibleProvider;
  createdAt: string;
}

export const mediaTypes = ["image", "video", "pdf"] as const;
export type MediaType = (typeof mediaTypes)[number];

export const mediaStatuses = ["draft", "published", "archived"] as const;
export type MediaStatus = (typeof mediaStatuses)[number];

export const mediaRightsStatuses = ["unknown", "owned", "licensed", "expired"] as const;
export type MediaRightsStatus = (typeof mediaRightsStatuses)[number];

export interface MediaTransformSpec {
  format?: string;
  width?: number;
  height?: number;
  quality?: number;
}

export type MediaSeoIssueSeverity = "error" | "warning" | "info";

export interface MediaSeoAuditIssue {
  code: string;
  severity: MediaSeoIssueSeverity;
  field: string;
  message: string;
  recommendation: string;
}

export interface MediaSeoAuditResult {
  assetId: string;
  category: CategorySlug;
  providerId: string;
  score: number;
  issues: MediaSeoAuditIssue[];
  auditedAt: string;
}

export interface MediaSiteSeoAuditResult {
  category: CategorySlug;
  providerId: string;
  assetCount: number;
  score: number;
  issues: Array<MediaSeoAuditIssue & { assetId?: string }>;
  auditedAt: string;
}

export const webhookEventTypes = [
  "content.created",
  "content.updated",
  "content.archived",
  "content.published",
  "media.created",
  "media.updated",
  "media.archived",
  "media.seo_audited",
  "publication.published",
  "publication.unpublished",
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

export const webhookSubscriptionStatuses = ["active", "paused", "revoked"] as const;
export type WebhookSubscriptionStatus = (typeof webhookSubscriptionStatuses)[number];

export const webhookDeliveryStatuses = ["pending", "retrying", "delivered", "failed"] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number];

export interface WebhookSubscription {
  id: string;
  category: CategorySlug;
  providerId: string;
  endpointUrl: string;
  events: WebhookEventType[];
  description?: string;
  secretHint: string;
  status: WebhookSubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  category: CategorySlug;
  providerId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  signature: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus?: number;
  error?: string;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  category: CategorySlug;
  providerId: string;
  name: string;
  storageKey: string;
  publicUrl?: string;
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  altText: string;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  tags: string[];
  rightsStatus: MediaRightsStatus;
  rightsHolder?: string;
  licenseExpiresAt?: string;
  status: MediaStatus;
  derivedFromAssetId?: string;
  transform?: MediaTransformSpec;
  lastSeoAudit?: MediaSeoAuditResult;
  createdAt: string;
  updatedAt: string;
}

export const providerListingStatuses = ["draft", "pending_review", "published", "suspended"] as const;
export type ProviderListingStatus = (typeof providerListingStatuses)[number];

export const requestStatuses = ["submitted", "accepted", "closed"] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export const bookingStatuses = ["requested", "confirmed", "cancelled"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];
export const jobStatuses = ["published", "closed"] as const;
export type JobStatus = (typeof jobStatuses)[number];
export const applicationStatuses = ["submitted", "screening", "closed"] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

export interface ServiceRequest {
  id: string;
  category: CategorySlug;
  ordererId: string;
  providerId: string;
  title: string;
  description: string;
  status: RequestStatus;
  createdAt: string;
}

/** 内部保存用の予約リクエストです。ordererIdはAPIレスポンスへ直接返しません。 */
export interface ServiceBooking {
  id: string;
  category: CategorySlug;
  ordererId: string;
  providerId: string;
  menu: string;
  requestedFor: string;
  note: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

/** ロール投影後の予約リクエストです。 */
export interface VisibleBooking {
  id: string;
  category: CategorySlug;
  providerId: string;
  menu: string;
  requestedFor: string;
  note: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobPosting {
  id: string;
  category: CategorySlug;
  providerId: string;
  /** リクルーター・静的公開ページへ投影する公開事業者名。内部IDとは別管理です。 */
  providerName?: string;
  title: string;
  employmentType: string;
  location: string;
  description: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplication {
  id: string;
  category: CategorySlug;
  jobId: string;
  providerId: string;
  candidateId: string;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
}

export const inquiryStatuses = ["open", "responded", "closed"] as const;
export type InquiryStatus = (typeof inquiryStatuses)[number];

export interface ProviderInquiry {
  id: string;
  category: CategorySlug;
  providerId: string;
  senderId: string;
  subject: string;
  message: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
}

export type NotificationRecipientType = "account" | "provider";
export type NotificationType = "inquiry_received" | "inquiry_status_changed" | "request_received" | "request_status_changed" | "booking_received" | "booking_status_changed" | "application_received" | "application_status_changed" | "listing_submitted" | "listing_reviewed";

export interface PortalNotification {
  id: string;
  category: CategorySlug;
  recipientType: NotificationRecipientType;
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  resourceType: "inquiry" | "request" | "booking" | "application" | "provider_listing";
  resourceId: string;
  createdAt: string;
  readAt?: string;
}

export interface ProviderListingReviewItem {
  id: string;
  category: CategorySlug;
  name: string;
  themes: string[];
  location: string;
  listingStatus: ProviderListingStatus;
  listingSubmittedAt?: string;
  listingReviewedAt?: string;
  listingReviewNote?: string;
  publicFields: Record<string, string | string[]>;
}

export const contentTypes = ["company", "blog", "job", "pr", "ir"] as const;
export type ContentType = (typeof contentTypes)[number];

export const contentAudiences = ["customer", "candidate", "media", "investor", "beginner", "existingCustomer"] as const;
export type ContentAudience = (typeof contentAudiences)[number];

export const portalPlanGoals = ["discovery", "conversion", "recruiting", "regional"] as const;
export type PortalPlanGoal = (typeof portalPlanGoals)[number];

export const portalPlanIntentKinds = ["informational", "commercial", "transactional", "local", "recruiting"] as const;
export type PortalPlanIntentKind = (typeof portalPlanIntentKinds)[number];

export const portalPlanPageTypes = ["hub", "theme", "region", "provider_directory", "faq", "jobs", "request"] as const;
export type PortalPlanPageType = (typeof portalPlanPageTypes)[number];

export interface PortalPlanSearchIntent {
  kind: PortalPlanIntentKind;
  label: string;
  query: string;
  readerNeed: string;
  recommendedPageId: string;
}

export interface PortalPlanPageIdea {
  id: string;
  pageType: PortalPlanPageType;
  path: string;
  title: string;
  purpose: string;
  primaryKeyword: string;
  internalLinks: string[];
}

export interface PortalPlanGap {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
  recommendation: string;
}

export interface PortalPlanCoverage {
  providerCount: number;
  externalGuideCount: number;
  jobCount: number;
  contentCount: number;
  publishedContentCount: number;
  matchingContentCount: number;
  availableModules: string[];
}

export interface PortalPlan {
  id: string;
  category: CategorySlug;
  providerId: string;
  categoryLabel: string;
  theme: string;
  region?: string;
  audience: ContentAudience;
  goal: PortalPlanGoal;
  coverage: PortalPlanCoverage;
  searchIntents: PortalPlanSearchIntent[];
  pageIdeas: PortalPlanPageIdea[];
  gaps: PortalPlanGap[];
  nextActions: string[];
  appliedProposalIds?: string[];
  appliedAt?: string;
  draftIds?: string[];
  draftedAt?: string;
  generatedAt: string;
}

export const contentLocales = ["ja", "en", "zh-CN", "es", "ko", "de", "fr"] as const;
export type ContentLocale = (typeof contentLocales)[number];

export const contentWorkflowStatuses = ["proposed", "drafted", "polished", "seo_reviewed", "review_requested", "changes_requested", "approved", "published", "archived"] as const;
export type ContentWorkflowStatus = (typeof contentWorkflowStatuses)[number];
export type ContentJsonLdType = "Organization" | "Article" | "BlogPosting" | "JobPosting" | "NewsArticle" | "FAQPage";

export const contentVisibilityValues = ["public", "unlisted", "private", "internal"] as const;
export type ContentVisibility = (typeof contentVisibilityValues)[number];

export const contentGenerationOperations = ["proposal", "draft", "polish", "translate", "portal_plan"] as const;
export type ContentGenerationOperation = (typeof contentGenerationOperations)[number];

export interface ContentGenerationAudit {
  operation: ContentGenerationOperation;
  adapterId: string;
  model?: string | undefined;
  inputSources: string[];
  generatedAt: string;
  approvedBy?: string | undefined;
}

export interface ContentAuthorProfile {
  id?: string | undefined;
  name: string;
  bio?: string | undefined;
  credentials?: string[] | undefined;
  profileUrl?: string | undefined;
}

/**
 * 採用・会社情報・PR・IRで再利用する、コンテンツ種別ごとの構造化項目です。
 * 本文の代替ではなく、検索・配信・AIエージェントが安全に参照する正規データです。
 */
export type ContentStructuredData =
  | {
    type: "company";
    companyName: string;
    representative?: string | undefined;
    address?: string | undefined;
    services?: string[] | undefined;
  }
  | {
    type: "job";
    jobTitle: string;
    employmentType: string;
    locations: string[];
    responsibilities: string[];
    requirements: string[];
    salary?: string | undefined;
    preferredQualifications?: string[] | undefined;
    benefits?: string[] | undefined;
    selectionProcess?: string[] | undefined;
    applicationUrl?: string | undefined;
    openingDate?: string | undefined;
    closingDate?: string | undefined;
    status: "open" | "closed";
  }
  | {
    type: "pressRelease";
    releaseDate: string;
    issuer: string;
    mediaContact?: string | undefined;
    eventDate?: string | undefined;
  }
  | {
    type: "ir";
    publicationDate: string;
    documentType: "financial_results" | "presentation" | "notice" | "shareholder" | "calendar" | "other";
    fiscalPeriod?: string | undefined;
    sourceDocumentUrl?: string | undefined;
    correctionOfContentId?: string | undefined;
    withdrawn?: boolean | undefined;
  };

export interface ContentSourceEvidence {
  title: string;
  url: string;
  publisher?: string | undefined;
  checkedAt: string;
  note?: string | undefined;
}

export type ContentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "image"; url: string; alt: string; caption?: string | undefined }
  | { type: "gallery"; items: Array<{ url: string; alt: string; caption?: string | undefined }>; caption?: string | undefined }
  | { type: "video"; url: string; title?: string | undefined; caption?: string | undefined }
  | { type: "quote"; text: string; attribution?: string | undefined }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "file"; url: string; label: string; description?: string | undefined }
  | { type: "embed"; url: string; title?: string | undefined }
  | { type: "cta"; label: string; url: string; description?: string | undefined }
  | { type: "jobCard"; contentId: string; title: string; url?: string | undefined }
  | { type: "pressReleaseCard"; contentId: string; title: string; url?: string | undefined }
  | { type: "irDocumentCard"; contentId: string; title: string; url?: string | undefined }
  | { type: "relatedContent"; contentIds: string[]; title?: string | undefined }
  | { type: "companyCard"; providerId: string; name: string; url?: string | undefined; description?: string | undefined };

export interface ContentProposal {
  id: string;
  category: CategorySlug;
  providerId: string;
  contentType: ContentType;
  audience: ContentAudience;
  /** 下書き・公開ページへ添付する、同一事業者が管理するメディアアセットID。 */
  mediaIds?: string[];
  topic: string;
  searchIntent: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  outline: string[];
  sourceFacts: string[];
  rationale: string;
  generationAudit?: ContentGenerationAudit | undefined;
  createdAt: string;
}

export interface ContentSeo {
  title: string;
  description: string;
  keywords: string[];
  canonicalPath: string;
  ogTitle: string;
  ogDescription: string;
  jsonLdType: ContentJsonLdType;
  faq: Array<{ question: string; answer: string }>;
}

export interface ContentTranslationOrigin {
  contentId: string;
  sourceVersion: number;
  sourceLocale: ContentLocale;
}

export interface ContentRecord {
  blocks?: ContentBlock[] | undefined;
  structuredData?: ContentStructuredData | undefined;
  sourceEvidence?: ContentSourceEvidence[] | undefined;
  id: string;
  category: CategorySlug;
  providerId: string;
  contentType: ContentType;
  audience: ContentAudience;
  /** 公開時にBuilderOS Adapterへ引き渡すメディアアセットID。 */
  mediaIds?: string[];
  title: string;
  slug: string;
  summary: string;
  body: string;
  seo: ContentSeo;
  sourceFacts: string[];
  proposalId: string;
  locale: ContentLocale;
  translationOf?: ContentTranslationOrigin;
  visibility: ContentVisibility;
  tags: string[];
  featured: boolean;
  readingTimeMinutes: number;
  createdBy: string;
  currentVersionId: string;
  series?: string | undefined;
  authors?: ContentAuthorProfile[] | undefined;
  publishedAt?: string | undefined;
  expiresAt?: string | undefined;
  reviewedBy?: string | undefined;
  generationAudit?: ContentGenerationAudit | undefined;
  status: ContentWorkflowStatus;
  lastSeoAudit?: SeoAuditResult;
  lastFactCheck?: FactCheckResult;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ContentVersionReason = "created" | "updated" | "polished" | "workflow" | "restored" | "migrated";

export interface ContentVersionRecord {
  blocks?: ContentBlock[] | undefined;
  structuredData?: ContentStructuredData | undefined;
  sourceEvidence?: ContentSourceEvidence[] | undefined;
  id: string;
  contentId: string;
  version: number;
  mediaIds?: string[];
  title: string;
  summary: string;
  body: string;
  seo: ContentSeo;
  sourceFacts: string[];
  locale: ContentLocale;
  translationOf?: ContentTranslationOrigin;
  visibility: ContentVisibility;
  tags: string[];
  featured: boolean;
  readingTimeMinutes: number;
  createdBy: string;
  series?: string | undefined;
  authors?: ContentAuthorProfile[] | undefined;
  publishedAt?: string | undefined;
  expiresAt?: string | undefined;
  reviewedBy?: string | undefined;
  generationAudit?: ContentGenerationAudit | undefined;
  status: ContentWorkflowStatus;
  reason: ContentVersionReason;
  actorId?: string;
  createdAt: string;
}

export const contentReviewStatuses = ["requested", "changes_requested", "approved"] as const;
export type ContentReviewStatus = (typeof contentReviewStatuses)[number];

export interface ContentReviewRecord {
  id: string;
  contentId: string;
  category: CategorySlug;
  providerId: string;
  contentVersion: number;
  status: ContentReviewStatus;
  requestedByAccountId: string;
  reviewerAccountId?: string;
  requestNote?: string;
  responseNote?: string;
  requestedAt: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const contentEditorialActionKinds = ["correction", "withdrawal"] as const;
export type ContentEditorialActionKind = (typeof contentEditorialActionKinds)[number];

export interface ContentEditorialActionRecord {
  id: string;
  contentId: string;
  category: CategorySlug;
  providerId: string;
  contentVersion: number;
  kind: ContentEditorialActionKind;
  reason: string;
  beforeBody: string;
  beforeBlocks?: ContentBlock[] | undefined;
  beforeStructuredData?: ContentStructuredData | undefined;
  beforeSourceEvidence?: ContentSourceEvidence[] | undefined;
  afterBody?: string | undefined;
  afterBlocks?: ContentBlock[] | undefined;
  afterStructuredData?: ContentStructuredData | undefined;
  afterSourceEvidence?: ContentSourceEvidence[] | undefined;
  actorAccountId: string;
  createdAt: string;
}

export type SeoIssueSeverity = "error" | "warning" | "info";

export interface SeoAuditIssue {
  code: string;
  severity: SeoIssueSeverity;
  field: string;
  message: string;
  recommendation: string;
}

export interface SeoAuditResult {
  contentId: string;
  contentVersion: number;
  score: number;
  issues: SeoAuditIssue[];
  auditedAt: string;
}

export interface SeoSiteAuditIssue {
  code: string;
  severity: SeoIssueSeverity;
  contentId?: string;
  field: string;
  message: string;
  recommendation: string;
}

export interface SeoSiteAuditResult {
  category: CategorySlug;
  providerId: string;
  contentCount: number;
  publicContentCount: number;
  score: number;
  issues: SeoSiteAuditIssue[];
  auditedAt: string;
}

export type FactCheckItemStatus = "source_registered" | "source_missing";

export interface FactCheckItem {
  claim: string;
  status: FactCheckItemStatus;
  note: string;
}

export interface FactCheckResult {
  contentId: string;
  contentVersion: number;
  passed: boolean;
  scope: "source_presence_only";
  items: FactCheckItem[];
  issues: string[];
  checkedAt: string;
}

export interface PublicationFile {
  path: string;
  contentType: string;
  content: string;
}

export interface PublicationBuildResult {
  publicationId: string;
  baseUrl: string;
  contentIds: string[];
  generatedAt: string;
  files: PublicationFile[];
}

export const publicationHistoryStatuses = ["built", "deployed", "published", "rolled_back"] as const;
export type PublicationHistoryStatus = (typeof publicationHistoryStatuses)[number];

export interface PublicationDeploymentRecord {
  status: "submitted" | "dry_run";
  provider: "cloudflare-pages";
  projectName: string;
  requestId: string;
  fileCount: number;
  uploadedFileCount: number;
  deploymentId?: string;
  deploymentUrl?: string;
  environment?: string;
}

export interface PublicationHistoryRecord {
  id: string;
  category: CategorySlug;
  providerId: string;
  baseUrl: string;
  contentIds: string[];
  generatedAt: string;
  status: PublicationHistoryStatus;
  files: PublicationFile[];
  deployment?: PublicationDeploymentRecord;
  rollbackOf?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicationHistorySummary = Omit<PublicationHistoryRecord, "files"> & { fileCount: number };

export const publicationScheduleStatuses = ["scheduled", "cancelled", "executed"] as const;
export type PublicationScheduleStatus = (typeof publicationScheduleStatuses)[number];

export interface PublicationScheduleRecord {
  id: string;
  publicationId: string;
  category: CategorySlug;
  providerId: string;
  contentIds: string[];
  baseUrl: string;
  scheduledFor: string;
  status: PublicationScheduleStatus;
  executedAt?: string;
  cancelledAt?: string;
  lastError?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type PublicationScheduleSummary = PublicationScheduleRecord;
