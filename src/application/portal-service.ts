import type { AuthService } from "../domain/auth.js";
import {
  listCategoryPolicies,
  projectProvider,
  resolveExperience,
} from "../domain/catalog.js";
import { PortalStore } from "../domain/portal-store.js";
import type {
  AuthenticatedPrincipal,
  CategorySlug,
  InquiryStatus,
  JobStatus,
  JobApplication,
  JobPosting,
  PortalRole,
  PortalNotification,
  ProviderListingReviewItem,
  ProviderInquiry,
  ProviderListingStatus,
  ProviderRecord,
  ServiceRequest,
  VisibleProvider,
} from "../domain/types.js";
import { jobStatuses } from "../domain/types.js";

export type ProviderUpdateInput = Partial<Pick<ProviderRecord, "name" | "themes" | "location" | "publicFields">>;

export interface PortalPage<T> {
  items: T[];
  page: { limit: number; nextCursor?: string };
}

function providerListingStatus(provider: ProviderRecord): ProviderListingStatus {
  return provider.listingStatus ?? "published";
}

function isPublicProvider(provider: ProviderRecord): boolean {
  return providerListingStatus(provider) === "published";
}

const protectedPublicFieldKeys = new Set([
  "id",
  "category",
  "name",
  "themes",
  "location",
  "publicFields",
  "ordererFields",
  "providerFields",
  "candidateFields",
  "verificationStatus",
  "lastVerifiedAt",
  "listingStatus",
  "__proto__",
  "constructor",
  "prototype",
]);

function validatePublicFields(fields: Record<string, string | string[]>): void {
  const entries = Object.entries(fields);
  if (entries.length > 50) throw new PortalServiceError(400, "公開項目は50項目以内で指定してください。");
  for (const [key, value] of entries) {
    if (!key.trim() || key.length > 100 || protectedPublicFieldKeys.has(key)) {
      throw new PortalServiceError(400, `公開項目キー「${key}」は使用できません。`);
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 20 || values.some((item) => item.length > 1000)) {
      throw new PortalServiceError(400, `公開項目「${key}」の値が長すぎます。`);
    }
  }
}

export class PortalServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "PortalServiceError";
  }
}

export class PortalService {
  public constructor(
    private readonly auth: AuthService,
    private readonly store = new PortalStore(),
  ) {}

  private notify(input: Omit<PortalNotification, "id" | "createdAt" | "readAt">): void {
    this.store.createNotification(input);
  }

