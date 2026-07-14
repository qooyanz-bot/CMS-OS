import { PortalPlanStore } from "../domain/portal-plan-store.js";
import type {
  AuthenticatedPrincipal,
  CategorySlug,
  ContentAudience,
  ContentProposal,
  ContentType,
  PortalPlan,
  PortalPlanGoal,
  PortalPlanGap,
  PortalPlanPageIdea,
  PortalPlanSearchIntent,
} from "../domain/types.js";
import { contentAudiences, portalPlanGoals } from "../domain/types.js";
import type { StateStore } from "../infrastructure/json-state-store.js";
import { ContentService } from "./content-service.js";
import { PortalService, PortalServiceError, type PortalPage } from "./portal-service.js";

export class PortalPlanningServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "PortalPlanningServiceError";
  }
}

export interface PortalPlanCreateInput {
  category: CategorySlug;
  theme: string;
  region?: string;
  audience: ContentAudience;
  goal?: PortalPlanGoal;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateInput(input: PortalPlanCreateInput): void {
  if (!input.theme || input.theme.trim().length < 2 || input.theme.trim().length > 100) {
    throw new PortalPlanningServiceError(400, "themeは2文字以上100文字以内で指定してください。");
  }
  if (input.region !== undefined && (input.region.trim().length < 1 || input.region.trim().length > 100)) {
    throw new PortalPlanningServiceError(400, "regionは100文字以内で指定してください。");
  }
  if (!contentAudiences.includes(input.audience)) throw new PortalPlanningServiceError(400, "audienceが不正です。");
  if (input.goal !== undefined && !portalPlanGoals.includes(input.goal)) throw new PortalPlanningServiceError(400, "goalが不正です。");
}

function encoded(value: string): string {
  return encodeURIComponent(value.trim());
}

function addPage(
  pages: PortalPlanPageIdea[],
  input: Omit<PortalPlanPageIdea, "internalLinks"> & { internalLinks?: string[] },
): void {
  pages.push({ ...input, internalLinks: input.internalLinks ?? [] });
}

function contentTypeForPage(pageType: PortalPlanPageIdea["pageType"]): ContentType {
  if (pageType === "jobs") return "job";
  if (pageType === "hub" || pageType === "provider_directory" || pageType === "request") return "company";
  return "blog";
}

export class PortalPlanningService {
  private readonly store: PortalPlanStore;

  public constructor(
    private readonly portal: PortalService,
    stateStore?: StateStore,
    store?: PortalPlanStore,
    private readonly content?: ContentService,
  ) {
    this.store = store ?? new PortalPlanStore(stateStore);
  }

