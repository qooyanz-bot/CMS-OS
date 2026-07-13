import { InMemoryAuthService } from "../domain/auth.js";
import {
  listCategoryPolicies,
  listProviders,
  projectProvider,
  resolveExperience,
} from "../domain/catalog.js";
import type { AuthenticatedPrincipal, CategorySlug, PortalRole, VisibleProvider } from "../domain/types.js";

export class PortalService {
  public constructor(private readonly auth: InMemoryAuthService) {}

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
    if (!principal) throw new Error("ログインが必要です。");
    if (principal.category !== category) throw new Error("現在のカテゴリコンテキストが一致しません。");

    const experience = resolveExperience(category, principal.role, true);
    if (!experience.allowedActions.includes(action)) {
      throw new Error("このロールでは操作できません。");
    }
  }
}
