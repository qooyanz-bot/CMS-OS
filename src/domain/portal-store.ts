import { randomUUID } from "node:crypto";
import type { CategorySlug, JobApplication, JobPosting, ServiceRequest } from "./types.js";
import type { JsonStateStore } from "../infrastructure/json-state-store.js";

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

export class PortalStore {
  private readonly requests: ServiceRequest[];
  private readonly jobs: JobPosting[];
  private readonly applications: JobApplication[];

  public constructor(private readonly stateStore?: JsonStateStore) {
    this.requests = stateStore?.load<ServiceRequest[]>("portal-requests.json", []) ?? [];
    this.jobs = stateStore ? stateStore.load<JobPosting[]>("portal-jobs.json", defaultJobs) : defaultJobs;
    this.applications = stateStore?.load<JobApplication[]>("portal-applications.json", []) ?? [];
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

  public listJobs(category: CategorySlug): JobPosting[] {
    return this.jobs.filter((job) => job.category === category && job.status === "published");
  }

  public getJob(jobId: string): JobPosting | undefined {
    return this.jobs.find((job) => job.id === jobId);
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
}
