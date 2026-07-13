import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";

const root = new URL("../../", import.meta.url);
const expectedMcpToolNames = [
  "auth.login",
  "auth.config",
  "auth.oidc_start",
  "auth.oidc_callback",
  "auth.mfa_enroll",
  "auth.mfa_confirm",
  "auth.mfa_complete",
  "auth.logout",
  "auth.me",
  "auth.switch_context",
  "category.list",
  "category.get",
  "category.resolve_experience",
  "directory.list",
  "directory.create",
  "directory.update",
  "directory.delete",
  "provider.search",
  "provider.get",
  "provider.update",
  "provider.listing_submit",
  "provider.listing_review",
  "provider.listing_review_queue",
  "media.list",
  "media.get",
  "media.register",
  "media.update",
  "media.archive",
  "media.transform",
  "media.seo_audit",
  "media.asset_seo_audit",
  "content.propose",
  "content.list",
  "content.get",
  "content.draft",
  "content.update",
  "content.translate",
  "content.duplicate",
  "content.archive",
  "content.restore",
  "content.versions",
  "content.version_get",
  "content.version_restore",
  "content.polish",
  "seo.audit",
  "seo.site_audit",
  "content.fact_check",
  "workflow.approve",
  "workflow.reviews",
  "workflow.request_review",
  "workflow.request_changes",
  "publication.build",
  "publication.deploy",
  "publication.publish",
  "publication.unpublish",
  "publication.schedule",
  "publication.schedule_list",
  "publication.schedule_cancel",
  "publication.schedule_execute",
  "publication.history",
  "publication.rollback",
  "request.create",
  "request.list",
  "request.update_status",
  "inquiry.create",
  "inquiry.list",
  "inquiry.update_status",
  "notification.list",
  "notification.mark_read",
  "job.search",
  "job.create",
  "job.update",
  "application.create",
  "application.list",
  "application.update_status",
] as const;

const openApiOperationToMcpTool: Record<string, string> = {
  login: "auth.login",
  getAuthConfig: "auth.config",
  startOidcLogin: "auth.oidc_start",
  completeOidcLogin: "auth.oidc_callback",
  enrollMfa: "auth.mfa_enroll",
  confirmMfaEnrollment: "auth.mfa_confirm",
  completeMfa: "auth.mfa_complete",
  logout: "auth.logout",
  getCurrentPrincipal: "auth.me",
  switchContext: "auth.switch_context",
  listCategories: "category.list",
  getCategoryContext: "category.get",
  resolveCategoryExperience: "category.resolve_experience",
  listCategoryDirectories: "directory.list",
  createDirectoryGuide: "directory.create",
  updateDirectoryGuide: "directory.update",
  deleteDirectoryGuide: "directory.delete",
  searchProviders: "provider.search",
  getProvider: "provider.get",
  updateProvider: "provider.update",
  submitProviderListing: "provider.listing_submit",
  reviewProviderListing: "provider.listing_review",
  listProviderListingReviews: "provider.listing_review_queue",
  listMediaAssets: "media.list",
  getMediaAsset: "media.get",
  registerMediaAsset: "media.register",
  updateMediaAsset: "media.update",
  archiveMediaAsset: "media.archive",
  transformMediaAsset: "media.transform",
  auditMediaSeo: "media.seo_audit",
  auditMediaAssetSeo: "media.asset_seo_audit",
  createContentProposal: "content.propose",
  listContentProposals: "content.list",
  createContentDraft: "content.draft",
  listContents: "content.list",
  updateContent: "content.update",
  translateContent: "content.translate",
  archiveContent: "content.archive",
  getContent: "content.get",
  listContentReviews: "workflow.reviews",
  requestContentReview: "workflow.request_review",
  requestContentChanges: "workflow.request_changes",
  listContentVersions: "content.versions",
  getContentVersion: "content.version_get",
  restoreContentVersion: "content.version_restore",
  duplicateContent: "content.duplicate",
  restoreContent: "content.restore",
  polishContent: "content.polish",
  auditContentSeo: "seo.audit",
  auditSiteSeo: "seo.site_audit",
  factCheckContent: "content.fact_check",
  approveContent: "workflow.approve",
  listPublicationHistory: "publication.history",
  unpublishContent: "publication.unpublish",
  listPublicationSchedules: "publication.schedule_list",
  schedulePublication: "publication.schedule",
  executePublicationSchedules: "publication.schedule_execute",
  cancelPublicationSchedule: "publication.schedule_cancel",
  buildPublication: "publication.build",
  publishPublication: "publication.publish",
  deployPublication: "publication.deploy",
  rollbackPublication: "publication.rollback",
  createRequest: "request.create",
  listRequests: "request.list",
  updateRequestStatus: "request.update_status",
  createInquiry: "inquiry.create",
  listInquiries: "inquiry.list",
  updateInquiryStatus: "inquiry.update_status",
  listNotifications: "notification.list",
  markNotificationRead: "notification.mark_read",
  createJob: "job.create",
  searchJobs: "job.search",
  updateJob: "job.update",
  createApplication: "application.create",
  listApplications: "application.list",
  updateApplicationStatus: "application.update_status",
};

let server: Server;
let baseUrl: string;

before(async () => {
  const auth = new InMemoryAuthService();
  const portal = new PortalService(auth);
  server = createHttpServer(auth, portal);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("テストサーバーのポートを取得できません。");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

describe("CMS-OS API/MCP操作カバレッジ", () => {
  it("RESTの全CMS操作をMCPツールとして公開し、入力スキーマを備える", async () => {
    const toolsResponse = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(toolsResponse.status, 200);

    const tools = toolsResponse.body.result.tools as Array<{ name: string; inputSchema?: { type?: string } }>;
    const actualNames = tools.map((tool) => tool.name).sort();
    const actualNameSet = new Set<string>(actualNames);
    assert.deepEqual(actualNames, [...expectedMcpToolNames].sort());
    for (const tool of tools) assert.equal(tool.inputSchema?.type, "object", `${tool.name}の入力スキーマがありません。`);

    const source = await readFile(new URL("docs/openapi.json", root), "utf8");
    const specification = JSON.parse(source) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const methods = new Set(["get", "post", "put", "patch", "delete"]);
    for (const [path, pathItem] of Object.entries(specification.paths)) {
      if (path === "/health" || path === "/mcp") continue;
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!methods.has(method)) continue;
        const operationId = operation.operationId;
        assert.ok(operationId, `${method.toUpperCase()} ${path}にoperationIdがありません。`);
        const mcpToolName = openApiOperationToMcpTool[operationId];
        assert.ok(mcpToolName, `${operationId}にMCPツール対応表がありません。`);
        assert.ok(actualNameSet.has(mcpToolName), `${operationId}に対応するMCPツール${mcpToolName}がありません。`);
      }
    }
  });
});
