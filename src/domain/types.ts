export const portalRoles = ["user", "orderer", "provider", "candidate"] as const;

export type PortalRole = (typeof portalRoles)[number];
export type CategorySlug = "legal" | "beauty";

export interface RoleAssignment {
  role: PortalRole;
  category: CategorySlug | "*";
  organizationId?: string;
}

export interface Account {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  assignments: RoleAssignment[];
  providerId?: string;
}

export interface AuthenticatedPrincipal {
  accountId: string;
  email: string;
  displayName: string;
  category: CategorySlug;
  role: PortalRole;
  providerId?: string;
}

export interface CategoryModule {
  id: string;
  label: string;
}

export interface CategoryExperience {
  category: CategorySlug;
  categoryLabel: string;
  role: PortalRole;
  authenticated: boolean;
  navigation: CategoryModule[];
  visibleModules: string[];
  visibleFields: string[];
  allowedActions: string[];
  notices: string[];
}

export interface ProviderRecord {
  id: string;
  category: CategorySlug;
  name: string;
  themes: string[];
  location: string;
  publicFields: Record<string, string | string[]>;
  ordererFields: Record<string, string | string[]>;
  providerFields: Record<string, string | string[]>;
  candidateFields: Record<string, string | string[]>;
}

export interface VisibleProvider extends Record<string, unknown> {
  id: string;
  category: CategorySlug;
  name: string;
  themes: string[];
  location: string;
}
