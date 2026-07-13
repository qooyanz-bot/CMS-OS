export const portalRoles = ["user", "orderer", "provider", "candidate"] as const;

export type PortalRole = (typeof portalRoles)[number];
export type CategorySlug = "legal" | "beauty";

export interface RoleAssignment {
  role: PortalRole;
  category: CategorySlug | "*";
  organizationId?: string;
}

export interface Account {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  assignments: RoleAssignment[];
  providerId?: string;
}

export interface AuthenticatedPrincipal {
  accountId: string;
  email: string;
  displayName: string;
  category: CategorySlug;
  role: PortalRole;
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

export interface ProviderRecord {
  id: string;
  category: CategorySlug;
  name: string;
  themes: string[];
  location: string;
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

export type RequestStatus = "submitted" | "accepted" | "closed";
export type JobStatus = "published" | "closed";
export type ApplicationStatus = "submitted" | "screening" | "closed";

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

export interface JobPosting {
  id: string;
  category: CategorySlug;
  providerId: string;
  title: string;
  employmentType: string;
  location: string;
  description: string;
  status: JobStatus;
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

export const contentTypes = ["company", "blog", "job", "pr", "ir"] as const;
export type ContentType = (typeof contentTypes)[number];

export const contentAudiences = ["customer", "candidate", "media", "investor", "beginner", "existingCustomer"] as const;
export type ContentAudience = (typeof contentAudiences)[number];

export type ContentWorkflowStatus = "proposed" | "drafted" | "polished" | "seo_reviewed" | "approved" | "published";
export type ContentJsonLdType = "Organization" | "Article" | "BlogPosting" | "JobPosting" | "NewsArticle" | "FAQPage";

export interface ContentProposal {
  id: string;
  category: CategorySlug;
  providerId: string;
  contentType: ContentType;
  audience: ContentAudience;
  topic: string;
  searchIntent: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  outline: string[];
  sourceFacts: string[];
  rationale: string;
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

export interface ContentRecord {
  id: string;
  category: CategorySlug;
  providerId: string;
  contentType: ContentType;
  audience: ContentAudience;
  title: string;
  slug: string;
  summary: string;
  body: string;
  seo: ContentSeo;
  sourceFacts: string[];
  proposalId: string;
  status: ContentWorkflowStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
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
  score: number;
  issues: SeoAuditIssue[];
  auditedAt: string;
}
