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
      "/api/v1/auth/logout",
      "/api/v1/auth/me",
      "/api/v1/auth/context",
      "/api/v1/categories",
      "/api/v1/categories/{category}/experience",
      "/api/v1/providers",
      "/api/v1/content/proposals",
      "/api/v1/content/drafts",
      "/api/v1/content",
      "/api/v1/content/{contentId}",
      "/api/v1/content/{contentId}/polish",
      "/api/v1/content/{contentId}/seo-audit",
      "/api/v1/content/{contentId}/fact-check",
      "/api/v1/content/{contentId}/approve",
      "/api/v1/publications/build",
      "/api/v1/publications/deploy",
      "/api/v1/requests",
      "/api/v1/jobs",
      "/api/v1/jobs/{jobId}/applications",
      "/api/v1/applications",
      "/mcp",
    ];
    for (const path of requiredPaths) {
      assert.ok(specification.paths[path], `${path}がOpenAPIにありません。`);
      for (const operation of Object.values(specification.paths[path] ?? {})) {
        if (typeof operation === "object" && operation !== null) assert.ok("responses" in operation, `${path}のレスポンス定義がありません。`);
      }
    }
    for (const path of ["/api/v1/categories/{category}/experience", "/api/v1/providers", "/api/v1/jobs", "/mcp"]) {
      const operation = Object.values(specification.paths[path] ?? {})[0] as { security?: unknown };
      assert.deepEqual(operation.security, [{}, { BearerAuth: [] }], `${path}は任意認証である必要があります。`);
    }
    assert.deepEqual(specification.components.securitySchemes.BearerAuth, { type: "http", scheme: "bearer", bearerFormat: "opaque-session-token" });
  });
});
