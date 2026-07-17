import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  categorySlugs,
  contextRoles,
  isRecruiterRole,
  type Account,
  type AuthenticatedPrincipal,
  type AuthContextOption,
  type CategorySlug,
  type PortalRole,
} from "./types.js";
import type { StateStore } from "../infrastructure/json-state-store.js";
import { createTotpUri, generateTotpSecret, verifyTotp } from "../security/totp.js";
import { openSecret, sealSecret } from "../security/secret-box.js";
import { StateAuditLogger, type AuditLogger, type AuditOutcome } from "../security/audit-log.js";

interface Session {
  tokenHash: string;
  accountId: string;
  category: CategorySlug;
  role: PortalRole;
  expiresAt: number;
}

interface OidcTransaction {
  stateHash: string;
  codeVerifier: string;
  category: CategorySlug;
  role: PortalRole;
  expiresAt: number;
}

interface MfaChallenge {
  tokenHash: string;
  accountId: string;
  category: CategorySlug;
  role: PortalRole;
  expiresAt: number;
  attempts: number;
}

interface MfaEnrollment {
  accountId: string;
  secretCiphertext: string;
  expiresAt: number;
}

interface OidcProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

interface AuditDetails {
  accountId?: string;
  category?: CategorySlug;
  role?: PortalRole;
  reason?: string;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
  autoProvisionUsers?: boolean;
  requireMfa?: boolean;
}

export interface AuthServiceOptions {
  allowDemoAccounts?: boolean;
  allowPasswordLogin?: boolean;
  oidc?: OidcConfig;
  fetchImplementation?: typeof fetch;
  authEncryptionKey?: string;
  auditLogger?: AuditLogger;
}

export interface AuthCapabilities {
  passwordLogin: boolean;
  oidcLogin: boolean;
  mfaEnrollment: boolean;
}

export type LoginResult =
  | { accessToken: string; principal: AuthenticatedPrincipal; expiresInSeconds: number }
  | { mfaRequired: true; mfaChallengeToken: string; expiresInSeconds: number };

export interface AuthService {
  getAuthCapabilities(): AuthCapabilities;
  login(email: string, password: string, category: CategorySlug, role?: PortalRole): LoginResult | null;
  authenticate(accessToken: string | undefined): AuthenticatedPrincipal | null;
  switchContext(accessToken: string, category: CategorySlug, role: PortalRole): AuthenticatedPrincipal | null;
  logout(accessToken: string | undefined): void;
  startOidc(category: CategorySlug, role?: PortalRole): Promise<{ authorizationUrl: string; state: string; expiresInSeconds: number }>;
  completeOidc(state: string, code: string): Promise<LoginResult>;
  enrollMfa(accessToken: string | undefined): { secret: string; otpauthUrl: string; expiresInSeconds: number };
  confirmMfaEnrollment(accessToken: string | undefined, code: string): { enabled: true };
  completeMfa(challengeToken: string, code: string): LoginResult;
}

export class AuthServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "AuthServiceError";
  }
}

const sessionLifetimeMs = 30 * 60 * 1000;
const oidcTransactionLifetimeMs = 10 * 60 * 1000;
const mfaChallengeLifetimeMs = 5 * 60 * 1000;
const mfaEnrollmentLifetimeMs = 10 * 60 * 1000;
const maxMfaAttempts = 5;

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false;
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;

  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const dummyPasswordHash = createPasswordHash("cms-os-invalid-password-dummy");

function hasAssignment(account: Account, category: CategorySlug, role: PortalRole): boolean {
  return account.assignments.some(
    (assignment) =>
      (assignment.role === role || (isRecruiterRole(assignment.role) && isRecruiterRole(role))) &&
      (assignment.category === "*" || assignment.category === category),
  );
}

function listAvailableContexts(account: Account): AuthContextOption[] {
  return categorySlugs.flatMap((category) => {
    const roles = contextRoles.filter((role) => hasAssignment(account, category, role));
    return roles.length > 0 ? [{ category, roles: [...roles] }] : [];
  });
}

