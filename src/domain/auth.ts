import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Account, AuthenticatedPrincipal, CategorySlug, PortalRole } from "./types.js";

interface Session {
  tokenHash: string;
  accountId: string;
  category: CategorySlug;
  role: PortalRole;
  expiresAt: number;
}

const sessionLifetimeMs = 30 * 60 * 1000;

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;

  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hasAssignment(account: Account, category: CategorySlug, role: PortalRole): boolean {
  return account.assignments.some(
    (assignment) => assignment.role === role && (assignment.category === "*" || assignment.category === category),
  );
}

export class InMemoryAuthService {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, Session>();

  public constructor() {
    const passwordHash = createPasswordHash("demo-password");
    const allCategories = { role: "user" as const, category: "*" as const };

    this.addAccount({
      id: "account-user-demo",
      email: "user@example.com",
      passwordHash,
      displayName: "一般ユーザー（サンプル）",
      assignments: [allCategories],
    });
    this.addAccount({
      id: "account-orderer-demo",
      email: "orderer@example.com",
      passwordHash,
      displayName: "発注者（サンプル）",
      assignments: [allCategories, { role: "orderer", category: "legal" }, { role: "orderer", category: "beauty" }],
    });
    this.addAccount({
      id: "account-legal-provider-demo",
      email: "lawyer@example.com",
      passwordHash,
      displayName: "士業事業者（サンプル）",
      providerId: "provider-legal-demo",
      assignments: [allCategories, { role: "provider", category: "legal" }],
    });
    this.addAccount({
      id: "account-beauty-provider-demo",
      email: "beauty@example.com",
      passwordHash,
      displayName: "美容事業者（サンプル）",
      providerId: "provider-beauty-demo",
      assignments: [allCategories, { role: "provider", category: "beauty" }],
    });
    this.addAccount({
      id: "account-candidate-demo",
      email: "candidate@example.com",
      passwordHash,
      displayName: "リクルーター（サンプル）",
      assignments: [allCategories, { role: "candidate", category: "legal" }, { role: "candidate", category: "beauty" }],
    });
  }

  private addAccount(account: Account): void {
    this.accounts.set(account.id, account);
  }

  public login(email: string, password: string, category: CategorySlug, role: PortalRole = "user"):
    | { accessToken: string; principal: AuthenticatedPrincipal; expiresInSeconds: number }
    | null {
    const account = [...this.accounts.values()].find((candidate) => candidate.email === email);
    if (!account || !verifyPassword(password, account.passwordHash) || !hasAssignment(account, category, role)) {
      return null;
    }

    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + sessionLifetimeMs;
    this.sessions.set(hashToken(accessToken), {
      tokenHash: hashToken(accessToken),
      accountId: account.id,
      category,
      role,
      expiresAt,
    });

    return {
      accessToken,
      principal: this.toPrincipal(account, category, role),
      expiresInSeconds: sessionLifetimeMs / 1000,
    };
  }

  public authenticate(accessToken: string | undefined): AuthenticatedPrincipal | null {
    if (!accessToken) return null;

    const session = this.sessions.get(hashToken(accessToken));
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(session.tokenHash);
      return null;
    }

    const account = this.accounts.get(session.accountId);
    return account ? this.toPrincipal(account, session.category, session.role) : null;
  }

  public switchContext(
    accessToken: string,
    category: CategorySlug,
    role: PortalRole,
  ): AuthenticatedPrincipal | null {
    const session = this.sessions.get(hashToken(accessToken));
    if (!session || session.expiresAt <= Date.now()) return null;

    const account = this.accounts.get(session.accountId);
    if (!account || !hasAssignment(account, category, role)) return null;

    session.category = category;
    session.role = role;
    return this.toPrincipal(account, category, role);
  }

  public logout(accessToken: string | undefined): void {
    if (accessToken) this.sessions.delete(hashToken(accessToken));
  }

  private toPrincipal(account: Account, category: CategorySlug, role: PortalRole): AuthenticatedPrincipal {
    return {
      accountId: account.id,
      email: account.email,
      displayName: account.displayName,
      category,
      role,
      ...(account.providerId ? { providerId: account.providerId } : {}),
    };
  }
}
