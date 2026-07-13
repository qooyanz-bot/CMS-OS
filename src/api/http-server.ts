import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { InMemoryAuthService } from "../domain/auth.js";
import { getCategoryPolicy } from "../domain/catalog.js";
import { PortalService } from "../application/portal-service.js";
import type { CategorySlug, PortalRole } from "../domain/types.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(body));
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

async function handleMcp(
  request: IncomingMessage,
  response: ServerResponse,
  auth: InMemoryAuthService,
  portal: PortalService,
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

    writeJson(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "未対応のMCPツールです。" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP操作に失敗しました。";
    writeJson(response, 200, { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: message }] } });
  }
}

export function createHttpServer(auth: InMemoryAuthService, portal: PortalService): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const token = getBearerToken(request);
    const principal = auth.authenticate(token);

    try {
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
          writeJson(response, 403, { error: error instanceof Error ? error.message : "コンテキストを切り替えられません。" });
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

      if (request.method === "POST" && url.pathname === "/mcp") {
        await handleMcp(request, response, auth, portal);
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