  private paginate<T>(items: T[], limit: number, cursor: number): PortalPage<T> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
    const safeCursor = Math.max(Math.trunc(cursor) || 0, 0);
    const pageItems = items.slice(safeCursor, safeCursor + safeLimit);
    const nextCursor = safeCursor + pageItems.length < items.length ? String(safeCursor + pageItems.length) : undefined;
    return { items: pageItems, page: { limit: safeLimit, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public listCategories(): Array<{ slug: CategorySlug; label: string; navigation: Array<{ id: string; label: string }> }> {
    return listCategoryPolicies().map((policy) => ({
      slug: policy.slug,
      label: policy.label,
      navigation: policy.navigation,
    }));
  }

  public getExperience(
    category: CategorySlug,
    principal: AuthenticatedPrincipal | null,
  ) {
    const role = principal?.category === category ? principal.role : "user";
    return resolveExperience(category, role, principal !== null);
  }

  public switchContext(
    accessToken: string,
    category: CategorySlug,
    role: PortalRole,
  ): AuthenticatedPrincipal {
    const principal = this.auth.switchContext(accessToken, category, role);
    if (!principal) {
      throw new Error("このカテゴリまたはロールへのアクセス権がありません。");
    }
    return principal;
  }

  public searchProviders(
    category: CategorySlug,
    principal: AuthenticatedPrincipal | null,
    filters: { search?: string | undefined; theme?: string | undefined; location?: string | undefined },
  ): VisibleProvider[] {
    const role = principal?.category === category ? principal.role : "user";
    const normalizedSearch = filters.search?.trim().toLocaleLowerCase("ja-JP");
    const normalizedTheme = filters.theme?.trim().toLocaleLowerCase("ja-JP");
    const normalizedLocation = filters.location?.trim().toLocaleLowerCase("ja-JP");

    return this.store.listProviders(category)
      .filter((provider) => {
        const ownProvider = principal?.role === "provider" && principal.providerId === provider.id;
        if (!isPublicProvider(provider) && !ownProvider) return false;
        const searchable = [provider.name, provider.location, ...provider.themes].join(" ").toLocaleLowerCase("ja-JP");
        const themeMatches = !normalizedTheme || provider.themes.some((theme) => theme.toLocaleLowerCase("ja-JP") === normalizedTheme);
        const locationMatches = !normalizedLocation || provider.location.toLocaleLowerCase("ja-JP").includes(normalizedLocation);
        return (!normalizedSearch || searchable.includes(normalizedSearch)) && themeMatches && locationMatches;
      })
      .map((provider) => projectProvider(provider, role, principal?.providerId));
  }

  public assertAction(principal: AuthenticatedPrincipal | null, category: CategorySlug, action: string): void {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    if (principal.category !== category) throw new PortalServiceError(403, "現在のカテゴリコンテキストが一致しません。");

    const experience = resolveExperience(category, principal.role, true);
    if (!experience.allowedActions.includes(action)) {
      throw new PortalServiceError(403, "このロールでは操作できません。");
    }
  }

  public getProvider(providerId: string, principal: AuthenticatedPrincipal | null): VisibleProvider {
    const provider = this.store.getProvider(providerId);
    if (!provider) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    const ownProvider = principal?.role === "provider" && principal.category === provider.category && principal.providerId === provider.id;
    if (!isPublicProvider(provider) && !ownProvider) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    const role = principal?.category === provider.category ? principal.role : "user";
    return projectProvider(provider, role, principal?.providerId);
  }

  public updateProvider(
    principal: AuthenticatedPrincipal | null,
    providerId: string,
    input: ProviderUpdateInput,
  ): VisibleProvider {
    const provider = this.store.getProvider(providerId);
    if (!provider) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    if (!principal || principal.category !== provider.category) {
      throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    }
    this.assertAction(principal, provider.category, "listing.update");
    if (principal.role !== "provider" || principal.providerId !== provider.id) {
      throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    }
    if (Object.keys(input).length === 0) {
      throw new PortalServiceError(400, "更新項目を1つ以上指定してください。");
    }
    if (input.name !== undefined && (input.name.trim().length < 2 || input.name.trim().length > 200)) {
      throw new PortalServiceError(400, "nameは2文字以上200文字以内で指定してください。");
    }
    if (input.themes !== undefined) {
      if (input.themes.length < 1 || input.themes.length > 20 || input.themes.some((theme) => theme.trim().length === 0 || theme.length > 100)) {
        throw new PortalServiceError(400, "themesは1件以上20件以内で指定してください。");
      }
    }
    if (input.location !== undefined && (input.location.trim().length < 2 || input.location.trim().length > 200)) {
      throw new PortalServiceError(400, "locationは2文字以上200文字以内で指定してください。");
    }
    if (input.publicFields !== undefined) validatePublicFields(input.publicFields);

    const updated = this.store.updateProvider(provider.id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.themes !== undefined ? { themes: input.themes.map((theme) => theme.trim()) } : {}),
      ...(input.location !== undefined ? { location: input.location.trim() } : {}),
      ...(input.publicFields !== undefined ? { publicFields: input.publicFields } : {}),
    });
    if (!updated) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    this.notify({
      category: updated.category,
      recipientType: "account",
      recipientId: principal.accountId,
      type: "listing_submitted",
      title: "掲載審査へ送信しました",
      message: `${updated.name}の掲載情報を審査へ送信しました。`,
      resourceType: "provider_listing",
      resourceId: updated.id,
    });
    return projectProvider(updated, "provider", principal.providerId);
  }

