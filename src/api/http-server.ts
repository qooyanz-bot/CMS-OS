import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import { InMemoryAuthService } from "../domain/auth.js";
import { getCategoryPolicy } from "../domain/catalog.js";
import { PortalService, PortalServiceError } from "../application/portal-service.js";
import {
  ContentService,
  ContentServiceError,
  isContentAudience,
  isContentType,
  parseOptionalStringArray,
} from "../application/content-service.js";
import { PublicationService, PublicationServiceError } from "../application/publication-service.js";
import type { CategorySlug, PortalRole } from "../domain/types.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const staticAssets: Record<string, { file: string; contentType: string }> = {
  "/": { file: "public/index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": { file: "public/app.js", contentType: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "public/styles.css", contentType: "text/css; charset=utf-8" },
};

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(body));
}

async function serveStaticAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const asset = staticAssets[pathname];
  if (!asset) return false;

  try {
    const content = await readFile(resolve(process.cwd(), asset.file));
    response.writeHead(200, {
      "content-type": asset.contentType,
      "cache-control": pathname === "/" ? "no-cache" : "public, max-age=300",
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("リクエストサイズが大きすぎます。");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSONオブジェクトが必要です。");
  return parsed as Record<string, unknown>;
}

function getBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

function isCategorySlug(value: unknown): value is CategorySlug {
  return value === "legal" || value === "beauty";
}

function isPortalRole(value: unknown): value is PortalRole {
  return value === "user" || value === "orderer" || value === "provider" || value === "candidate";
}

function mcpText(value: unknown): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(value) };
}

function serviceErrorStatus(error: unknown): number {
  return error instanceof PortalServiceError || error instanceof ContentServiceError || error instanceof PublicationServiceError ? error.statusCode : 400;
}

