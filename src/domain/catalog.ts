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
  roles: Record<PortalRole, Omit<CategoryExperience, "category" | "categoryLabel" | "role" | "authenticated" | "navigation">>;
}

const commonActions = ["profile.read", "provider.search", "favorite.manage"];

const categoryPolicies: Record<CategorySlug, CategoryPolicy> = {
  legal: {
    slug: "legal",
    label: "士業・弁護士",
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
        allowedActions: [...commonActions, "request.create", "request.message", "request.quote.read"],
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
          "inquiry.read",
          "job.manage",
          "content.propose",
          "content.draft",
          "content.polish",
          "content.fact_check",
          "seo.audit",
          "workflow.approve",
          "publication.build",
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
        allowedActions: [...commonActions, "request.create", "booking.create", "request.message", "booking.read"],
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
          "booking.read",
          "job.manage",
          "content.propose",
          "content.draft",
          "content.polish",
          "content.fact_check",
          "seo.audit",
          "workflow.approve",
          "publication.build",
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
};

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

export function resolveExperience(
  category: CategorySlug,
  role: PortalRole,
  authenticated: boolean,
): CategoryExperience {
  const policy = getCategoryPolicy(category);
  const rolePolicy = policy.roles[role];

  return {
    category,
    categoryLabel: policy.label,
    role,
    authenticated,
    navigation: policy.navigation,
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

  if (role === "candidate") {
    Object.assign(projected, provider.candidateFields);
  }

  if (role === "provider" && accountProviderId === provider.id) {
    Object.assign(projected, provider.providerFields);
  }

  return projected;
}
