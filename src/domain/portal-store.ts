import { randomUUID } from "node:crypto";
import { listProviders as listCatalogProviders } from "./catalog.js";
import { listAllDirectoryGuides } from "./directory-catalog.js";
import type { BookingStatus, CategorySlug, DirectoryGuide, InquiryStatus, JobApplication, JobPosting, PortalNotification, ProviderFavorite, ProviderInquiry, ProviderListingStatus, ProviderRecord, ServiceBooking, ServiceRequest } from "./types.js";
import type { StateStore } from "../infrastructure/json-state-store.js";

const defaultJobs: JobPosting[] = [
  {
    id: "job-legal-demo",
    category: "legal",
    providerId: "provider-legal-demo",
    title: "弁護士・パラリーガルを募集しています",
    employmentType: "正社員・業務委託",
    location: "東京都・オンライン",
    description: "企業法務と相続案件を扱うチームの求人です。",
    status: "published",
  },
  {
    id: "job-beauty-demo",
    category: "beauty",
    providerId: "provider-beauty-demo",
    title: "スタイリスト・アシスタント募集",
    employmentType: "正社員・パート",
    location: "大阪府",
    description: "技術研修と長期的なキャリア形成を重視しています。",
    status: "published",
  },
  {
    id: "job-ai-business-demo",
    category: "ai-business",
    providerId: "provider-ai-business-demo",
    title: "生成AI活用コンサルタント",
    employmentType: "正社員・業務委託",
    location: "東京・オンライン",
    description: "企業の業務改善と生成AI導入を支援するプロジェクト担当を募集します。",
    status: "published",
  },
  {
    id: "job-labor-shortage-demo",
    category: "labor-shortage",
    providerId: "provider-labor-shortage-demo",
    title: "採用支援プロジェクト担当",
    employmentType: "正社員・業務委託",
    location: "東京・大阪・オンライン",
    description: "採用計画、候補者対応、現場の人材課題解決を支援するメンバーを募集します。",
    status: "published",
  },
  {
    id: "job-tourism-demo",
    category: "tourism",
    providerId: "provider-tourism-demo",
    title: "観光体験プランナー",
    employmentType: "正社員・契約社員",
    location: "全国・地域拠点",
    description: "地域の魅力を生かした観光体験と訪日旅行者向け企画をつくる仕事です。",
    status: "published",
  },
  {
    id: "job-mobility-dx-demo",
    category: "mobility-dx",
    providerId: "provider-mobility-dx-demo",
    title: "モビリティDXプロジェクト担当",
    employmentType: "正社員・業務委託",
    location: "東京・オンライン",
    description: "車両データと移動サービスを活用した業務改善プロジェクトを推進します。",
    status: "published",
  },
  {
    id: "job-gx-demo",
    category: "gx",
    providerId: "provider-gx-demo",
    title: "脱炭素・GXコンサルタント",
    employmentType: "正社員・業務委託",
    location: "東京・オンライン",
    description: "企業の脱炭素計画、環境データ整理、実行支援を担当するメンバーを募集します。",
    status: "published",
  },
  {
    id: "job-regional-revitalization-demo",
    category: "regional-revitalization",
    providerId: "provider-regional-revitalization-demo",
    title: "地域プロジェクトコーディネーター",
    employmentType: "正社員・業務委託",
    location: "地域拠点・リモート",
    description: "自治体、地域事業者、移住希望者をつなぐ地域プロジェクトを運営します。",
    status: "published",
  },
];

function cloneFields(fields: Record<string, string | string[]>): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
}

function cloneProvider(provider: ProviderRecord): ProviderRecord {
  return {
    ...provider,
    themes: [...provider.themes],
    listingStatus: provider.listingStatus ?? "published",
    publicFields: cloneFields(provider.publicFields),
    ordererFields: cloneFields(provider.ordererFields),
    providerFields: cloneFields(provider.providerFields),
    candidateFields: cloneFields(provider.candidateFields),
  };
}

function cloneDirectoryGuide(guide: DirectoryGuide): DirectoryGuide {
  return { ...guide, targetRoles: [...guide.targetRoles] };
}

function cloneFavorite(favorite: ProviderFavorite): ProviderFavorite {
  return { ...favorite };
}