  public create(principal: AuthenticatedPrincipal | null, input: PortalPlanCreateInput): PortalPlan {
    validateInput(input);
    this.assertProvider(principal, input.category, "portal.plan.create");
    const category = this.portal.listCategories().find((item) => item.slug === input.category);
    if (!category) throw new PortalPlanningServiceError(404, "カテゴリが見つかりません。");

    const theme = input.theme.trim();
    const region = input.region?.trim() || undefined;
    const goal = input.goal ?? "discovery";
    const experience = this.portal.getExperience(input.category, principal);
    const providers = this.portal.searchProviders(input.category, principal, { sort: "name_asc" });
    const guides = this.portal.listDirectoryGuides(input.category, principal);
    const jobs = this.portal.listJobs(input.category, principal, { status: "published" });
    const contents = this.content?.listContent(principal).filter((content) => content.status !== "archived") ?? [];
    const normalizedTheme = theme.toLocaleLowerCase("ja-JP");
    const normalizedRegion = region?.toLocaleLowerCase("ja-JP");
    const matchingContents = contents.filter((content) => {
      const searchable = [content.title, content.summary, content.seo.title, ...content.seo.keywords].join("\n").toLocaleLowerCase("ja-JP");
      return searchable.includes(normalizedTheme) && (!normalizedRegion || searchable.includes(normalizedRegion));
    });
    const publishedMatchingContents = matchingContents.filter((content) => content.status === "published");
    const categoryPath = `/categories/${input.category}`;
    const themePath = `${categoryPath}/themes/${encoded(theme)}`;
    const regionPath = region ? `${categoryPath}/regions/${encoded(region)}` : undefined;
    const directoryPath = `${categoryPath}/providers`;
    const faqPath = `${themePath}/faq`;
    const jobsPath = `${categoryPath}/jobs`;
    const requestPath = `${categoryPath}/request`;

    const pages: PortalPlanPageIdea[] = [];
    addPage(pages, {
      id: "category-hub",
      pageType: "hub",
      path: categoryPath,
      title: `${category.label}の案内ハブ`,
      purpose: "カテゴリ全体の選択肢と次の行動を整理する入口ページです。",
      primaryKeyword: category.label,
      internalLinks: ["theme-guide", "provider-directory", "faq"],
    });
    addPage(pages, {
      id: "theme-guide",
      pageType: "theme",
      path: themePath,
      title: `${theme}の選び方・基礎ガイド`,
      purpose: "検索者の疑問を解消し、事業者比較や相談へつなげます。",
      primaryKeyword: theme,
      internalLinks: ["category-hub", "provider-directory", "faq"],
    });
    addPage(pages, {
      id: "provider-directory",
      pageType: "provider_directory",
      path: directoryPath,
      title: `${theme}に対応する事業者一覧`,
      purpose: "公開確認済みの事業者を比較し、問い合わせや依頼へつなげます。",
      primaryKeyword: `${theme} 事業者`,
      internalLinks: ["category-hub", "theme-guide", ...(regionPath ? ["region-guide"] : [])],
    });
    addPage(pages, {
      id: "faq",
      pageType: "faq",
      path: faqPath,
      title: `${theme}についてのよくある質問`,
      purpose: "具体的な不安や比較前の疑問をFAQで解消します。",
      primaryKeyword: `${theme} よくある質問`,
      internalLinks: ["theme-guide", "provider-directory"],
    });
    if (regionPath) {
      addPage(pages, {
        id: "region-guide",
        pageType: "region",
        path: regionPath,
        title: `${region}の${theme}案内`,
        purpose: "地域名を含む検索意図に応え、地域の事業者一覧へ誘導します。",
        primaryKeyword: `${region} ${theme}`,
        internalLinks: ["theme-guide", "provider-directory", "faq"],
      });
    }
    if (input.audience === "candidate" || goal === "recruiting") {
      addPage(pages, {
        id: "jobs",
        pageType: "jobs",
        path: jobsPath,
        title: `${theme}の求人・キャリア案内`,
        purpose: "応募意思のある人へ求人、職場情報、応募導線を提示します。",
        primaryKeyword: `${theme} 求人`,
        internalLinks: ["category-hub", "provider-directory"],
      });
    }
    if (input.audience === "customer" || goal === "conversion") {
      addPage(pages, {
        id: "request",
        pageType: "request",
        path: requestPath,
        title: `${theme}の相談・依頼案内`,
        purpose: "検討中の人が必要情報を整理し、発注・問い合わせへ進めるページです。",
        primaryKeyword: `${theme} 相談`,
        internalLinks: ["theme-guide", "provider-directory", "faq"],
      });
    }

    const searchIntents: PortalPlanSearchIntent[] = [
      { kind: "informational", label: "基礎理解", query: `${theme}とは`, readerNeed: "概要、対象者、選ぶ前に知るべき基礎情報を知りたい。", recommendedPageId: "theme-guide" },
      { kind: "commercial", label: "比較検討", query: `${region ? `${region} ` : ""}${theme} 比較`, readerNeed: "選択肢、費用、実績、確認すべき条件を比較したい。", recommendedPageId: "provider-directory" },
      { kind: "transactional", label: "行動直前", query: `${region ? `${region} ` : ""}${theme} ${input.category === "beauty" ? "予約" : "相談"}`, readerNeed: "信頼できる相談先を見つけ、問い合わせや予約を進めたい。", recommendedPageId: input.audience === "customer" || goal === "conversion" ? "request" : "provider-directory" },
      ...(region ? [{ kind: "local" as const, label: "地域探索", query: `${region} ${theme}`, readerNeed: "指定地域で利用できる事業者やサービスを探したい。", recommendedPageId: "region-guide" }] : []),
      ...(input.audience === "candidate" || goal === "recruiting" ? [{ kind: "recruiting" as const, label: "応募検討", query: `${region ? `${region} ` : ""}${theme} 求人`, readerNeed: "仕事内容、職場、条件を確認して応募先を探したい。", recommendedPageId: "jobs" }] : []),
    ];

    const gaps: PortalPlanGap[] = [];
    if (providers.length === 0) gaps.push({ code: "provider_inventory_missing", severity: "high", message: "公開事業者が見つかりません。", recommendation: "事業者掲載情報を登録し、確認済み情報と公開状態を整えてください。" });
    else if (providers.length < 3) gaps.push({ code: "provider_coverage_low", severity: "medium", message: "比較できる公開事業者が少数です。", recommendation: "地域・テーマ別に公開事業者を追加し、比較可能性を高めてください。" });
    if (guides.length === 0) gaps.push({ code: "external_guidance_missing", severity: "medium", message: "カテゴリに紐づく外部案内がありません。", recommendation: "公式団体や業界ポータルなど、一次確認済みの外部案内を登録してください。" });
    if ((input.audience === "candidate" || goal === "recruiting") && jobs.length === 0) gaps.push({ code: "job_inventory_missing", severity: "medium", message: "公開求人がありません。", recommendation: "事業者ごとの求人情報を登録し、応募導線を確認してください。" });
    if ((goal === "regional" || Boolean(region)) && !region) gaps.push({ code: "region_not_selected", severity: "medium", message: "地域テーマなのに対象地域が未指定です。", recommendation: "都道府県、市区町村、商圏などの対象地域を指定してください。" });
    if (this.content && matchingContents.length === 0) gaps.push({ code: "content_theme_coverage_missing", severity: "high", message: "指定テーマに一致するコンテンツがありません。", recommendation: "対象ポジション向けの企画案を作成し、下書き・事実確認・SEO監査へ進めてください。" });
    else if (this.content && publishedMatchingContents.length === 0) gaps.push({ code: "content_theme_not_published", severity: "medium", message: "指定テーマに一致する公開済みコンテンツがありません。", recommendation: "一致するコンテンツを監査・承認し、BuilderOS Adapter経由で静的公開してください。" });
    gaps.push({ code: "source_fact_review", severity: "low", message: "公開ページの根拠情報と最終確認日を個別に確認する必要があります。", recommendation: "content.fact_checkとseo.auditを実行し、確認済み事実だけを公開してください。" });

    const nextActions = [
      "content.propose: 検索意図ごとの記事・FAQ企画を作成する",
      "content.draft: 対象ポジション向けの初稿を作成する",
      "content.fact_check: 公開事実と出典を確認する",
      "seo.audit: title、description、構造化データ、内部リンクを監査する",
      "publication.build: BuilderOS Adapter向け静的ページを生成する",
      ...(providers.length === 0 ? ["provider.search: 掲載可能な事業者情報を確認する"] : []),
      ...(guides.length === 0 ? ["directory.list: 外部案内の登録候補を確認する"] : []),
      ...((input.audience === "candidate" || goal === "recruiting") && jobs.length === 0 ? ["job.create: 公開求人を登録する"] : []),
      ...(this.content && matchingContents.length === 0 ? ["content.propose: 指定テーマの対象ポジション別企画を作成する"] : []),
    ];

    return this.store.create({
      category: input.category,
      providerId: principal.providerId,
      categoryLabel: category.label,
      theme,
      ...(region ? { region } : {}),
      audience: input.audience,
      goal,
      coverage: {
        providerCount: providers.length,
        externalGuideCount: guides.length,
        jobCount: jobs.length,
        contentCount: contents.length,
        publishedContentCount: contents.filter((content) => content.status === "published").length,
        matchingContentCount: matchingContents.length,
        availableModules: [...experience.visibleModules],
      },
      searchIntents,
      pageIdeas: pages,
      gaps,
      nextActions,
    });
  }

