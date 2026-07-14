import { isRecruiterRole, type CategorySlug, type DirectoryGuide, type PortalRole } from "./types.js";

const directoryGuides: DirectoryGuide[] = [
  {
    id: "directory-legal-bengo4",
    category: "legal",
    name: "弁護士ドットコム",
    kind: "directory",
    description: "法律相談や弁護士を探すときの外部検索・相談案内です。",
    url: "https://www.bengo4.com/",
    targetRoles: ["user", "orderer"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-beauty-hotpepper",
    category: "beauty",
    name: "ホットペッパービューティー",
    kind: "booking",
    description: "美容院・美容室・ヘアサロンを検索・予約するときの外部案内です。",
    url: "https://beauty.hotpepper.jp/",
    targetRoles: ["user", "orderer"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-beauty-hotpepper-provider",
    category: "beauty",
    name: "ホットペッパービューティー掲載案内",
    kind: "provider_resource",
    description: "美容サロン事業者向けの掲載・料金案内です。",
    url: "https://beauty.hotpepper.jp/doc/keisai/keisai.html",
    targetRoles: ["provider"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-ai-business-digital-ai-subsidy",
    category: "ai-business",
    name: "デジタル化・AI導入補助金",
    kind: "provider_resource",
    description: "AI・ITツール導入を検討する中小企業向けの公的支援案内です。",
    url: "https://it-shien.smrj.go.jp/",
    targetRoles: ["user", "orderer", "provider"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-labor-shortage-hellowork",
    category: "labor-shortage",
    name: "ハローワークインターネットサービス",
    kind: "directory",
    description: "求人・求職情報を探すときの公的な雇用案内です。",
    url: "https://www.hellowork.mhlw.go.jp/",
    targetRoles: ["user", "orderer", "provider", "candidate"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-tourism-jnto",
    category: "tourism",
    name: "日本政府観光局（JNTO）",
    kind: "provider_resource",
    description: "訪日インバウンドや観光振興に関する公的な情報案内です。",
    url: "https://www.jnto.go.jp/",
    targetRoles: ["user", "orderer", "provider"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-mobility-dx-meti",
    category: "mobility-dx",
    name: "モビリティDX戦略・検討会",
    kind: "provider_resource",
    description: "経済産業省のモビリティDX・SDVに関する政策情報です。",
    url: "https://www.meti.go.jp/policy/mono_info_service/mono/automobile/jido_soko/index.html",
    targetRoles: ["user", "orderer", "provider"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-gx-carbon-neutral",
    category: "gx",
    name: "脱炭素ポータル",
    kind: "provider_resource",
    description: "環境省の脱炭素・GXに関する制度と支援情報です。",
    url: "https://ondankataisaku.env.go.jp/carbon_neutral/",
    targetRoles: ["user", "orderer", "provider"],
    verifiedAt: "2026-07-14",
  },
  {
    id: "directory-regional-join",
    category: "regional-revitalization",
    name: "ニッポン移住・交流ナビ JOIN",
    kind: "directory",
    description: "移住、地域交流、自治体支援制度、空き家などの地域案内です。",
    url: "https://www.iju-join.jp/",
    targetRoles: ["user", "orderer", "candidate"],
    verifiedAt: "2026-07-14",
  },
];

export function listAllDirectoryGuides(): DirectoryGuide[] {
  return directoryGuides.map((guide) => ({ ...guide, targetRoles: [...guide.targetRoles] }));
}

export function listDirectoryGuides(category: CategorySlug, role: PortalRole): DirectoryGuide[] {
  const visibleRoles: PortalRole[] = isRecruiterRole(role) ? ["candidate", "recruiter"] : [role];
  return listAllDirectoryGuides()
    .filter((guide) => guide.category === category && visibleRoles.some((targetRole) => guide.targetRoles.includes(targetRole)));
}
