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
      components: { securitySchemes: Record<string, { type: string; scheme?: string }>; schemas: Record<string, { enum?: unknown[]; properties?: Record<string, unknown> }> };
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
      "/api/v1/portal-plans",
      "/api/v1/portal-plans/{planId}",
      "/api/v1/portal-plans/{planId}/apply",
      "/api/v1/favorites",
      "/api/v1/favorites/{favoriteId}",
      "/api/v1/providers",
      "/api/v1/providers/compare",
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
      "/api/v1/content/{contentId}/translate",
      "/api/v1/content/{contentId}/polish",
      "/api/v1/content/{contentId}/seo-audit",
      "/api/v1/seo/audit",
      "/api/v1/content/{contentId}/fact-check",
      "/api/v1/content/{contentId}/approve",
      "/api/v1/publications",
      "/api/v1/publications/build",
      "/api/v1/publications/publish",
      "/api/v1/publications/deploy",
      "/api/v1/publications/unpublish",
      "/api/v1/publications/schedules",
      "/api/v1/publications/schedules/execute",
      "/api/v1/publications/schedules/{scheduleId}/cancel",
      "/api/v1/publications/{publicationId}/rollback",
      "/api/v1/requests",
      "/api/v1/requests/{requestId}",
      "/api/v1/bookings",
      "/api/v1/bookings/{bookingId}",
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
    const bookingPath = specification.paths["/api/v1/bookings"];
    assert.ok(bookingPath);
    assert.ok(bookingPath.post);
    assert.ok(bookingPath.get);
    const bookingDetailPath = specification.paths["/api/v1/bookings/{bookingId}"];
    assert.ok(bookingDetailPath);
    assert.ok(bookingDetailPath.patch);
    const listQueryParameters: Record<string, string[]> = {
      "/api/v1/providers": ["search", "theme", "location", "sort", "limit", "cursor"],
      "/api/v1/providers/compare": ["ids"],
      "/api/v1/favorites": ["limit", "cursor"],
      "/api/v1/requests": ["search", "status", "sort", "limit", "cursor"],
      "/api/v1/bookings": ["status", "limit", "cursor"],
      "/api/v1/jobs": ["search", "employmentType", "location", "status", "sort", "limit", "cursor"],
      "/api/v1/applications": ["search", "jobId", "status", "sort", "limit", "cursor"],
      "/api/v1/portal-plans": ["limit", "cursor"],
      "/api/v1/content": ["search", "status", "audience", "contentType", "locale", "sort", "limit", "cursor"],
      "/api/v1/content/proposals": ["search", "audience", "contentType", "sort", "limit", "cursor"],
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
    assert.ok(specification.components.schemas.Category?.properties?.themes);
    assert.ok(specification.components.schemas.CategoryContext?.properties?.themeOptions);
    assert.deepEqual(specification.components.schemas.AsyncOperationType?.enum, ["content.create", "content.create_batch", "content.propose_batch", "content.draft_batch", "content.polish_batch", "content.prepare_batch"]);
    assert.ok(specification.components.schemas.AsyncOperationContentCreateBatchRequest);
    assert.ok(specification.components.schemas.AsyncOperationContentProposeBatchRequest);
    assert.ok(specification.components.schemas.AsyncOperationContentDraftBatchRequest);
    assert.ok(specification.components.schemas.AsyncOperationContentPolishBatchRequest);
    assert.ok(specification.components.schemas.AsyncOperationContentPrepareBatchRequest);
    assert.deepEqual(specification.components.schemas.ContentWorkflowStatus?.enum, ["proposed", "drafted", "polished", "seo_reviewed", "review_requested", "changes_requested", "approved", "published", "archived"]);
    assert.deepEqual(specification.components.schemas.ProposalSort?.enum, ["createdAt_desc", "createdAt_asc", "topic_asc"]);
    assert.deepEqual((specification.paths["/api/v1/publications/schedules/execute"]?.post as { security?: unknown }).security, [{ BearerAuth: [] }, { OperatorKey: [] }]);
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