  public apply(principal: AuthenticatedPrincipal | null, planId: string): { plan: PortalPlan; proposals: ContentProposal[] } {
    const plan = this.get(principal, planId);
    if (!this.content) throw new PortalPlanningServiceError(503, "コンテンツサービスが接続されていません。");

    const existingIds = plan.appliedProposalIds ?? [];
    if (existingIds.length > 0) {
      const existing = this.content.listProposals(principal).filter((proposal) => existingIds.includes(proposal.id));
      return { plan, proposals: existing };
    }

    const proposals = plan.pageIdeas.map((page) => this.content!.createProposal(principal, {
      category: plan.category,
      contentType: contentTypeForPage(page.pageType),
      audience: page.pageType === "jobs" ? "candidate" : plan.audience,
      topic: page.title,
      primaryKeyword: page.primaryKeyword,
      relatedKeywords: [plan.theme, ...(plan.region ? [plan.region] : []), page.pageType],
      sourceFacts: [],
    }));
    const updated = this.store.update(plan.id, {
      appliedProposalIds: proposals.map((proposal) => proposal.id),
      appliedAt: new Date().toISOString(),
    });
    if (!updated) throw new PortalPlanningServiceError(404, "指定されたポータル計画が見つかりません。");
    return { plan: updated, proposals };
  }

