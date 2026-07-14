import { isRecruiterRole } from "./types.js";
import type {
  CategoryExperience,
  CategoryModule,
  CategorySlug,
  PortalRole,
  ProviderRecord,
  VisibleProvider,
} from "./types.js";

interface CategoryPolicy {
  slug: CategorySlug;
  label: string;
  navigation: CategoryModule[];
  themes: string[];
  roles: Record<Exclude<PortalRole, "recruiter">, Omit<CategoryExperience, "category" | "categoryLabel" | "role" | "authenticated" | "navigation">>;
}

const commonActions = [
  "profile.read",
  "provider.search",
  "favorite.manage",
  "inquiry.create",
  "inquiry.read",
  "inquiry.status.update",
  "notification.read",
  "notification.update",
];

type GenericCategorySlug = Exclude<CategorySlug, "legal" | "beauty">;

interface GenericCategoryDefinition {
  slug: GenericCategorySlug;
  label: string;
  themeLabel: string;
  themes: string[];
}

const genericCategoryDefinitions: GenericCategoryDefinition[] = [
  { slug: "ai-business", label: "生成AI・業務改革", themeLabel: "活用テーマ", themes: ["生成AI導入", "業務自動化", "社内活用"] },
  { slug: "labor-shortage", label: "人手不足・省人化", themeLabel: "省人化テーマ", themes: ["採用支援", "業務省人化", "現場改善"] },
  { slug: "tourism", label: "地域観光・インバウンド", themeLabel: "観光テーマ", themes: ["観光DX", "多言語対応", "地域体験"] },
  { slug: "mobility-dx", label: "モビリティDX・SDV", themeLabel: "DXテーマ", themes: ["車両データ", "モビリティサービス", "業務システム連携"] },
  { slug: "gx", label: "GX・省エネ・資源循環", themeLabel: "環境テーマ", themes: ["省エネ", "再エネ活用", "資源循環"] },
  { slug: "regional-revitalization", label: "地方創生・移住・空き家再生", themeLabel: "地域テーマ", themes: ["移住支援", "空き家活用", "地域事業開発"] },
];

const genericCategoryDisplayProfiles: Record<GenericCategorySlug, { user: string; orderer: string; provider: string; candidate: string }> = {
  "ai-business": { user: "aiUseCases", orderer: "automationRequest", provider: "aiSolutionManagement", candidate: "aiCareer" },
  "labor-shortage": { user: "talentGuide", orderer: "recruitmentRequest", provider: "recruitmentManagement", candidate: "careerSupport" },
  tourism: { user: "destinationGuide", orderer: "travelPlanning", provider: "tourismExperienceManagement", candidate: "hospitalityJobs" },
  "mobility-dx": { user: "mobilityGuide", orderer: "fleetRequest", provider: "fleetManagement", candidate: "mobilityCareer" },
  gx: { user: "decarbonizationGuide", orderer: "gxPlanning", provider: "gxManagement", candidate: "sustainabilityCareer" },
  "regional-revitalization": { user: "regionalGuide", orderer: "regionalProject", provider: "regionalProjectManagement", candidate: "communityCareer" },
};