function normalizeIssuer(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("OIDC issuerはHTTPSで指定してください。");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new AuthServiceError(500, "OIDC issuerの設定が不正です。");
  }
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class InMemoryAuthService implements AuthService {
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, Session>();
  private readonly oidcTransactions = new Map<string, OidcTransaction>();
  private readonly mfaChallenges = new Map<string, MfaChallenge>();
  private readonly mfaEnrollments = new Map<string, MfaEnrollment>();
  private readonly allowDemoAccounts: boolean;
  private readonly allowPasswordLogin: boolean;
  private readonly oidcConfig: OidcConfig | undefined;
  private readonly fetchImplementation: typeof fetch;
  private readonly authEncryptionKey: string | undefined;
  private readonly auditLogger: AuditLogger | undefined;
  private oidcMetadata?: OidcProviderMetadata;

  public constructor(private readonly stateStore?: StateStore, options: AuthServiceOptions = {}) {
    this.allowDemoAccounts = options.allowDemoAccounts ?? true;
    this.allowPasswordLogin = options.allowPasswordLogin ?? true;
    this.oidcConfig = options.oidc;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.authEncryptionKey = options.authEncryptionKey;
    this.auditLogger = options.auditLogger ?? (stateStore ? new StateAuditLogger(stateStore) : undefined);
    const storedAccounts = stateStore?.load<Account[]>("auth-accounts.json", []) ?? [];
    if (storedAccounts.length > 0) {
      storedAccounts.forEach((account) => this.addAccount(account));
    } else if (this.allowDemoAccounts) {
      const passwordHash = createPasswordHash("demo-password");
      const allUserCategories = { role: "user" as const, category: "*" as const };
      const allOrdererCategories = { role: "orderer" as const, category: "*" as const };
      const allCandidateCategories = { role: "candidate" as const, category: "*" as const };

      this.addAccount({
        id: "account-user-demo",
        email: "user@example.com",
        passwordHash,
        displayName: "一般ユーザー（サンプル）",
        assignments: [allUserCategories],
      });
      this.addAccount({
        id: "account-orderer-demo",
        email: "orderer@example.com",
        passwordHash,
        displayName: "発注者（サンプル）",
        assignments: [allUserCategories, allOrdererCategories],
      });
      this.addAccount({
        id: "account-legal-provider-demo",
        email: "lawyer@example.com",
        passwordHash,
        displayName: "士業事業者（サンプル）",
        providerId: "provider-legal-demo",
        assignments: [allUserCategories, { role: "provider", category: "legal" }],
      });
      this.addAccount({
        id: "account-beauty-provider-demo",
        email: "beauty@example.com",
        passwordHash,
        displayName: "美容事業者（サンプル）",
        providerId: "provider-beauty-demo",
        assignments: [allUserCategories, { role: "provider", category: "beauty" }],
      });
      const genericProviderDemos = [
        ["ai-business", "ai-business@example.com", "生成AI事業者（サンプル）", "provider-ai-business-demo"],
        ["labor-shortage", "labor-shortage@example.com", "人手不足対策事業者（サンプル）", "provider-labor-shortage-demo"],
        ["tourism", "tourism@example.com", "観光事業者（サンプル）", "provider-tourism-demo"],
        ["mobility-dx", "mobility-dx@example.com", "モビリティDX事業者（サンプル）", "provider-mobility-dx-demo"],
        ["gx", "gx@example.com", "GX事業者（サンプル）", "provider-gx-demo"],
        ["regional-revitalization", "regional@example.com", "地方創生事業者（サンプル）", "provider-regional-revitalization-demo"],
      ] as const;
      genericProviderDemos.forEach(([category, email, displayName, providerId]) => {
        this.addAccount({
          id: `account-${category}-provider-demo`,
          email,
          passwordHash,
          displayName,
          providerId,
          assignments: [allUserCategories, { role: "provider", category }],
        });
      });
      this.addAccount({
        id: "account-candidate-demo",
        email: "candidate@example.com",
        passwordHash,
        displayName: "リクルーター（サンプル）",
        assignments: [allUserCategories, allCandidateCategories],
      });
      this.persistAccounts();
    }

    const sessions = stateStore?.load<Session[]>("auth-sessions.json", []) ?? [];
    for (const session of sessions) {
      if (session.expiresAt > Date.now() && this.accounts.has(session.accountId)) this.sessions.set(session.tokenHash, session);
    }
    const oidcTransactions = stateStore?.load<OidcTransaction[]>("auth-oidc-transactions.json", []) ?? [];
    for (const transaction of oidcTransactions) {
      if (transaction.expiresAt > Date.now()) this.oidcTransactions.set(transaction.stateHash, transaction);
    }
    const mfaChallenges = stateStore?.load<MfaChallenge[]>("auth-mfa-challenges.json", []) ?? [];
    for (const challenge of mfaChallenges) {
      if (challenge.expiresAt > Date.now() && this.accounts.has(challenge.accountId)) this.mfaChallenges.set(challenge.tokenHash, challenge);
    }
    const mfaEnrollments = stateStore?.load<MfaEnrollment[]>("auth-mfa-enrollments.json", []) ?? [];
    for (const enrollment of mfaEnrollments) {
      if (enrollment.expiresAt > Date.now() && this.accounts.has(enrollment.accountId)) this.mfaEnrollments.set(enrollment.accountId, enrollment);
    }
  }

  private addAccount(account: Account): void {
    this.accounts.set(account.id, account);
  }

  public getAuthCapabilities(): AuthCapabilities {
    return {
      passwordLogin: this.allowPasswordLogin,
      oidcLogin: Boolean(this.oidcConfig),
      mfaEnrollment: Boolean(this.authEncryptionKey),
    };
  }

  public login(email: string, password: string, category: CategorySlug, role: PortalRole = "user"): LoginResult | null {
    if (!this.allowPasswordLogin) {
      this.recordAudit("auth.login", "failure", { category, role, reason: "password_login_disabled" });
      return null;
    }
    const account = [...this.accounts.values()].find((candidate) => candidate.email === email);
    const passwordMatches = verifyPassword(password, account?.passwordHash ?? dummyPasswordHash);
    if (!account || !passwordMatches || !hasAssignment(account, category, role)) {
      this.recordAudit("auth.login", "failure", {
        ...(account ? { accountId: account.id } : {}),
        category,
        role,
        reason: "invalid_credentials_or_assignment",
      });
      return null;
    }

    const result = this.startAuthenticatedSession(account, category, role);
    this.recordAudit("auth.login", "success", {
      accountId: account.id,
      category,
      role,
      ...(this.isMfaChallenge(result) ? { reason: "mfa_challenge" } : {}),
    });
    return result;
  }

  private issueSession(account: Account, category: CategorySlug, role: PortalRole): LoginResult {
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + sessionLifetimeMs;
    this.sessions.set(hashToken(accessToken), {
      tokenHash: hashToken(accessToken),
      accountId: account.id,
      category,
      role,
      expiresAt,
    });
    this.persistSessions();

    return {
      accessToken,
      principal: this.toPrincipal(account, category, role),
      expiresInSeconds: sessionLifetimeMs / 1000,
    };
  }

  private startAuthenticatedSession(account: Account, category: CategorySlug, role: PortalRole): LoginResult {
    if (!account.mfaEnabled) return this.issueSession(account, category, role);
    const challengeToken = randomBytes(32).toString("base64url");
    this.mfaChallenges.set(hashToken(challengeToken), {
      tokenHash: hashToken(challengeToken),
      accountId: account.id,
      category,
      role,
      expiresAt: Date.now() + mfaChallengeLifetimeMs,
      attempts: 0,
    });
    this.persistMfaChallenges();
    this.recordAudit("auth.mfa.challenge", "success", { accountId: account.id, category, role });
    return {
      mfaRequired: true,
      mfaChallengeToken: challengeToken,
      expiresInSeconds: mfaChallengeLifetimeMs / 1000,
    };
  }

  public enrollMfa(accessToken: string | undefined): { secret: string; otpauthUrl: string; expiresInSeconds: number } {
    const principal = this.requirePrincipal(accessToken);
    const account = this.accounts.get(principal.accountId);
    if (!account) throw new AuthServiceError(401, "認証対象のアカウントが見つかりません。");
    if (account.mfaEnabled) throw new AuthServiceError(409, "MFAはすでに有効です。");
    if (!this.authEncryptionKey) throw new AuthServiceError(503, "MFA暗号化キーが設定されていません。");

    const secret = generateTotpSecret();
    this.mfaEnrollments.set(account.id, {
      accountId: account.id,
      secretCiphertext: sealSecret(secret, this.authEncryptionKey),
      expiresAt: Date.now() + mfaEnrollmentLifetimeMs,
    });
    this.persistMfaEnrollments();
    this.recordAudit("auth.mfa.enroll", "success", { accountId: account.id, category: principal.category, role: principal.role });
    return {
      secret,
      otpauthUrl: createTotpUri(secret, "CMS-OS", account.email),
      expiresInSeconds: mfaEnrollmentLifetimeMs / 1000,
    };
  }

  public confirmMfaEnrollment(accessToken: string | undefined, code: string): { enabled: true } {
    const principal = this.requirePrincipal(accessToken);
    const enrollment = this.mfaEnrollments.get(principal.accountId);
    if (!enrollment || enrollment.expiresAt <= Date.now()) {
      this.mfaEnrollments.delete(principal.accountId);
      this.persistMfaEnrollments();
      this.recordAudit("auth.mfa.enroll_confirm", "failure", { accountId: principal.accountId, reason: "enrollment_expired" });
      throw new AuthServiceError(409, "MFA登録の有効期限が切れています。再登録してください。");
    }
    const secret = this.openMfaSecret(enrollment.secretCiphertext);
    if (!verifyTotp(secret, code)) {
      this.recordAudit("auth.mfa.enroll_confirm", "failure", { accountId: principal.accountId, reason: "invalid_code" });
      throw new AuthServiceError(400, "MFA認証コードが正しくありません。");
    }

    const account = this.accounts.get(principal.accountId);
    if (!account) throw new AuthServiceError(401, "認証対象のアカウントが見つかりません。");
    account.mfaEnabled = true;
    account.mfaSecretCiphertext = enrollment.secretCiphertext;
    this.mfaEnrollments.delete(principal.accountId);
    this.persistAccounts();
    this.persistMfaEnrollments();
    this.recordAudit("auth.mfa.enroll_confirm", "success", { accountId: principal.accountId });
    return { enabled: true };
  }

  public completeMfa(challengeToken: string, code: string): LoginResult {
    const tokenHash = hashToken(challengeToken);
    const challenge = this.mfaChallenges.get(tokenHash);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      if (challenge) this.mfaChallenges.delete(tokenHash);
      this.persistMfaChallenges();
      this.recordAudit("auth.mfa.complete", "failure", {
        ...(challenge ? { accountId: challenge.accountId, category: challenge.category, role: challenge.role } : {}),
        reason: "challenge_expired_or_unknown",
      });
      throw new AuthServiceError(401, "MFAチャレンジが無効または期限切れです。");
    }
    const account = this.accounts.get(challenge.accountId);
    if (!account || !account.mfaEnabled || !account.mfaSecretCiphertext) {
      this.mfaChallenges.delete(tokenHash);
      this.persistMfaChallenges();
      this.recordAudit("auth.mfa.complete", "failure", { accountId: challenge.accountId, reason: "mfa_configuration_missing" });
      throw new AuthServiceError(401, "MFA設定が見つかりません。");
    }
    const secret = this.openMfaSecret(account.mfaSecretCiphertext);
    if (!verifyTotp(secret, code)) {
      challenge.attempts += 1;
      if (challenge.attempts >= maxMfaAttempts) this.mfaChallenges.delete(tokenHash);
      this.persistMfaChallenges();
      this.recordAudit("auth.mfa.complete", "failure", {
        accountId: challenge.accountId,
        category: challenge.category,
        role: challenge.role,
        reason: challenge.attempts >= maxMfaAttempts ? "invalid_code_attempt_limit" : "invalid_code",
      });
      throw new AuthServiceError(401, "MFA認証コードが正しくありません。");
    }

    this.mfaChallenges.delete(tokenHash);
    this.persistMfaChallenges();
    const result = this.issueSession(account, challenge.category, challenge.role);
    this.recordAudit("auth.mfa.complete", "success", { accountId: account.id, category: challenge.category, role: challenge.role });
    return result;
  }

  private requirePrincipal(accessToken: string | undefined): AuthenticatedPrincipal {
    const principal = this.authenticate(accessToken);
    if (!principal) throw new AuthServiceError(401, "ログインが必要です。");
    return principal;
  }

  private openMfaSecret(ciphertext: string): string {
    if (!this.authEncryptionKey) throw new AuthServiceError(503, "MFA暗号化キーが設定されていません。");
    try {
      return openSecret(ciphertext, this.authEncryptionKey);
    } catch {
      throw new AuthServiceError(503, "MFAシークレットを復号できません。");
    }
  }

  public async startOidc(category: CategorySlug, role: PortalRole = "user"): Promise<{ authorizationUrl: string; state: string; expiresInSeconds: number }> {
    const config = this.requireOidcConfig();
    const metadata = await this.getOidcMetadata(config);
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    this.oidcTransactions.set(hashToken(state), {
      stateHash: hashToken(state),
      codeVerifier,
      category,
      role,
      expiresAt: Date.now() + oidcTransactionLifetimeMs,
    });
    this.persistOidcTransactions();
    this.recordAudit("auth.oidc.start", "success", { category, role });

    const authorizationUrl = new URL(metadata.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: (config.scopes ?? ["openid", "profile", "email"]).join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return { authorizationUrl: authorizationUrl.toString(), state, expiresInSeconds: oidcTransactionLifetimeMs / 1000 };
  }

  public async completeOidc(state: string, code: string): Promise<LoginResult> {
    if (!state || !code) throw new AuthServiceError(400, "OIDC callbackにはstateとcodeが必要です。");
    const config = this.requireOidcConfig();
    const stateHash = hashToken(state);
    const transaction = this.oidcTransactions.get(stateHash);
    if (!transaction || transaction.expiresAt <= Date.now()) {
      if (transaction) this.oidcTransactions.delete(stateHash);
      this.persistOidcTransactions();
      this.recordAudit("auth.oidc.complete", "failure", { reason: "state_expired_or_unknown" });
      throw new AuthServiceError(400, "OIDC認証stateが無効または期限切れです。");
    }
    this.oidcTransactions.delete(stateHash);
    this.persistOidcTransactions();

    const metadata = await this.getOidcMetadata(config);
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: transaction.codeVerifier,
    });
    if (config.clientSecret) tokenBody.set("client_secret", config.clientSecret);
    const tokenResponse = await this.requestOidcJson<Record<string, unknown>>(metadata.token_endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    }, 502);
    const accessToken = stringClaim(tokenResponse.access_token);
    if (!accessToken) throw new AuthServiceError(502, "OIDC token responseにaccess_tokenがありません。");
    if (!metadata.userinfo_endpoint) throw new AuthServiceError(502, "OIDC userinfo_endpointが設定されていません。");

    const claims = await this.requestOidcJson<Record<string, unknown>>(metadata.userinfo_endpoint, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    }, 502);
    const subject = stringClaim(claims.sub);
    const email = stringClaim(claims.email)?.toLowerCase();
    if (!subject || !email) {
      this.recordAudit("auth.oidc.complete", "failure", { category: transaction.category, role: transaction.role, reason: "identity_claim_missing" });
      throw new AuthServiceError(403, "OIDCから必要な本人情報を取得できませんでした。");
    }
    if (claims.email_verified === false) {
      this.recordAudit("auth.oidc.complete", "failure", { category: transaction.category, role: transaction.role, reason: "email_unverified" });
      throw new AuthServiceError(403, "OIDCメールアドレスが未検証です。");
    }
    if (config.requireMfa && !this.hasExternalMfa(claims)) {
      this.recordAudit("auth.oidc.complete", "failure", { category: transaction.category, role: transaction.role, reason: "external_mfa_required" });
      throw new AuthServiceError(403, "MFA済みのOIDC認証が必要です。");
    }

    const account = this.findOrProvisionOidcAccount(config, subject, email, claims);
    if (!hasAssignment(account, transaction.category, transaction.role)) {
      this.recordAudit("auth.oidc.complete", "failure", { accountId: account.id, category: transaction.category, role: transaction.role, reason: "assignment_denied" });
      throw new AuthServiceError(403, "このカテゴリとロールへのアクセス権がありません。");
    }
    const result = this.startAuthenticatedSession(account, transaction.category, transaction.role);
    this.recordAudit("auth.oidc.complete", "success", { accountId: account.id, category: transaction.category, role: transaction.role });
    return result;
  }

  private requireOidcConfig(): OidcConfig {
    if (!this.oidcConfig) throw new AuthServiceError(503, "OIDC認証が設定されていません。");
    return this.oidcConfig;
  }

  private async getOidcMetadata(config: OidcConfig): Promise<OidcProviderMetadata> {
    if (this.oidcMetadata) return this.oidcMetadata;
    const issuer = normalizeIssuer(config.issuer);
    const metadata = await this.requestOidcJson<OidcProviderMetadata>(`${issuer}/.well-known/openid-configuration`, {
      method: "GET",
      headers: { accept: "application/json" },
    }, 502);
    if (!stringClaim(metadata.authorization_endpoint) || !stringClaim(metadata.token_endpoint) || !stringClaim(metadata.issuer)) {
      throw new AuthServiceError(502, "OIDC discovery responseが不完全です。");
    }
    if (normalizeIssuer(metadata.issuer) !== issuer) throw new AuthServiceError(502, "OIDC issuerが一致しません。");
    this.oidcMetadata = metadata;
    return metadata;
  }

  private async requestOidcJson<T>(url: string, init: RequestInit, failureStatus: number): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, init);
    } catch {
      throw new AuthServiceError(failureStatus, "OIDCプロバイダーへの接続に失敗しました。");
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new AuthServiceError(failureStatus, "OIDCプロバイダーの応答形式が不正です。");
    }
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new AuthServiceError(failureStatus, "OIDCプロバイダーが認証要求を拒否しました。");
    }
    return payload as T;
  }

  private findOrProvisionOidcAccount(config: OidcConfig, subject: string, email: string, claims: Record<string, unknown>): Account {
    const issuer = normalizeIssuer(config.issuer);
    let account = [...this.accounts.values()].find((candidate) => candidate.oidcIssuer === issuer && candidate.oidcSubject === subject);
    if (!account && claims.email_verified !== false) {
      account = [...this.accounts.values()].find((candidate) => candidate.email.toLowerCase() === email && !candidate.oidcSubject);
    }
    if (!account && !config.autoProvisionUsers) {
      throw new AuthServiceError(403, "OIDCアカウントがCMS-OSに登録されていません。");
    }
    if (!account) {
      account = {
        id: `account-oidc-${randomBytes(12).toString("hex")}`,
        email,
        displayName: stringClaim(claims.name) ?? email,
        assignments: [{ role: "user", category: "*" }],
        oidcIssuer: issuer,
        oidcSubject: subject,
      };
      this.accounts.set(account.id, account);
    } else {
      account.oidcIssuer = issuer;
      account.oidcSubject = subject;
      account.email = email;
      const displayName = stringClaim(claims.name);
      if (displayName) account.displayName = displayName;
    }
    this.persistAccounts();
    return account;
  }

  private hasExternalMfa(claims: Record<string, unknown>): boolean {
    const amr = Array.isArray(claims.amr) ? claims.amr.filter((value): value is string => typeof value === "string") : [];
    if (amr.some((value) => ["mfa", "otp", "hwk", "sms", "webauthn", "fido2"].includes(value.toLowerCase()))) return true;
    return typeof claims.acr === "string" && /mfa|multi[-_ ]?factor/i.test(claims.acr);
  }

  public authenticate(accessToken: string | undefined): AuthenticatedPrincipal | null {
    if (!accessToken) return null;

    const session = this.sessions.get(hashToken(accessToken));
    if (!session || session.expiresAt <= Date.now()) {
      if (session) {
        this.sessions.delete(session.tokenHash);
        this.persistSessions();
      }
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
    this.persistSessions();
    return this.toPrincipal(account, category, role);
  }

  public logout(accessToken: string | undefined): void {
    if (accessToken) {
      const tokenHash = hashToken(accessToken);
      const session = this.sessions.get(tokenHash);
      this.sessions.delete(tokenHash);
      this.persistSessions();
      if (session) this.recordAudit("auth.logout", "success", { accountId: session.accountId, category: session.category, role: session.role });
    }
  }

  private isMfaChallenge(result: LoginResult): result is { mfaRequired: true; mfaChallengeToken: string; expiresInSeconds: number } {
    return "mfaRequired" in result;
  }

  private recordAudit(type: string, outcome: AuditOutcome, details: AuditDetails = {}): void {
    try {
      this.auditLogger?.record({ type, outcome, ...details });
    } catch {
      // 監査ログの書き込み失敗で認証処理そのものを停止させない。
    }
  }

  private persistAccounts(): void {
    this.stateStore?.save("auth-accounts.json", [...this.accounts.values()]);
  }

  private persistSessions(): void {
    this.stateStore?.save("auth-sessions.json", [...this.sessions.values()]);
  }

  private persistOidcTransactions(): void {
    this.stateStore?.save("auth-oidc-transactions.json", [...this.oidcTransactions.values()]);
  }

  private persistMfaChallenges(): void {
    this.stateStore?.save("auth-mfa-challenges.json", [...this.mfaChallenges.values()]);
  }

  private persistMfaEnrollments(): void {
    this.stateStore?.save("auth-mfa-enrollments.json", [...this.mfaEnrollments.values()]);
  }

  private toPrincipal(account: Account, category: CategorySlug, role: PortalRole): AuthenticatedPrincipal {
    const normalizedRole: PortalRole = role === "candidate" ? "recruiter" : role;
    return {
      accountId: account.id,
      email: account.email,
      displayName: account.displayName,
      category,
      role: normalizedRole,
      availableContexts: listAvailableContexts(account),
      ...(account.providerId ? { providerId: account.providerId } : {}),
      ...(account.internalRoleAssignments ? { internalRoleAssignments: account.internalRoleAssignments.map((assignment) => ({ ...assignment })) } : {}),
    };
  }
}