  public list(principal: AuthenticatedPrincipal | null, pagination: { limit?: number; cursor?: number } = {}): PortalPage<PortalPlan> {
    this.assertProvider(principal, principal?.category ?? "legal", "portal.plan.read");
    const limit = pagination.limit ?? 50;
    const cursor = pagination.cursor ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new PortalPlanningServiceError(400, "limitは1〜100で指定してください。");
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new PortalPlanningServiceError(400, "cursorは0以上の整数で指定してください。");
    const items = this.store.list()
      .filter((plan) => plan.category === principal.category && plan.providerId === principal.providerId)
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
    const pageItems = items.slice(cursor, cursor + limit).map(clone);
    const nextCursor = cursor + pageItems.length < items.length ? String(cursor + pageItems.length) : undefined;
    return { items: pageItems, page: { limit, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public get(principal: AuthenticatedPrincipal | null, planId: string): PortalPlan {
    this.assertProvider(principal, principal?.category ?? "legal", "portal.plan.read");
    if (!planId.trim()) throw new PortalPlanningServiceError(400, "planIdは必須です。");
    const plan = this.store.get(planId);
    if (!plan || plan.category !== principal.category || plan.providerId !== principal.providerId) throw new PortalPlanningServiceError(404, "指定されたポータル計画が見つかりません。");
    return plan;
  }

  private assertProvider(
    principal: AuthenticatedPrincipal | null,
    category: CategorySlug,
    action: "portal.plan.create" | "portal.plan.read",
  ): asserts principal is AuthenticatedPrincipal & { role: "provider"; providerId: string } {
    if (!principal) throw new PortalPlanningServiceError(401, "ログインが必要です。");
    if (principal.role !== "provider" || !principal.providerId) throw new PortalPlanningServiceError(403, "ポータル計画は事業者のみ利用できます。");
    if (principal.category !== category) throw new PortalPlanningServiceError(403, "現在のカテゴリコンテキストが一致しません。");
    try {
      this.portal.assertAction(principal, category, action);
    } catch (error) {
      if (error instanceof PortalServiceError) throw new PortalPlanningServiceError(error.statusCode, error.message);
      if (error instanceof Error) throw new PortalPlanningServiceError(403, error.message);
      throw new PortalPlanningServiceError(403, "このロールでは操作できません。");
    }
  }
}