  public submitProviderListing(
    principal: AuthenticatedPrincipal | null,
    providerId: string,
  ): VisibleProvider {
    const provider = this.store.getProvider(providerId);
    if (!provider || !principal || principal.category !== provider.category || principal.role !== "provider" || principal.providerId !== provider.id) {
      throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    }
    this.assertAction(principal, provider.category, "listing.submit");
    if (providerListingStatus(provider) === "pending_review") {
      throw new PortalServiceError(409, "この掲載情報はすでに審査中です。");
    }
    const updated = this.store.updateProvider(provider.id, {
      listingStatus: "pending_review",
      listingSubmittedAt: new Date().toISOString(),
      listingReviewNote: "",
    });
    if (!updated) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    return projectProvider(updated, "provider", principal.providerId);
  }

  public reviewProviderListing(
    providerId: string,
    status: ProviderListingStatus,
    note: string | undefined,
    operatorAuthorized: boolean,
  ): VisibleProvider {
    if (!operatorAuthorized) throw new PortalServiceError(403, "掲載審査の権限がありません。");
    if (status === "pending_review") throw new PortalServiceError(400, "審査結果にpending_reviewは指定できません。");
    const provider = this.store.getProvider(providerId);
    if (!provider) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    if (providerListingStatus(provider) !== "pending_review") {
      throw new PortalServiceError(409, "審査待ちの掲載情報だけを審査できます。");
    }
    const normalizedNote = note?.trim() ?? "";
    if ((status === "draft" || status === "suspended") && normalizedNote.length < 3) {
      throw new PortalServiceError(400, "差戻しまたは停止には3文字以上の理由が必要です。");
    }
    if (normalizedNote.length > 2000) throw new PortalServiceError(400, "審査メモは2000文字以内で指定してください。");
    const updated = this.store.updateProvider(provider.id, {
      listingStatus: status,
      listingReviewedAt: new Date().toISOString(),
      listingReviewNote: normalizedNote,
    });
    if (!updated) throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    this.notify({
      category: updated.category,
      recipientType: "provider",
      recipientId: updated.id,
      type: "listing_reviewed",
      title: "掲載審査の結果が更新されました",
      message: `${updated.name}の掲載状態が「${status}」になりました。${normalizedNote ? ` 審査メモ: ${normalizedNote}` : ""}`,
      resourceType: "provider_listing",
      resourceId: updated.id,
    });
    return projectProvider(updated, "provider", updated.id);
  }

  public createRequest(
    principal: AuthenticatedPrincipal | null,
    input: { category: CategorySlug; providerId: string; title: string; description: string },
  ): ServiceRequest {
    this.assertAction(principal, input.category, "request.create");
    if (!principal || principal.role !== "orderer") {
      throw new PortalServiceError(403, "発注者だけが依頼を作成できます。");
    }
    if (input.title.trim().length < 3 || input.description.trim().length < 10) {
      throw new PortalServiceError(400, "titleは3文字以上、descriptionは10文字以上で入力してください。");
    }
    const provider = this.store.listProviders(input.category).find((candidate) => candidate.id === input.providerId);
    if (!provider || !isPublicProvider(provider)) throw new PortalServiceError(404, "指定された事業者が見つかりません。");

    const request = this.store.createRequest({
      category: input.category,
      ordererId: principal.accountId,
      providerId: input.providerId,
      title: input.title.trim(),
      description: input.description.trim(),
    });
    this.notify({
      category: request.category,
      recipientType: "provider",
      recipientId: request.providerId,
      type: "request_received",
      title: "新しい依頼があります",
      message: request.title,
      resourceType: "request",
      resourceId: request.id,
    });
    return request;
  }