export class PortalStore {
  private readonly providers: ProviderRecord[];
  private readonly directoryGuides: DirectoryGuide[];
  private readonly requests: ServiceRequest[];
  private readonly bookings: ServiceBooking[];
  private readonly jobs: JobPosting[];
  private readonly applications: JobApplication[];
  private readonly inquiries: ProviderInquiry[];
  private readonly notifications: PortalNotification[];
  private readonly favorites: ProviderFavorite[];

  public constructor(private readonly stateStore?: StateStore) {
    const catalogProviders = listCatalogProviders("legal").concat(
      listCatalogProviders("beauty"),
      listCatalogProviders("ai-business"),
      listCatalogProviders("labor-shortage"),
      listCatalogProviders("tourism"),
      listCatalogProviders("mobility-dx"),
      listCatalogProviders("gx"),
      listCatalogProviders("regional-revitalization"),
    );
    const savedProviders = stateStore?.load<ProviderRecord[]>("portal-providers.json", catalogProviders);
    this.providers = (savedProviders ?? catalogProviders).map(cloneProvider);
    const catalogDirectoryGuides = listAllDirectoryGuides();
    const savedDirectoryGuides = stateStore?.load<DirectoryGuide[]>("portal-directory-guides.json", catalogDirectoryGuides);
    this.directoryGuides = (savedDirectoryGuides ?? catalogDirectoryGuides).map(cloneDirectoryGuide);
    this.requests = stateStore?.load<ServiceRequest[]>("portal-requests.json", []) ?? [];
    this.bookings = stateStore?.load<ServiceBooking[]>("portal-bookings.json", []) ?? [];
    const savedJobs = stateStore?.load<JobPosting[]>("portal-jobs.json", defaultJobs) ?? defaultJobs;
    const jobsById = new Map(defaultJobs.map((job) => [job.id, job]));
    for (const job of savedJobs) jobsById.set(job.id, job);
    this.jobs = [...jobsById.values()].map((job) => ({ ...job }));
    this.applications = stateStore?.load<JobApplication[]>("portal-applications.json", []) ?? [];
    this.inquiries = stateStore?.load<ProviderInquiry[]>("portal-inquiries.json", []) ?? [];
    this.notifications = stateStore?.load<PortalNotification[]>("portal-notifications.json", []) ?? [];
    this.favorites = stateStore?.load<ProviderFavorite[]>("portal-favorites.json", []) ?? [];
  }

  public listProviders(category: CategorySlug): ProviderRecord[] {
    return this.providers.filter((provider) => provider.category === category);
  }

  public getProvider(providerId: string): ProviderRecord | undefined {
    return this.providers.find((provider) => provider.id === providerId);
  }

  public listDirectoryGuides(): DirectoryGuide[] {
    return this.directoryGuides.map(cloneDirectoryGuide);
  }

  public createDirectoryGuide(input: Omit<DirectoryGuide, "id">): DirectoryGuide {
    const guide = { ...input, id: `directory-${randomUUID()}` };
    this.directoryGuides.push(guide);
    this.stateStore?.save("portal-directory-guides.json", this.directoryGuides);
    return cloneDirectoryGuide(guide);
  }

  public updateDirectoryGuide(id: string, patch: Partial<Omit<DirectoryGuide, "id">>): DirectoryGuide | undefined {
    const guide = this.directoryGuides.find((item) => item.id === id);
    if (!guide) return undefined;
    Object.assign(guide, patch);
    this.stateStore?.save("portal-directory-guides.json", this.directoryGuides);
    return cloneDirectoryGuide(guide);
  }

  public deleteDirectoryGuide(id: string): boolean {
    const index = this.directoryGuides.findIndex((guide) => guide.id === id);
    if (index < 0) return false;
    this.directoryGuides.splice(index, 1);
    this.stateStore?.save("portal-directory-guides.json", this.directoryGuides);
    return true;
  }

  public updateProvider(
    providerId: string,
    patch: Partial<Pick<ProviderRecord, "name" | "themes" | "location" | "listingStatus" | "listingSubmittedAt" | "listingReviewedAt" | "listingReviewNote" | "publicFields">>,
  ): ProviderRecord | undefined {
    const provider = this.getProvider(providerId);
    if (!provider) return undefined;
    if (patch.name !== undefined) provider.name = patch.name;
    if (patch.themes !== undefined) provider.themes = [...patch.themes];
    if (patch.location !== undefined) provider.location = patch.location;
    if (patch.listingStatus !== undefined) provider.listingStatus = patch.listingStatus;
    if (patch.listingSubmittedAt !== undefined) provider.listingSubmittedAt = patch.listingSubmittedAt;
    if (patch.listingReviewedAt !== undefined) provider.listingReviewedAt = patch.listingReviewedAt;
    if (patch.listingReviewNote !== undefined) provider.listingReviewNote = patch.listingReviewNote;
    if (patch.publicFields !== undefined) {
      provider.publicFields = { ...provider.publicFields, ...cloneFields(patch.publicFields) };
    }
    this.stateStore?.save("portal-providers.json", this.providers);
    return provider;
  }

