import { randomUUID } from "node:crypto";
import { listProviders as listCatalogProviders } from "./catalog.js";
import type { CategorySlug, InquiryStatus, JobApplication, JobPosting, ProviderInquiry, ProviderListingStatus, ProviderRecord, ServiceRequest } from "./types.js";
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

export class PortalStore {
  private readonly providers: ProviderRecord[];
  private readonly requests: ServiceRequest[];
  private readonly jobs: JobPosting[];
  private readonly applications: JobApplication[];
  private readonly inquiries: ProviderInquiry[];

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
    this.requests = stateStore?.load<ServiceRequest[]>("portal-requests.json", []) ?? [];
    const savedJobs = stateStore?.load<JobPosting[]>("portal-jobs.json", defaultJobs) ?? defaultJobs;
    this.jobs = savedJobs.map((job) => ({ ...job }));
    this.applications = stateStore?.load<JobApplication[]>("portal-applications.json", []) ?? [];
    this.inquiries = stateStore?.load<ProviderInquiry[]>("portal-inquiries.json", []) ?? [];
  }

  public listProviders(category: CategorySlug): ProviderRecord[] {
    return this.providers.filter((provider) => provider.category === category);
  }

  public getProvider(providerId: string): ProviderRecord | undefined {
    return this.providers.find((provider) => provider.id === providerId);
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
}