  public listRequests(principal: AuthenticatedPrincipal | null): ServiceRequest[] {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    if (principal.role !== "orderer" && principal.role !== "provider") {
      throw new PortalServiceError(403, "発注者または事業者だけが依頼を確認できます。");
    }

    return this.store.listRequests(principal.category).filter((request) =>
      principal.role === "orderer"
        ? request.ordererId === principal.accountId
        : request.providerId === principal.providerId,
    );
  }

  public listRequestsPage(
    principal: AuthenticatedPrincipal | null,
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<ServiceRequest> {
    return this.paginate(this.listRequests(principal), pagination.limit ?? 50, pagination.cursor ?? 0);
  }

  public updateRequestStatus(
    principal: AuthenticatedPrincipal | null,
    requestId: string,
    status: ServiceRequest["status"],
  ): ServiceRequest {
    const request = this.store.getRequest(requestId);
    if (!request) throw new PortalServiceError(404, "依頼が見つかりません。");
    if (!principal || principal.category !== request.category) throw new PortalServiceError(404, "依頼が見つかりません。");
    this.assertAction(principal, request.category, "request.status.update");
    const isOwner = principal.role === "orderer" && request.ordererId === principal.accountId;
    const isAssignedProvider = principal.role === "provider" && request.providerId === principal.providerId;
    if (!isOwner && !isAssignedProvider) throw new PortalServiceError(404, "依頼が見つかりません。");
    if (request.status === status) return request;
    if (isOwner && status !== "closed") throw new PortalServiceError(403, "発注者は依頼を終了状態に変更できます。");
    const validTransition = (request.status === "submitted" && (status === "accepted" || status === "closed"))
      || (request.status === "accepted" && status === "closed");
    if (!validTransition) throw new PortalServiceError(409, "依頼の状態遷移が不正です。");
    const updated = this.store.updateRequest(request.id, status);
    if (!updated) throw new PortalServiceError(404, "依頼が見つかりません。");
    this.notify({
      category: updated.category,
      recipientType: isAssignedProvider ? "account" : "provider",
      recipientId: isAssignedProvider ? updated.ordererId : updated.providerId,
      type: "request_status_changed",
      title: "依頼の状態が更新されました",
      message: `${updated.title}が「${status}」になりました。`,
      resourceType: "request",
      resourceId: updated.id,
    });
    return updated;
  }

  public createInquiry(
    principal: AuthenticatedPrincipal | null,
    input: { category: CategorySlug; providerId: string; subject: string; message: string },
  ): ProviderInquiry {
    this.assertAction(principal, input.category, "inquiry.create");
    if (!principal || principal.role === "provider") {
      throw new PortalServiceError(403, "事業者以外のログインユーザーが問い合わせを作成できます。");
    }
    if (input.subject.trim().length < 3 || input.subject.trim().length > 200) {
      throw new PortalServiceError(400, "subjectは3文字以上200文字以内で指定してください。");
    }
    if (input.message.trim().length < 10 || input.message.trim().length > 5000) {
      throw new PortalServiceError(400, "messageは10文字以上5000文字以内で指定してください。");
    }
    const provider = this.store.listProviders(input.category).find((candidate) => candidate.id === input.providerId);
    if (!provider || !isPublicProvider(provider)) throw new PortalServiceError(404, "問い合わせ可能な事業者が見つかりません。");
    const inquiry = this.store.createInquiry({
      category: input.category,
      providerId: provider.id,
      senderId: principal.accountId,
      subject: input.subject.trim(),
      message: input.message.trim(),
    });
    this.notify({
      category: inquiry.category,
      recipientType: "provider",
      recipientId: inquiry.providerId,
      type: "inquiry_received",
      title: "新しい問い合わせがあります",
      message: inquiry.subject,
      resourceType: "inquiry",
      resourceId: inquiry.id,
    });
    return inquiry;
  }

  public listInquiries(principal: AuthenticatedPrincipal | null): ProviderInquiry[] {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    this.assertAction(principal, principal.category, "inquiry.read");
    return this.store.listInquiries(principal.category).filter((inquiry) =>
      principal.role === "provider"
        ? inquiry.providerId === principal.providerId
        : inquiry.senderId === principal.accountId,
    );
  }

  public updateInquiryStatus(
    principal: AuthenticatedPrincipal | null,
    inquiryId: string,
    status: InquiryStatus,
  ): ProviderInquiry {
    const inquiry = this.store.getInquiry(inquiryId);
    if (!inquiry) throw new PortalServiceError(404, "問い合わせが見つかりません。");
    if (!principal || principal.category !== inquiry.category) throw new PortalServiceError(404, "問い合わせが見つかりません。");
    this.assertAction(principal, inquiry.category, "inquiry.status.update");
    const isSender = principal.role !== "provider" && inquiry.senderId === principal.accountId;
    const isProvider = principal.role === "provider" && inquiry.providerId === principal.providerId;
    if (!isSender && !isProvider) throw new PortalServiceError(404, "問い合わせが見つかりません。");
    if (inquiry.status === status) return inquiry;
    if (isSender && status !== "closed") throw new PortalServiceError(403, "問い合わせを終了できるのは送信者だけです。");
    if (isProvider && status !== "responded" && status !== "closed") throw new PortalServiceError(403, "事業者は返信済みまたは終了へ更新できます。");
    const validTransition = (inquiry.status === "open" && (status === "responded" || status === "closed"))
      || (inquiry.status === "responded" && status === "closed");
    if (!validTransition) throw new PortalServiceError(409, "問い合わせの状態遷移が不正です。");
    const updated = this.store.updateInquiry(inquiry.id, status);
    if (!updated) throw new PortalServiceError(404, "問い合わせが見つかりません。");
    this.notify({
      category: updated.category,
      recipientType: isProvider ? "account" : "provider",
      recipientId: isProvider ? updated.senderId : updated.providerId,
      type: "inquiry_status_changed",
      title: "問い合わせの状態が更新されました",
      message: `${updated.subject}が「${status}」になりました。`,
      resourceType: "inquiry",
      resourceId: updated.id,
    });
    return updated;
  }

  public listNotifications(
    principal: AuthenticatedPrincipal | null,
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<PortalNotification> {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    this.assertAction(principal, principal.category, "notification.read");
    const recipientType = principal.role === "provider" ? "provider" : "account";
    const recipientId = principal.role === "provider" ? principal.providerId : principal.accountId;
    const notifications = this.store.listNotifications()
      .filter((notification) => notification.category === principal.category && notification.recipientType === recipientType && notification.recipientId === recipientId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return this.paginate(notifications, pagination.limit ?? 50, pagination.cursor ?? 0);
  }

  public markNotificationRead(
    principal: AuthenticatedPrincipal | null,
    notificationId: string,
    read: boolean,
  ): PortalNotification {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    const notification = this.store.getNotification(notificationId);
    if (!notification) throw new PortalServiceError(404, "通知が見つかりません。");
    this.assertAction(principal, notification.category, "notification.update");
    const recipientType = principal.role === "provider" ? "provider" : "account";
    const recipientId = principal.role === "provider" ? principal.providerId : principal.accountId;
    if (notification.category !== principal.category || notification.recipientType !== recipientType || notification.recipientId !== recipientId) {
      throw new PortalServiceError(404, "通知が見つかりません。");
    }
    const updated = this.store.markNotification(notification.id, read);
    if (!updated) throw new PortalServiceError(404, "通知が見つかりません。");
    return updated;
  }

  public listListingReviewQueue(
    operatorAuthorized: boolean,
    category?: CategorySlug,
    status: ProviderListingStatus = "pending_review",
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<ProviderListingReviewItem> {
    if (!operatorAuthorized) throw new PortalServiceError(403, "掲載審査の権限がありません。");
    const providers = this.store.listProvidersForReview(category, status).map((provider) => ({
      id: provider.id,
      category: provider.category,
      name: provider.name,
      themes: [...provider.themes],
      location: provider.location,
      listingStatus: providerListingStatus(provider),
      ...(provider.listingSubmittedAt ? { listingSubmittedAt: provider.listingSubmittedAt } : {}),
      ...(provider.listingReviewedAt ? { listingReviewedAt: provider.listingReviewedAt } : {}),
      ...(provider.listingReviewNote ? { listingReviewNote: provider.listingReviewNote } : {}),
      publicFields: { ...provider.publicFields },
    }));
    return this.paginate(providers, pagination.limit ?? 50, pagination.cursor ?? 0);
  }

  public listJobs(category: CategorySlug, principal: AuthenticatedPrincipal | null): JobPosting[] {
    const jobs = principal?.role === "provider" && principal.category === category && principal.providerId
      ? this.store.listJobsForProvider(category, principal.providerId)
      : this.store.listJobs(category);
    return jobs.map((job) => {
      if (principal?.role === "provider" && principal.category === category && principal.providerId === job.providerId) return job;
      return {
        ...job,
        providerId: "非公開",
      };
    });
  }

  public listJobsPage(
    category: CategorySlug,
    principal: AuthenticatedPrincipal | null,
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<JobPosting> {
    return this.paginate(this.listJobs(category, principal), pagination.limit ?? 50, pagination.cursor ?? 0);
  }

  public createJob(
    principal: AuthenticatedPrincipal | null,
    input: { category: CategorySlug; title: string; employmentType: string; location: string; description: string; status?: JobStatus },
  ): JobPosting {
    this.assertAction(principal, input.category, "job.manage");
    if (!principal || principal.role !== "provider" || !principal.providerId) {
      throw new PortalServiceError(403, "事業者だけが求人を管理できます。");
    }
    const provider = this.store.getProvider(principal.providerId);
    if (!provider || provider.category !== input.category) {
      throw new PortalServiceError(404, "指定された事業者が見つかりません。");
    }
    this.validateJobInput(input);
    return this.store.createJob({
      category: input.category,
      providerId: principal.providerId,
      title: input.title.trim(),
      employmentType: input.employmentType.trim(),
      location: input.location.trim(),
      description: input.description.trim(),
      status: input.status ?? "published",
    });
  }

  public updateJob(
    principal: AuthenticatedPrincipal | null,
    jobId: string,
    input: Partial<Pick<JobPosting, "title" | "employmentType" | "location" | "description" | "status">>,
  ): JobPosting {
    const job = this.store.getJob(jobId);
    if (!job || !principal || principal.category !== job.category) {
      throw new PortalServiceError(404, "指定された求人が見つかりません。");
    }
    this.assertAction(principal, job.category, "job.manage");
    if (principal.role !== "provider" || principal.providerId !== job.providerId) {
      throw new PortalServiceError(404, "指定された求人が見つかりません。");
    }
    if (Object.keys(input).length === 0) {
      throw new PortalServiceError(400, "更新項目を1つ以上指定してください。");
    }
    this.validateJobInput({
      title: input.title ?? job.title,
      employmentType: input.employmentType ?? job.employmentType,
      location: input.location ?? job.location,
      description: input.description ?? job.description,
      status: input.status ?? job.status,
    });
    const updated = this.store.updateJob(job.id, {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.employmentType !== undefined ? { employmentType: input.employmentType.trim() } : {}),
      ...(input.location !== undefined ? { location: input.location.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (!updated) throw new PortalServiceError(404, "指定された求人が見つかりません。");
    return updated;
  }

  private validateJobInput(input: { title: string; employmentType: string; location: string; description: string; status?: JobStatus }): void {
    if (input.title.trim().length < 3 || input.title.trim().length > 200) {
      throw new PortalServiceError(400, "titleは3文字以上200文字以内で指定してください。");
    }
    if (input.employmentType.trim().length < 2 || input.employmentType.trim().length > 100) {
      throw new PortalServiceError(400, "employmentTypeは2文字以上100文字以内で指定してください。");
    }
    if (input.location.trim().length < 2 || input.location.trim().length > 200) {
      throw new PortalServiceError(400, "locationは2文字以上200文字以内で指定してください。");
    }
    if (input.description.trim().length < 10 || input.description.trim().length > 10000) {
      throw new PortalServiceError(400, "descriptionは10文字以上10000文字以内で指定してください。");
    }
    if (input.status !== undefined && !(jobStatuses as readonly string[]).includes(input.status)) {
      throw new PortalServiceError(400, "statusが不正です。");
    }
  }

  public createApplication(
    principal: AuthenticatedPrincipal | null,
    jobId: string,
    message: string,
  ): JobApplication {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    if (principal.role !== "candidate") throw new PortalServiceError(403, "リクルーターだけが求人へ応募できます。");
    if (message.trim().length < 10) throw new PortalServiceError(400, "messageは10文字以上で入力してください。");

    const job = this.store.getJob(jobId);
    if (!job || job.category !== principal.category || job.status !== "published") {
      throw new PortalServiceError(404, "応募可能な求人が見つかりません。");
    }
    if (this.store.hasApplication(jobId, principal.accountId)) {
      throw new PortalServiceError(409, "この求人にはすでに応募しています。");
    }

    const application = this.store.createApplication({
      category: principal.category,
      jobId,
      providerId: job.providerId,
      candidateId: principal.accountId,
      message: message.trim(),
    });
    this.notify({
      category: application.category,
      recipientType: "provider",
      recipientId: application.providerId,
      type: "application_received",
      title: "新しい応募があります",
      message: job.title,
      resourceType: "application",
      resourceId: application.id,
    });
    return application;
  }

  public listApplications(principal: AuthenticatedPrincipal | null): JobApplication[] {
    if (!principal) throw new PortalServiceError(401, "ログインが必要です。");
    if (principal.role !== "candidate" && principal.role !== "provider") {
      throw new PortalServiceError(403, "リクルーターまたは事業者だけが応募情報を確認できます。");
    }

    return this.store.listApplications(principal.category).filter((application) =>
      principal.role === "candidate"
        ? application.candidateId === principal.accountId
        : application.providerId === principal.providerId,
    );
  }

  public listApplicationsPage(
    principal: AuthenticatedPrincipal | null,
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<JobApplication> {
    return this.paginate(this.listApplications(principal), pagination.limit ?? 50, pagination.cursor ?? 0);
  }

  public updateApplicationStatus(
    principal: AuthenticatedPrincipal | null,
    applicationId: string,
    status: JobApplication["status"],
  ): JobApplication {
    const application = this.store.getApplication(applicationId);
    if (!application) throw new PortalServiceError(404, "応募情報が見つかりません。");
    if (!principal || principal.category !== application.category) throw new PortalServiceError(404, "応募情報が見つかりません。");
    this.assertAction(principal, application.category, "application.status.update");
    if (principal.role !== "provider" || principal.providerId !== application.providerId) {
      throw new PortalServiceError(404, "応募情報が見つかりません。");
    }
    if (application.status === status) return application;
    const validTransition = (application.status === "submitted" && (status === "screening" || status === "closed"))
      || (application.status === "screening" && status === "closed");
    if (!validTransition) throw new PortalServiceError(409, "応募の状態遷移が不正です。");
    const updated = this.store.updateApplication(application.id, status);
    if (!updated) throw new PortalServiceError(404, "応募情報が見つかりません。");
    this.notify({
      category: updated.category,
      recipientType: "account",
      recipientId: updated.candidateId,
      type: "application_status_changed",
      title: "応募の状態が更新されました",
      message: `応募が「${status}」になりました。`,
      resourceType: "application",
      resourceId: updated.id,
    });
    return updated;
  }
}
