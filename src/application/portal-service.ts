import { InMemoryAuthService } from "../domain/auth.js";
import {
  listCategoryPolicies,
  listProviders,
  projectProvider,
  resolveExperience,
} from "../domain/catalog.js";
import { PortalStore } from "../domain/portal-store.js";
import type {
  AuthenticatedPrincipal,
  CategorySlug,
  JobApplication,
  JobPosting,
  PortalRole,
  ServiceRequest,
  VisibleProvider,
} from "../domain/types.js";

export class PortalServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "PortalServiceError";
  }
}

export class PortalService {
  public constructor(
    private readonly auth: InMemoryAuthService,
    private readonly store = new PortalStore(),
  ) {}

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

    return listProviders(category)
      .filter((provider) => {
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
    const provider = listProviders(input.category).find((candidate) => candidate.id === input.providerId);
    if (!provider) throw new PortalServiceError(404, "指定された事業者が見つかりません。");

    return this.store.createRequest({
      category: input.category,
      ordererId: principal.accountId,
      providerId: input.providerId,
      title: input.title.trim(),
      description: input.description.trim(),
    });
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

  public listJobs(category: CategorySlug, principal: AuthenticatedPrincipal | null): JobPosting[] {
    return this.store.listJobs(category).map((job) => {
      if (principal?.role === "provider" && principal.providerId === job.providerId) return job;
      return {
        ...job,
        providerId: "非公開",
      };
    });
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

    return this.store.createApplication({
      category: principal.category,
      jobId,
      providerId: job.providerId,
      candidateId: principal.accountId,
      message: message.trim(),
    });
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
}