  public listFavorites(accountId: string, category: CategorySlug): ProviderFavorite[] {
    return this.favorites
      .filter((favorite) => favorite.accountId === accountId && favorite.category === category)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneFavorite);
  }

  public getFavorite(accountId: string, category: CategorySlug, favoriteId: string): ProviderFavorite | undefined {
    const favorite = this.favorites.find(
      (candidate) => candidate.accountId === accountId && candidate.category === category && candidate.id === favoriteId,
    );
    return favorite ? cloneFavorite(favorite) : undefined;
  }

  public getFavoriteByProvider(accountId: string, category: CategorySlug, providerId: string): ProviderFavorite | undefined {
    const favorite = this.favorites.find(
      (candidate) => candidate.accountId === accountId && candidate.category === category && candidate.providerId === providerId,
    );
    return favorite ? cloneFavorite(favorite) : undefined;
  }

  public createFavorite(input: Omit<ProviderFavorite, "id" | "createdAt">): { favorite: ProviderFavorite; created: boolean } {
    const existing = this.getFavoriteByProvider(input.accountId, input.category, input.providerId);
    if (existing) return { favorite: existing, created: false };
    const favorite: ProviderFavorite = {
      ...input,
      id: `favorite-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.favorites.push(favorite);
    this.stateStore?.save("portal-favorites.json", this.favorites);
    return { favorite: cloneFavorite(favorite), created: true };
  }

  public deleteFavorite(accountId: string, category: CategorySlug, favoriteId: string): boolean {
    const index = this.favorites.findIndex(
      (favorite) => favorite.accountId === accountId && favorite.category === category && favorite.id === favoriteId,
    );
    if (index < 0) return false;
    this.favorites.splice(index, 1);
    this.stateStore?.save("portal-favorites.json", this.favorites);
    return true;
  }

  public createRequest(input: Omit<ServiceRequest, "id" | "createdAt" | "status">): ServiceRequest {
    const request: ServiceRequest = {
      ...input,
      id: `request-${randomUUID()}`,
      status: "submitted",
      createdAt: new Date().toISOString(),
    };
    this.requests.push(request);
    this.stateStore?.save("portal-requests.json", this.requests);
    return request;
  }

  public listRequests(category: CategorySlug): ServiceRequest[] {
    return this.requests.filter((request) => request.category === category);
  }

  public getRequest(requestId: string): ServiceRequest | undefined {
    return this.requests.find((request) => request.id === requestId);
  }

  public updateRequest(requestId: string, status: ServiceRequest["status"]): ServiceRequest | undefined {
    const request = this.getRequest(requestId);
    if (!request) return undefined;
    request.status = status;
    this.stateStore?.save("portal-requests.json", this.requests);
    return request;
  }

  public createBooking(input: Omit<ServiceBooking, "id" | "status" | "createdAt" | "updatedAt">): ServiceBooking {
    const now = new Date().toISOString();
    const booking: ServiceBooking = {
      ...input,
      id: `booking-${randomUUID()}`,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    };
    this.bookings.push(booking);
    this.stateStore?.save("portal-bookings.json", this.bookings);
    return booking;
  }

  public listBookings(category: CategorySlug): ServiceBooking[] {
    return this.bookings.filter((booking) => booking.category === category);
  }

  public getBooking(bookingId: string): ServiceBooking | undefined {
    return this.bookings.find((booking) => booking.id === bookingId);
  }

  public updateBooking(bookingId: string, status: BookingStatus): ServiceBooking | undefined {
    const booking = this.getBooking(bookingId);
    if (!booking) return undefined;
    booking.status = status;
    booking.updatedAt = new Date().toISOString();
    this.stateStore?.save("portal-bookings.json", this.bookings);
    return booking;
  }

  public listJobs(category: CategorySlug): JobPosting[] {
    return this.jobs.filter((job) => job.category === category && job.status === "published");
  }

  public listJobsForProvider(category: CategorySlug, providerId: string): JobPosting[] {
    return this.jobs.filter((job) => job.category === category && job.providerId === providerId);
  }

  public getJob(jobId: string): JobPosting | undefined {
    return this.jobs.find((job) => job.id === jobId);
  }

  public createJob(input: Omit<JobPosting, "id">): JobPosting {
    const job: JobPosting = { ...input, id: `job-${randomUUID()}` };
    this.jobs.push(job);
    this.stateStore?.save("portal-jobs.json", this.jobs);
    return job;
  }

  public updateJob(
    jobId: string,
    patch: Partial<Pick<JobPosting, "title" | "employmentType" | "location" | "description" | "status">>,
  ): JobPosting | undefined {
    const job = this.getJob(jobId);
    if (!job) return undefined;
    Object.assign(job, patch);
    this.stateStore?.save("portal-jobs.json", this.jobs);
    return job;
  }

  public hasApplication(jobId: string, candidateId: string): boolean {
    return this.applications.some((application) => application.jobId === jobId && application.candidateId === candidateId);
  }

  public createApplication(input: Omit<JobApplication, "id" | "createdAt" | "status">): JobApplication {
    const application: JobApplication = {
      ...input,
      id: `application-${randomUUID()}`,
      status: "submitted",
      createdAt: new Date().toISOString(),
    };
    this.applications.push(application);
    this.stateStore?.save("portal-applications.json", this.applications);
    return application;
  }

  public listApplications(category: CategorySlug): JobApplication[] {
    return this.applications.filter((application) => application.category === category);
  }

  public getApplication(applicationId: string): JobApplication | undefined {
    return this.applications.find((application) => application.id === applicationId);
  }

  public updateApplication(applicationId: string, status: JobApplication["status"]): JobApplication | undefined {
    const application = this.getApplication(applicationId);
    if (!application) return undefined;
    application.status = status;
    this.stateStore?.save("portal-applications.json", this.applications);
    return application;
  }

  public createInquiry(input: Omit<ProviderInquiry, "id" | "createdAt" | "updatedAt" | "status">): ProviderInquiry {
    const now = new Date().toISOString();
    const inquiry: ProviderInquiry = {
      ...input,
      id: `inquiry-${randomUUID()}`,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    this.inquiries.push(inquiry);
    this.stateStore?.save("portal-inquiries.json", this.inquiries);
    return inquiry;
  }

  public listInquiries(category: CategorySlug): ProviderInquiry[] {
    return this.inquiries.filter((inquiry) => inquiry.category === category);
  }

  public getInquiry(inquiryId: string): ProviderInquiry | undefined {
    return this.inquiries.find((inquiry) => inquiry.id === inquiryId);
  }

  public updateInquiry(inquiryId: string, status: InquiryStatus): ProviderInquiry | undefined {
    const inquiry = this.getInquiry(inquiryId);
    if (!inquiry) return undefined;
    inquiry.status = status;
    inquiry.updatedAt = new Date().toISOString();
    this.stateStore?.save("portal-inquiries.json", this.inquiries);
    return inquiry;
  }

  public listProvidersForReview(category?: CategorySlug, status?: ProviderListingStatus): ProviderRecord[] {
    return this.providers
      .filter((provider) => !category || provider.category === category)
      .filter((provider) => !status || (provider.listingStatus ?? "published") === status)
      .map(cloneProvider);
  }

  public createNotification(input: Omit<PortalNotification, "id" | "createdAt" | "readAt">): PortalNotification {
    const notification: PortalNotification = {
      ...input,
      id: `notification-${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.notifications.push(notification);
    this.stateStore?.save("portal-notifications.json", this.notifications);
    return { ...notification };
  }

  public listNotifications(): PortalNotification[] {
    return this.notifications.map((notification) => ({ ...notification }));
  }

  public getNotification(notificationId: string): PortalNotification | undefined {
    return this.notifications.find((notification) => notification.id === notificationId);
  }

  public markNotification(notificationId: string, read: boolean): PortalNotification | undefined {
    const notification = this.getNotification(notificationId);
    if (!notification) return undefined;
    if (read) notification.readAt = new Date().toISOString();
    else delete notification.readAt;
    this.stateStore?.save("portal-notifications.json", this.notifications);
    return { ...notification };
  }
}