async function handleMcp(
  request: IncomingMessage,
  response: ServerResponse,
  auth: InMemoryAuthService,
  portal: PortalService,
  content: ContentService,
  publication: PublicationService,
): Promise<void> {
  const body = await readJson(request);
  const id = body.id ?? null;
  const method = body.method;

  if (method === "initialize") {
    writeJson(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cms-os", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    writeJson(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "category.resolve_experience",
            description: "カテゴリと認証コンテキストに応じた表示モジュールと操作権限を取得します。",
            inputSchema: { type: "object", properties: { category: { enum: ["legal", "beauty"] } }, required: ["category"] },
          },
          {
            name: "provider.search",
            description: "カテゴリ、テーマ、地域に応じて表示可能な事業者を検索します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: ["legal", "beauty"] },
                search: { type: "string" },
                theme: { type: "string" },
                location: { type: "string" },
              },
              required: ["category"],
            },
          },
          {
            name: "auth.switch_context",
            description: "許可されたカテゴリとロールへ操作コンテキストを切り替えます。",
            inputSchema: {
              type: "object",
              properties: { category: { enum: ["legal", "beauty"] }, role: { enum: ["user", "orderer", "provider", "candidate"] } },
              required: ["category", "role"],
            },
          },
          {
            name: "request.create",
            description: "発注者として事業者への依頼を作成します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: ["legal", "beauty"] },
                providerId: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
              },
              required: ["category", "providerId", "title", "description"],
            },
          },
          {
            name: "request.list",
            description: "発注者自身の依頼、または事業者に割り当てられた依頼を取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "job.search",
            description: "カテゴリ別の公開求人を検索します。",
            inputSchema: { type: "object", properties: { category: { enum: ["legal", "beauty"] } }, required: ["category"] },
          },
          {
            name: "application.create",
            description: "リクルーターとして求人へ応募します。",
            inputSchema: {
              type: "object",
              properties: { jobId: { type: "string" }, message: { type: "string" } },
              required: ["jobId", "message"],
            },
          },
          {
            name: "application.list",
            description: "リクルーター本人、または事業者自身の求人への応募一覧を取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "content.propose",
            description: "対象ポジションと検索意図に応じたコンテンツ企画案を作成します。",
            inputSchema: {
              type: "object",
              properties: {
                category: { enum: ["legal", "beauty"] },
                contentType: { enum: ["company", "blog", "job", "pr", "ir"] },
                audience: { enum: ["customer", "candidate", "media", "investor", "beginner", "existingCustomer"] },
                topic: { type: "string" },
                primaryKeyword: { type: "string" },
                relatedKeywords: { type: "array", items: { type: "string" } },
                sourceFacts: { type: "array", items: { type: "string" } },
              },
              required: ["category", "contentType", "audience", "topic"],
            },
          },
          {
            name: "content.list",
            description: "事業者自身の企画案とコンテンツを一覧取得します。",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "content.draft",
            description: "企画案から対象ポジション向けの下書きを生成します。",
            inputSchema: {
              type: "object",
              properties: { proposalId: { type: "string" } },
              required: ["proposalId"],
            },
          },
          {
            name: "content.polish",
            description: "事業者の下書きを清書し、読みやすさと表記を整えます。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" }, instructions: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "seo.audit",
            description: "タイトル、説明文、見出し、キーワード、出典をSEO監査します。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "content.fact_check",
            description: "本文に紐づく一次情報の登録状況を確認します。本番では外部検証アダプターへ差し替えます。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "workflow.approve",
            description: "清書済みコンテンツを人間の確認済み状態へ進めます。",
            inputSchema: {
              type: "object",
              properties: { contentId: { type: "string" } },
              required: ["contentId"],
            },
          },
          {
            name: "publication.build",
            description: "承認済みコンテンツからCloudflare Pages向け静的ファイルを生成します。",
            inputSchema: {
              type: "object",
              properties: {
                contentIds: { type: "array", items: { type: "string" } },
                baseUrl: { type: "string" },
              },
              required: [],
            },
          },
        ],
      },
    });
    return;
  }

  if (method !== "tools/call") {
    writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "未対応のMCPメソッドです。" } });
    return;
  }

  const params = (body.params ?? {}) as Record<string, unknown>;
  const name = params.name;
  const argumentsObject = (params.arguments ?? {}) as Record<string, unknown>;
  const principal = auth.authenticate(getBearerToken(request));

  try {
    if (name === "category.resolve_experience") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.getExperience(argumentsObject.category, principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "provider.search") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.searchProviders(argumentsObject.category, principal, {
        search: typeof argumentsObject.search === "string" ? argumentsObject.search : undefined,
        theme: typeof argumentsObject.theme === "string" ? argumentsObject.theme : undefined,
        location: typeof argumentsObject.location === "string" ? argumentsObject.location : undefined,
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "auth.switch_context") {
      const token = getBearerToken(request);
      if (!token || !isCategorySlug(argumentsObject.category) || !isPortalRole(argumentsObject.role)) {
        throw new Error("認証トークン、category、roleが必要です。");
      }
      const result = portal.switchContext(token, argumentsObject.category, argumentsObject.role);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "request.create") {
      if (!isCategorySlug(argumentsObject.category) || typeof argumentsObject.providerId !== "string" || typeof argumentsObject.title !== "string" || typeof argumentsObject.description !== "string") {
        throw new Error("category、providerId、title、descriptionが必要です。");
      }
      const result = portal.createRequest(principal, {
        category: argumentsObject.category,
        providerId: argumentsObject.providerId,
        title: argumentsObject.title,
        description: argumentsObject.description,
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "request.list") {
      const result = portal.listRequests(principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "job.search") {
      if (!isCategorySlug(argumentsObject.category)) throw new Error("categoryが不正です。");
      const result = portal.listJobs(argumentsObject.category, principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "application.create") {
      if (typeof argumentsObject.jobId !== "string" || typeof argumentsObject.message !== "string") {
        throw new Error("jobIdとmessageが必要です。");
      }
      const result = portal.createApplication(principal, argumentsObject.jobId, argumentsObject.message);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "application.list") {
      const result = portal.listApplications(principal);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.propose") {
      if (!isCategorySlug(argumentsObject.category) || !isContentType(argumentsObject.contentType) || !isContentAudience(argumentsObject.audience) || typeof argumentsObject.topic !== "string") {
        throw new Error("category、contentType、audience、topicが必要です。");
      }
      const result = content.createProposal(principal, {
        category: argumentsObject.category,
        contentType: argumentsObject.contentType,
        audience: argumentsObject.audience,
        topic: argumentsObject.topic,
        primaryKeyword: typeof argumentsObject.primaryKeyword === "string" ? argumentsObject.primaryKeyword : undefined,
        relatedKeywords: parseOptionalStringArray(argumentsObject.relatedKeywords, "relatedKeywords"),
        sourceFacts: parseOptionalStringArray(argumentsObject.sourceFacts, "sourceFacts"),
      });
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.list") {
      const result = { proposals: content.listProposals(principal), items: content.listContent(principal) };
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.draft") {
      if (typeof argumentsObject.proposalId !== "string") throw new Error("proposalIdが必要です。");
      const result = content.createDraft(principal, argumentsObject.proposalId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.polish") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.polishContent(principal, argumentsObject.contentId, typeof argumentsObject.instructions === "string" ? argumentsObject.instructions : undefined);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "seo.audit") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.auditSeo(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "content.fact_check") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.factCheck(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "workflow.approve") {
      if (typeof argumentsObject.contentId !== "string") throw new Error("contentIdが必要です。");
      const result = content.approveContent(principal, argumentsObject.contentId);
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    if (name === "publication.build") {
      const result = publication.build(
        principal,
        parseOptionalStringArray(argumentsObject.contentIds, "contentIds"),
        typeof argumentsObject.baseUrl === "string" ? argumentsObject.baseUrl : undefined,
      );
      writeJson(response, 200, { jsonrpc: "2.0", id, result: { content: [mcpText(result)], structuredContent: result } });
      return;
    }

    writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "未対応のMCPツールです。" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP操作に失敗しました。";
    writeJson(response, 200, { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: message }] } });
  }
}

export function createHttpServer(
  auth: InMemoryAuthService,
  portal: PortalService,
  content = new ContentService(portal),
  publication = new PublicationService(portal, content),
): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const token = getBearerToken(request);
    const principal = auth.authenticate(token);

    try {
      if (request.method === "GET" && (await serveStaticAsset(url.pathname, response))) {
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, { ok: true, service: "cms-os" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/login") {
        const body = await readJson(request);
        const email = body.email;
        const password = body.password;
        const category = body.category;
        const role = body.role ?? "user";
        if (typeof email !== "string" || typeof password !== "string" || !isCategorySlug(category) || !isPortalRole(role)) {
          writeJson(response, 400, { error: "email、password、category、roleが必要です。" });
          return;
        }
        const login = auth.login(email, password, category, role);
        if (!login) {
          writeJson(response, 401, { error: "認証情報またはカテゴリ・ロールが正しくありません。" });
          return;
        }
        writeJson(response, 200, login);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/logout") {
        auth.logout(token);
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/auth/me") {
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        writeJson(response, 200, { principal, experience: portal.getExperience(principal.category, principal) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/auth/context") {
        if (!token || !principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isPortalRole(body.role)) {
          writeJson(response, 400, { error: "categoryとroleが必要です。" });
          return;
        }
        try {
          const switched = portal.switchContext(token, body.category, body.role);
          writeJson(response, 200, { principal: switched, experience: portal.getExperience(switched.category, switched) });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 403;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "コンテキストを切り替えられません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/categories") {
        writeJson(response, 200, { items: portal.listCategories() });
        return;
      }

      const experienceMatch = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)\/experience$/);
      if (request.method === "GET" && experienceMatch) {
        const category = experienceMatch[1];
        if (!isCategorySlug(category)) {
          writeJson(response, 404, { error: "カテゴリが見つかりません。" });
          return;
        }
        writeJson(response, 200, { experience: portal.getExperience(category, principal) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/providers") {
        const category = url.searchParams.get("category");
        if (!isCategorySlug(category)) {
          writeJson(response, 400, { error: "categoryはlegalまたはbeautyが必要です。" });
          return;
        }
        writeJson(response, 200, {
          items: portal.searchProviders(category, principal, {
            search: url.searchParams.get("search") ?? undefined,
            theme: url.searchParams.get("theme") ?? undefined,
            location: url.searchParams.get("location") ?? undefined,
          }),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/content/proposals") {
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || !isContentType(body.contentType) || !isContentAudience(body.audience) || typeof body.topic !== "string") {
          writeJson(response, 400, { error: "category、contentType、audience、topicが必要です。" });
          return;
        }
        try {
          const item = content.createProposal(principal, {
            category: body.category,
            contentType: body.contentType,
            audience: body.audience,
            topic: body.topic,
            primaryKeyword: typeof body.primaryKeyword === "string" ? body.primaryKeyword : undefined,
            relatedKeywords: parseOptionalStringArray(body.relatedKeywords, "relatedKeywords"),
            sourceFacts: parseOptionalStringArray(body.sourceFacts, "sourceFacts"),
          });
          writeJson(response, 201, { item });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "企画案を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/content/proposals") {
        try {
          writeJson(response, 200, { items: content.listProposals(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "企画案を取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/content/drafts") {
        const body = await readJson(request);
        if (typeof body.proposalId !== "string") {
          writeJson(response, 400, { error: "proposalIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 201, { item: content.createDraft(principal, body.proposalId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "下書きを作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/content") {
        try {
          writeJson(response, 200, { items: content.listContent(principal) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを取得できません。" });
        }
        return;
      }

      const contentActionMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)\/(polish|seo-audit|fact-check|approve)$/);
      if (request.method === "POST" && contentActionMatch) {
        const contentId = contentActionMatch[1];
        const action = contentActionMatch[2];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          if (action === "polish") {
            const body = await readJson(request);
            if (body.instructions !== undefined && typeof body.instructions !== "string") {
              writeJson(response, 400, { error: "instructionsは文字列で指定してください。" });
              return;
            }
            writeJson(response, 200, { item: content.polishContent(principal, contentId, typeof body.instructions === "string" ? body.instructions : undefined) });
          } else if (action === "seo-audit") {
            writeJson(response, 200, { item: content.auditSeo(principal, contentId) });
          } else if (action === "fact-check") {
            writeJson(response, 200, { item: content.factCheck(principal, contentId) });
          } else {
            writeJson(response, 200, { item: content.approveContent(principal, contentId) });
          }
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツ操作に失敗しました。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/publications/build") {
        const body = await readJson(request);
        if (body.contentIds !== undefined && (!Array.isArray(body.contentIds) || body.contentIds.some((item) => typeof item !== "string"))) {
          writeJson(response, 400, { error: "contentIdsは文字列配列で指定してください。" });
          return;
        }
        if (body.baseUrl !== undefined && typeof body.baseUrl !== "string") {
          writeJson(response, 400, { error: "baseUrlは文字列で指定してください。" });
          return;
        }
        try {
          const result = publication.build(
            principal,
            Array.isArray(body.contentIds) ? body.contentIds as string[] : undefined,
            typeof body.baseUrl === "string" ? body.baseUrl : undefined,
          );
          writeJson(response, 201, { item: result });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "静的公開ファイルを生成できません。" });
        }
        return;
      }

      const contentMatch = url.pathname.match(/^\/api\/v1\/content\/([^/]+)$/);
      if (request.method === "GET" && contentMatch) {
        const contentId = contentMatch[1];
        if (!contentId) {
          writeJson(response, 400, { error: "contentIdが必要です。" });
          return;
        }
        try {
          writeJson(response, 200, { item: content.getContent(principal, contentId) });
        } catch (error) {
          writeJson(response, serviceErrorStatus(error), { error: error instanceof Error ? error.message : "コンテンツを取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/requests") {
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (!isCategorySlug(body.category) || typeof body.providerId !== "string" || typeof body.title !== "string" || typeof body.description !== "string") {
          writeJson(response, 400, { error: "category、providerId、title、descriptionが必要です。" });
          return;
        }
        try {
          const result = portal.createRequest(principal, {
            category: body.category,
            providerId: body.providerId,
            title: body.title,
            description: body.description,
          });
          writeJson(response, 201, { item: result });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "依頼を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/requests") {
        try {
          writeJson(response, 200, { items: portal.listRequests(principal) });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "依頼を取得できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/jobs") {
        const category = url.searchParams.get("category");
        if (!isCategorySlug(category)) {
          writeJson(response, 400, { error: "categoryはlegalまたはbeautyが必要です。" });
          return;
        }
        writeJson(response, 200, { items: portal.listJobs(category, principal) });
        return;
      }

      const applicationMatch = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)\/applications$/);
      if (request.method === "POST" && applicationMatch) {
        const jobId = applicationMatch[1];
        if (!jobId) {
          writeJson(response, 400, { error: "jobIdが必要です。" });
          return;
        }
        if (!principal) {
          writeJson(response, 401, { error: "ログインが必要です。" });
          return;
        }
        const body = await readJson(request);
        if (typeof body.message !== "string") {
          writeJson(response, 400, { error: "messageが必要です。" });
          return;
        }
        try {
          const result = portal.createApplication(principal, jobId, body.message);
          writeJson(response, 201, { item: result });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "応募を作成できません。" });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/applications") {
        try {
          writeJson(response, 200, { items: portal.listApplications(principal) });
        } catch (error) {
          const statusCode = error instanceof PortalServiceError ? error.statusCode : 400;
          writeJson(response, statusCode, { error: error instanceof Error ? error.message : "応募情報を取得できません。" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/mcp") {
        await handleMcp(request, response, auth, portal, content, publication);
        return;
      }

      const categoryCandidate = url.pathname.match(/^\/api\/v1\/categories\/([^/]+)$/)?.[1];
      if (categoryCandidate && isCategorySlug(categoryCandidate)) {
        writeJson(response, 404, { error: "カテゴリの操作は未実装です。" });
        return;
      }

      writeJson(response, 404, { error: "エンドポイントが見つかりません。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "サーバーエラーが発生しました。";
      writeJson(response, 400, { error: message });
    }
  });
}