function createGenericCategoryPolicy(definition: GenericCategoryDefinition): CategoryPolicy {
  const displayProfile = genericCategoryDisplayProfiles[definition.slug];
  const providerActions = [
    "profile.read",
    "profile.update",
    "listing.update",
    "listing.submit",
    "inquiry.read",
    "inquiry.status.update",
    "notification.read",
    "notification.update",
    "request.status.update",
    "application.status.update",
    "job.manage",
    "content.propose",
    "content.create",
    "content.draft",
    "content.update",
    "content.translate",
    "content.duplicate",
    "content.archive",
    "content.restore",
    "content.version_read",
    "content.version_restore",
    "content.polish",
    "content.fact_check",
    "seo.audit",
    "seo.site_audit",
    "workflow.reviews",
    "workflow.request_review",
    "workflow.request_changes",
    "workflow.approve",
    "publication.build",
    "publication.publish",
    "publication.unpublish",
    "publication.schedule",
    "publication.schedule_list",
    "publication.schedule_cancel",
    "publication.schedule_execute",
    "publication.history",
    "publication.rollback",
    "media.read",
    "media.manage",
    "webhook.read",
    "webhook.manage",
    "operation.read",
    "operation.submit",
    "portal.plan.read",
    "portal.plan.create",
    "portal.plan.apply",
    "portal.plan.draft",
  ];

  return {
    slug: definition.slug,
    label: definition.label,
    themes: definition.themes,
    navigation: [
      { id: "themes", label: definition.themeLabel },
      { id: "providers", label: "事業者を探す" },
      { id: "guides", label: "業界ガイド" },
      { id: "jobs", label: "求人" },
    ],
    roles: {
      user: {
        visibleModules: ["themeGuide", displayProfile.user, "providerSearch", "providerProfile", "faq"],
        visibleFields: ["publicFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions],
        notices: ["掲載情報は公開された事実と最終確認日を基準に表示します。"],
      },
      orderer: {
        visibleModules: [
          "themeGuide",
          displayProfile.orderer,
          "providerSearch",
          "providerProfile",
          "faq",
          "requestCase",
          "requestQuote",
          "secureMessage",
          "shortlist",
          "requestHistory",
        ],
        visibleFields: ["publicFields", "ordererFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions, "request.create", "request.message", "request.quote.read", "request.status.update"],
        notices: ["相談内容と連絡先は、依頼先として選択した事業者とのやり取りにのみ共有されます。"],
      },
      provider: {
        visibleModules: [
          displayProfile.provider,
          "providerDashboard",
          "listingManagement",
          "inquiryManagement",
          "jobManagement",
          "contentAssistant",
          "seoAssistant",
        ],
        visibleFields: ["publicFields", "providerFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: providerActions,
        notices: ["掲載情報、実績、求人、コンテンツを分けて管理し、公開前に確認できます。"],
      },
      candidate: {
        visibleModules: [displayProfile.candidate, "jobSearch", "providerProfile", "culture", "application", "applicationStatus"],
        visibleFields: ["publicFields", "candidateFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions, "job.search", "application.create", "application.read"],
        notices: ["応募書類と選考情報は、応募先事業者と本人以外には表示されません。"],
      },
    },
  };
}

const genericCategoryPolicies = Object.fromEntries(
  genericCategoryDefinitions.map((definition) => [definition.slug, createGenericCategoryPolicy(definition)]),
) as Record<GenericCategorySlug, CategoryPolicy>;

const categoryPolicies: Record<CategorySlug, CategoryPolicy> = {
  legal: {
    slug: "legal",
    label: "士業・弁護士",
    themes: ["相続", "企業法務", "契約書", "遺言", "交通事故"],
    navigation: [
      { id: "themes", label: "相談テーマ" },
      { id: "providers", label: "事業者を探す" },
      { id: "guides", label: "業界ガイド" },
      { id: "jobs", label: "求人" },
    ],
    roles: {
      user: {
        visibleModules: ["themeGuide", "providerSearch", "providerProfile", "legalDisclaimer", "faq"],
        visibleFields: ["publicFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: commonActions,
        notices: ["本サービスは法律相談そのものを提供するものではありません。"],
      },
      orderer: {
        visibleModules: [
          "themeGuide",
          "providerSearch",
          "providerProfile",
          "legalDisclaimer",
          "faq",
          "requestCase",
          "requestQuote",
          "secureMessage",
          "shortlist",
          "requestHistory",
        ],
        visibleFields: ["publicFields", "ordererFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions, "request.create", "request.message", "request.quote.read", "request.status.update"],
        notices: ["案件の詳細情報は、関係する事業者と同意済みの相手にのみ共有されます。"],
      },
      provider: {
        visibleModules: [
          "providerDashboard",
          "listingManagement",
          "inquiryManagement",
          "jobManagement",
          "contentAssistant",
          "seoAssistant",
        ],
        visibleFields: ["publicFields", "providerFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [
          "profile.read",
          "profile.update",
          "listing.update",
          "listing.submit",
          "inquiry.read",
          "inquiry.status.update",
          "notification.read",
          "notification.update",
          "request.status.update",
          "application.status.update",
          "job.manage",
          "content.propose",
          "content.create",
          "content.draft",
          "content.update",
          "content.translate",
          "content.duplicate",
          "content.archive",
          "content.restore",
          "content.version_read",
          "content.version_restore",
          "content.polish",
          "content.fact_check",
          "seo.audit",
          "seo.site_audit",
          "workflow.reviews",
          "workflow.request_review",
          "workflow.request_changes",
          "workflow.approve",
          "publication.build",
          "publication.publish",
          "publication.unpublish",
          "publication.schedule",
          "publication.schedule_list",
          "publication.schedule_cancel",
          "publication.schedule_execute",
          "publication.history",
          "publication.rollback",
          "media.read",
          "media.manage",
          "webhook.read",
          "webhook.manage",
          "operation.read",
          "operation.submit",
          "portal.plan.read",
          "portal.plan.create",
          "portal.plan.apply",
          "portal.plan.draft",
        ],
        notices: ["資格・登録情報と公開事実を分けて管理します。"],
      },
      candidate: {
        visibleModules: ["jobSearch", "providerProfile", "culture", "application", "applicationStatus"],
        visibleFields: ["publicFields", "candidateFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions, "job.search", "application.create", "application.read"],
        notices: ["応募書類と選考情報は、応募先事業者と本人以外には表示されません。"],
      },
    },
  },
  beauty: {
    slug: "beauty",
    label: "美容",
    themes: ["カット", "カラー", "縮毛矯正", "ヘアケア"],
    navigation: [
      { id: "menus", label: "メニュー" },
      { id: "providers", label: "店舗を探す" },
      { id: "styles", label: "スタイル事例" },
      { id: "jobs", label: "求人" },
    ],
    roles: {
      user: {
        visibleModules: ["menuSearch", "providerSearch", "providerProfile", "styleGallery", "faq"],
        visibleFields: ["publicFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: commonActions,
        notices: [],
      },
      orderer: {
        visibleModules: [
          "menuSearch",
          "providerSearch",
          "providerProfile",
          "styleGallery",
          "booking",
          "requestMessage",
          "bookingHistory",
        ],
        visibleFields: ["publicFields", "ordererFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions, "request.create", "booking.create", "booking.read", "booking.status.update", "request.message", "request.status.update"],
        notices: ["予約・問い合わせの個人情報は、対象店舗とのやり取りにのみ使用します。"],
      },
      provider: {
        visibleModules: [
          "providerDashboard",
          "menuManagement",
          "bookingManagement",
          "styleManagement",
          "jobManagement",
          "contentAssistant",
          "seoAssistant",
        ],
        visibleFields: ["publicFields", "providerFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [
          "profile.read",
          "profile.update",
          "listing.update",
          "listing.submit",
          "booking.read",
          "booking.status.update",
          "inquiry.read",
          "inquiry.status.update",
          "notification.read",
          "notification.update",
          "request.status.update",
          "application.status.update",
          "job.manage",
          "content.propose",
          "content.create",
          "content.draft",
          "content.update",
          "content.translate",
          "content.duplicate",
          "content.archive",
          "content.restore",
          "content.version_read",
          "content.version_restore",
          "content.polish",
          "content.fact_check",
          "seo.audit",
          "seo.site_audit",
          "workflow.reviews",
          "workflow.request_review",
          "workflow.request_changes",
          "workflow.approve",
          "publication.build",
          "publication.publish",
          "publication.unpublish",
          "publication.schedule",
          "publication.schedule_list",
          "publication.schedule_cancel",
          "publication.schedule_execute",
          "publication.history",
          "publication.rollback",
          "media.read",
          "media.manage",
          "webhook.read",
          "webhook.manage",
          "operation.read",
          "operation.submit",
          "portal.plan.read",
          "portal.plan.create",
          "portal.plan.apply",
          "portal.plan.draft",
        ],
        notices: ["店舗情報、料金、営業時間は最終確認日とともに公開します。"],
      },
      candidate: {
        visibleModules: ["jobSearch", "providerProfile", "culture", "application", "applicationStatus"],
        visibleFields: ["publicFields", "candidateFields", "verificationStatus", "lastVerifiedAt"],
        allowedActions: [...commonActions, "job.search", "application.create", "application.read"],
        notices: ["応募情報は応募先店舗と本人以外には表示されません。"],
      },
    },
  },
  ...genericCategoryPolicies,
};

function createGenericProvider(definition: GenericCategoryDefinition): ProviderRecord {
  return {
    id: `provider-${definition.slug}-demo`,
    category: definition.slug,
    name: `CMS-OS${definition.label}事業者（サンプル）`,
    themes: definition.themes,
    location: "全国",
    publicFields: {
      serviceThemes: definition.themes,
      listingStatus: "sample",
      verificationStatus: "sample",
      lastVerifiedAt: "2026-07-01",
    },
    ordererFields: {
      contactOptions: ["問い合わせ"],
      responsePolicy: "掲載準備中のサンプル情報です",
    },
    providerFields: {
      internalStatus: "掲載情報を管理できます",
      listingStatus: "sample",
    },
    candidateFields: {
      openPositions: ["募集情報を確認"],
      culture: `${definition.label}の事業づくりに関心のある人材を募集するカテゴリです`,
    },
  };
}

const genericProviders = genericCategoryDefinitions.map(createGenericProvider);

const providers: ProviderRecord[] = [
  {
    id: "provider-legal-demo",
    category: "legal",
    name: "CMS-OS法律事務所（サンプル）",
    themes: ["相続", "企業法務"],
    location: "東京都",
    publicFields: {
      practiceAreas: ["相続", "企業法務"],
      consultationMethods: ["オンライン", "来所"],
      verificationStatus: "verified",
      lastVerifiedAt: "2026-07-01",
    },
    ordererFields: {
      contactOptions: ["相談予約", "案件相談"],
      responsePolicy: "2営業日以内を目安に返信",
    },
    providerFields: {
      internalStatus: "掲載情報を管理できます",
      inquiryCount: "非公開の管理指標",
    },
    candidateFields: {
      openPositions: ["弁護士", "パラリーガル"],
      culture: "専門性とチームワークを重視",
    },
  },
  {
    id: "provider-legal-support-demo",
    category: "legal",
    name: "CMS-OS法務サポート事務所（比較用サンプル）",
    themes: ["企業法務", "契約書"],
    location: "大阪府",
    publicFields: {
      practiceAreas: ["企業法務", "契約書"],
      consultationMethods: ["オンライン", "電話"],
      verificationStatus: "verified",
      lastVerifiedAt: "2026-07-01",
    },
    ordererFields: {
      contactOptions: ["見積もり相談", "初回相談"],
      responsePolicy: "営業日以内に返信するサンプル情報です。",
    },
    providerFields: {
      internalStatus: "掲載情報を管理できます。",
      inquiryCount: "非公開の管理指標サンプルです。",
    },
    candidateFields: {
      openPositions: ["法務スタッフ"],
      culture: "チームで企業支援に取り組むサンプル情報です。",
    },
  },
  {
    id: "provider-beauty-demo",
    category: "beauty",
    name: "CMS-OS美容室（サンプル）",
    themes: ["カット", "カラー", "縮毛矯正"],
    location: "大阪府",
    publicFields: {
      menu: ["カット", "カラー", "縮毛矯正"],
      priceRange: "6,000円〜",
      openingHours: "10:00〜19:00",
      verificationStatus: "verified",
      lastVerifiedAt: "2026-07-01",
    },
    ordererFields: {
      contactOptions: ["予約", "メニュー相談"],
      responsePolicy: "営業時間内に順次返信",
    },
    providerFields: {
      internalStatus: "掲載情報を管理できます",
      bookingCount: "非公開の管理指標",
    },
    candidateFields: {
      openPositions: ["スタイリスト", "アシスタント"],
      culture: "技術研修と長期的なキャリア形成を重視",
    },
  },
  {
    id: "provider-beauty-support-demo",
    category: "beauty",
    name: "CMS-OS美容室（比較用サンプル）",
    themes: ["カラー", "ヘアケア"],
    location: "東京都",
    publicFields: {
      menu: ["カラー", "ヘアケア"],
      priceRange: "8,000円〜",
      openingHours: "11:00〜20:00",
      verificationStatus: "verified",
      lastVerifiedAt: "2026-07-01",
    },
    ordererFields: {
      contactOptions: ["予約相談", "メニュー相談"],
      responsePolicy: "営業時間内に返信するサンプル情報です。",
    },
    providerFields: {
      internalStatus: "掲載情報を管理できます。",
      bookingCount: "非公開の管理指標サンプルです。",
    },
    candidateFields: {
      openPositions: ["スタイリスト"],
      culture: "技術研修とチームワークを重視するサンプル情報です。",
    },
  },
  ...genericProviders,
];

export function getCategoryPolicy(category: CategorySlug): CategoryPolicy {
  return categoryPolicies[category];
}

export function listCategoryPolicies(): CategoryPolicy[] {
  return Object.values(categoryPolicies);
}

export function listProviders(category: CategorySlug): ProviderRecord[] {
  return providers.filter((provider) => provider.category === category);
}

const providerNavigationLabels: Record<string, string> = {
  providerDashboard: "事業者ダッシュボード",
  listingManagement: "掲載情報管理",
  inquiryManagement: "問い合わせ管理",
  menuManagement: "メニュー管理",
  bookingManagement: "予約管理",
  styleManagement: "スタイル管理",
  jobManagement: "求人管理",
  contentAssistant: "AIコンテンツ編集",
  seoAssistant: "SEOアシスタント",
};

function resolveRoleNavigation(
  policy: CategoryPolicy,
  role: PortalRole,
  visibleModules: string[],
  allowedActions: string[],
): CategoryModule[] {
  const baseNavigation = new Map(policy.navigation.map((module) => [module.id, module]));
  const navigation: CategoryModule[] = [];
  const addBase = (ids: string[]): void => {
    for (const id of ids) {
      const module = baseNavigation.get(id);
      if (module && !navigation.some((item) => item.id === id)) navigation.push({ ...module });
    }
  };
  const add = (id: string, label: string): void => {
    if (!navigation.some((item) => item.id === id)) navigation.push({ id, label });
  };

  if (role === "provider") {
    for (const module of policy.navigation) {
      if (visibleModules.includes(module.id)) add(module.id, module.label);
    }
    for (const moduleId of [
      "providerDashboard",
      "listingManagement",
      "inquiryManagement",
      "menuManagement",
      "bookingManagement",
      "styleManagement",
      "jobManagement",
      "contentAssistant",
      "seoAssistant",
    ]) {
      if (visibleModules.includes(moduleId)) add(moduleId, providerNavigationLabels[moduleId] ?? moduleId);
    }
  } else if (isRecruiterRole(role)) {
    addBase(["jobs", "providers", "guides", "styles"]);
    if (visibleModules.includes("application") || visibleModules.includes("applicationStatus")) add("applications", "応募");
  } else {
    addBase(["themes", "menus", "providers", "guides", "styles"]);
    if (allowedActions.includes("request.create")) add("requests", "依頼");
    if (allowedActions.includes("booking.create")) add("bookings", "予約");
    if (visibleModules.includes("jobSearch")) addBase(["jobs"]);
  }

  return navigation.length > 0 ? navigation : policy.navigation.map((module) => ({ ...module }));
}

export function resolveExperience(
  category: CategorySlug,
  role: PortalRole,
  authenticated: boolean,
): CategoryExperience {
  const policy = getCategoryPolicy(category);
  const normalizedRole: PortalRole = role === "candidate" ? "recruiter" : role;
  const policyRole: Exclude<PortalRole, "recruiter"> = normalizedRole === "recruiter" ? "candidate" : normalizedRole;
  const rolePolicy = policy.roles[policyRole];

  return {
    category,
    categoryLabel: policy.label,
    role: normalizedRole,
    authenticated,
    navigation: resolveRoleNavigation(policy, normalizedRole, rolePolicy.visibleModules, rolePolicy.allowedActions),
    visibleModules: rolePolicy.visibleModules,
    visibleFields: rolePolicy.visibleFields,
    allowedActions: authenticated ? rolePolicy.allowedActions : ["profile.read", "provider.search"],
    notices: rolePolicy.notices,
  };
}

export function projectProvider(
  provider: ProviderRecord,
  role: PortalRole,
  accountProviderId?: string,
): VisibleProvider {
  const projected: VisibleProvider = {
    id: provider.id,
    category: provider.category,
    name: provider.name,
    themes: provider.themes,
    location: provider.location,
  };

  Object.assign(projected, provider.publicFields);

  if (role === "orderer") {
    Object.assign(projected, provider.ordererFields);
  }

  if (isRecruiterRole(role)) {
    Object.assign(projected, provider.candidateFields);
  }

  if (role === "provider" && accountProviderId === provider.id) {
    Object.assign(projected, provider.providerFields);
    projected.listingStatus = provider.listingStatus ?? "published";
    if (provider.listingSubmittedAt) projected.listingSubmittedAt = provider.listingSubmittedAt;
    if (provider.listingReviewedAt) projected.listingReviewedAt = provider.listingReviewedAt;
    if (provider.listingReviewNote) projected.listingReviewNote = provider.listingReviewNote;
  }

  return projected;
}
