import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const root = new URL("../../", import.meta.url);

describe("CMS-OS OpenAPI契約", () => {
  it("実装済みREST入口と認証スキームを正本に定義する", async () => {
    const source = await readFile(new URL("docs/openapi.json", root), "utf8");
    const specification = JSON.parse(source) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
    };
    assert.equal(specification.openapi, "3.1.0");
    const requiredPaths = [
      "/health",
      "/api/v1/auth/login",
      "/api/v1/auth/config",
      "/api/v1/auth/oidc/start",
      "/api/v1/auth/oidc/callback",
      "/api/v1/auth/mfa/enroll",
      "/api/v1/auth/mfa/confirm",
      "/api/v1/auth/mfa/complete",
      "/api/v1/auth/logout",
      "/api/v1/auth/me",
      "/api/v1/auth/context",
      "/api/v1/categories",
      "/api/v1/categories/{category}",
      "/api/v1/categories/{category}/experience",
      "/api/v1/categories/{category}/directories",
      "/api/v1/providers",
      "/api/v1/providers/{providerId}",
      "/api/v1/providers/{providerId}/listing-submission",
      "/api/v1/providers/{providerId}/listing-review",
      "/api/v1/provider-listing-reviews",
      "/api/v1/content/proposals",
      "/api/v1/content/drafts",
      "/api/v1/content",
      "/api/v1/content/{contentId}",
      "/api/v1/content/{contentId}/reviews",
      "/api/v1/content/{contentId}/review-request",
      "/api/v1/content/{contentId}/request-changes",
      "/api/v1/content/{contentId}/versions",
      "/api/v1/content/{contentId}/versions/{version}",
      "/api/v1/content/{contentId}/versions/{version}/restore",
      "/api/v1/content/{contentId}/duplicate",
      "/api/v1/content/{contentId}/restore",
      "/api/v1/content/{contentId}/polish",
      "/api/v1/content/{contentId}/seo-audit",
      "/api/v1/content/{contentId}/fact-check",
      "/api/v1/content/{contentId}/approve",
      "/api/v1/publications",
      "/api/v1/publications/build",
      "/api/v1/publications/publish",
      "/api/v1/publications/deploy",
      "/api/v1/publications/{publicationId}/rollback",
      "/api/v1/requests",
      "/api/v1/requests/{requestId}",
      "/api/v1/inquiries",
      "/api/v1/inquiries/{inquiryId}",
      "/api/v1/notifications",
      "/api/v1/notifications/{notificationId}",
      "/api/v1/jobs",
      "/api/v1/jobs/{jobId}",
      "/api/v1/jobs/{jobId}/applications",
      "/api/v1/applications",
      "/api/v1/applications/{applicationId}",
      "/mcp",
    ];
    for (const path of requiredPaths) {
      assert.ok(specification.paths[path], `${path}がOpenAPIにありません。`);
      for (const operation of Object.values(specification.paths[path] ?? {})) {
        if (typeof operation === "object" && operation !== null) assert.ok("responses" in operation, `${path}のレスポンス定義がありません。`);
      }
    }
    const contentPath = specification.paths["/api/v1/content/{contentId}"];
    assert.ok(contentPath);
    assert.ok(contentPath.patch);
    assert.ok(contentPath.delete);
    const providerPath = specification.paths["/api/v1/providers/{providerId}"];
    assert.ok(providerPath);
    assert.ok(providerPath.get);
    assert.ok(providerPath.patch);
    const jobPath = specification.paths["/api/v1/jobs/{jobId}"];
    assert.ok(jobPath);
    assert.ok(jobPath.patch);
    const listQueryParameters: Record<string, string[]> = {
      "/api/v1/providers": ["search", "theme", "location", "sort", "limit", "cursor"],
      "/api/v1/requests": ["search", "status", "sort", "limit", "cursor"],
      "/api/v1/jobs": ["search", "employmentType", "location", "status", "sort", "limit", "cursor"],
      "/api/v1/applications": ["search", "jobId", "status", "sort", "limit", "cursor"],
    };
    for (const [path, expectedParameters] of Object.entries(listQueryParameters)) {
      const operation = specification.paths[path]?.get as { parameters?: Array<{ name?: string }> } | undefined;
      assert.ok(operation);
      const names = new Set((operation.parameters ?? []).map((parameter) => parameter.name).filter((name): name is string => Boolean(name)));
      for (const parameter of expectedParameters) assert.ok(names.has(parameter), `${path}に${parameter}クエリがありません`);
    }
    for (const path of ["/api/v1/categories/{category}", "/api/v1/categories/{category}/experience", "/api/v1/providers", "/api/v1/jobs", "/mcp"]) {
      const pathItem = specification.paths[path] ?? {};
      const operation = (pathItem.get ?? Object.values(pathItem)[0]) as { security?: unknown };
      assert.deepEqual(operation.security, [{}, { BearerAuth: [] }], `${path}は任意認証である必要があります。`);
    }
    assert.deepEqual(specification.components.securitySchemes.BearerAuth, { type: "http", scheme: "bearer", bearerFormat: "opaque-session-token" });
    assert.deepEqual(specification.components.securitySchemes.OperatorKey, { type: "apiKey", in: "header", name: "x-cms-os-operator-key" });
    for (const path of [
      "/api/v1/auth/login",
      "/api/v1/auth/oidc/start",
      "/api/v1/auth/oidc/callback",
      "/api/v1/auth/mfa/enroll",
      "/api/v1/auth/mfa/confirm",
      "/api/v1/auth/mfa/complete",
      "/api/v1/auth/logout",
      "/mcp",
    ]) {
      const operation = Object.values(specification.paths[path] ?? {})[0] as { responses?: Record<string, unknown> };
      assert.ok(operation.responses?.["429"], `${path}のレート制限レスポンスがありません。`);
    }
  });
});
