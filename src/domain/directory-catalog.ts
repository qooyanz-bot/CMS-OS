import type { CategorySlug, DirectoryGuide, PortalRole } from "./types.js";

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
];

export function listDirectoryGuides(category: CategorySlug, role: PortalRole): DirectoryGuide[] {
  return directoryGuides
    .filter((guide) => guide.category === category && guide.targetRoles.includes(role))
    .map((guide) => ({ ...guide, targetRoles: [...guide.targetRoles] }));
}