export function oidcConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): OidcConfig | undefined {
  const issuer = env.CMS_OS_OIDC_ISSUER;
  const clientId = env.CMS_OS_OIDC_CLIENT_ID;
  const redirectUri = env.CMS_OS_OIDC_REDIRECT_URI;
  if (!issuer && !clientId && !redirectUri) return undefined;
  if (!issuer || !clientId || !redirectUri) throw new Error("OIDC設定にはISSUER、CLIENT_ID、REDIRECT_URIが必要です。");
  const scopes = env.CMS_OS_OIDC_SCOPES?.split(/[ ,]+/).map((scope) => scope.trim()).filter(Boolean);
  return {
    issuer,
    clientId,
    redirectUri,
    ...(env.CMS_OS_OIDC_CLIENT_SECRET ? { clientSecret: env.CMS_OS_OIDC_CLIENT_SECRET } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    ...(env.CMS_OS_OIDC_AUTO_PROVISION === "true" ? { autoProvisionUsers: true } : {}),
    ...(env.CMS_OS_OIDC_REQUIRE_MFA === "true" ? { requireMfa: true } : {}),
  };
}

export function authOptionsFromEnvironment(env: NodeJS.ProcessEnv = process.env): AuthServiceOptions {
  const production = env.NODE_ENV === "production";
  const authMode = env.CMS_OS_AUTH_MODE ?? (production ? "oidc" : "password");
  const oidc = oidcConfigFromEnvironment(env);
  if (authMode === "oidc" && !oidc) throw new Error("CMS_OS_AUTH_MODE=oidcにはOIDC設定が必要です。");
  return {
    allowDemoAccounts: !production && env.CMS_OS_ALLOW_DEMO_ACCOUNTS !== "false",
    allowPasswordLogin: authMode === "password",
    ...(oidc ? { oidc } : {}),
    ...(env.CMS_OS_AUTH_ENCRYPTION_KEY ? { authEncryptionKey: env.CMS_OS_AUTH_ENCRYPTION_KEY } : {}),
  };
}
