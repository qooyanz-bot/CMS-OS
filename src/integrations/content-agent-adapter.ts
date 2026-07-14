import type {
  CategorySlug,
  ContentAudience,
  ContentJsonLdType,
  ContentLocale,
  ContentProposal,
  ContentRecord,
  ContentSeo,
  ContentType,
  PortalPlanGap,
  PortalPlanGoal,
  PortalPlanPageIdea,
  PortalPlanSearchIntent,
} from "../domain/types.js";

/**
 * AIエージェントが企画案を作成するときに受け取る編集コンテキストです。
 * 企業の一次情報はsourceFactsとして渡し、アダプター側で事実を推測しません。
 */
export type ContentAgentProposalInput = {
  category: CategorySlug;
  contentType: ContentType;
  audience: ContentAudience;
  topic: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  sourceFacts: string[];
  searchIntent: string;
  outline: string[];
  rationale: string;
  audienceLabel: string;
  contentTypeLabel: string;
};

export type ContentAgentProposalOutput = {
  searchIntent: string;
  relatedKeywords: string[];
  outline: string[];
  rationale: string;
};

/** 下書き生成時にAIへ渡す情報です。 */
export type ContentAgentDraftInput = {
  proposal: ContentProposal;
  audienceLabel: string;
  audienceIntent: string;
  contentTypeLabel: string;
  jsonLdType: ContentJsonLdType;
};

export type ContentAgentDraftOutput = {
  title: string;
  summary: string;
  body: string;
  seo?: Partial<ContentSeo>;
};

/** 清書時にAIへ渡す情報です。 */
export type ContentAgentPolishInput = {
  content: ContentRecord;
  instructions?: string;
};

export type ContentAgentPolishOutput = {
  body: string;
  title?: string;
  summary?: string;
  seo?: Partial<ContentSeo>;
};

/** 翻訳時にAIへ渡す情報です。 */
export type ContentAgentTranslateInput = {
  source: ContentRecord;
  targetLocale: ContentLocale;
  targetLabel: string;
  instructions?: string;
};

export type ContentAgentTranslateOutput = {
  title: string;
  summary: string;
  body: string;
  seo?: Partial<ContentSeo>;
};

/** ポータル計画をAIへ委譲するときの入力です。基準案も一緒に渡して監査可能性を保ちます。 */
export type ContentAgentPortalPlanInput = {
  category: CategorySlug;
  categoryLabel: string;
  theme: string;
  region?: string;
  audience: ContentAudience;
  goal: PortalPlanGoal;
  availableModules: string[];
  providerCount: number;
  externalGuideCount: number;
  jobCount: number;
  contentCount: number;
  matchingContentCount: number;
  baseline: {
    searchIntents: PortalPlanSearchIntent[];
    pageIdeas: PortalPlanPageIdea[];
    gaps: PortalPlanGap[];
    nextActions: string[];
  };
};

export type ContentAgentPortalPlanOutput = {
  searchIntents: PortalPlanSearchIntent[];
  pageIdeas: PortalPlanPageIdea[];
  gaps: PortalPlanGap[];
  nextActions: string[];
};

/** 同期アダプターとHTTP・キュー型アダプターを同じ契約で扱うための型です。 */
export type ContentAgentResult<T> = T | PromiseLike<T>;

/**
 * CMS-OSのAI編集機能とモデルプロバイダーの境界です。
 *
 * 実運用ではこのインターフェースをOpenAI互換API、社内モデル、または
 * キュー経由の非同期ワーカーで実装します。API/MCPの入力・権限・監査・
 * SEOゲートはContentService側に残るため、モデルを交換しても契約は変わりません。
 */
export interface ContentAgentAdapter {
  readonly id: string;
  propose(input: ContentAgentProposalInput): ContentAgentResult<ContentAgentProposalOutput>;
  draft(input: ContentAgentDraftInput): ContentAgentResult<ContentAgentDraftOutput>;
  polish(input: ContentAgentPolishInput): ContentAgentResult<ContentAgentPolishOutput>;
  translate(input: ContentAgentTranslateInput): ContentAgentResult<ContentAgentTranslateOutput>;
  planPortal?(input: ContentAgentPortalPlanInput): ContentAgentResult<ContentAgentPortalPlanOutput>;
}

export type HttpContentAgentAdapterOptions = {
  endpoint: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_MAX_RESPONSE_BYTES = 4_194_304;

function createDeterministicBody(title: string, proposal: ContentProposal, audienceIntent: string): string {
  const sections = proposal.outline
    .map((heading) => `## ${heading}\n\n${proposal.topic}について、${audienceIntent}ための情報を整理します。\n`)
    .join("\n");
  const facts = proposal.sourceFacts.length > 0
    ? `\n## 確認済み情報\n\n${proposal.sourceFacts.map((fact) => `- ${fact}`).join("\n")}\n`
    : "\n## 編集メモ\n\n公開前に、企業が保有する一次情報と出典を追加してください。\n";
  return `# ${title}\n\n${proposal.rationale}\n\n${sections}${facts}`.trim();
}

function limit(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function trimList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

/**
 * 外部サービスを使わず同じ入力から同じ結果を生成する標準アダプターです。
 * 開発・テスト・無料のCloudflare静的公開環境で利用でき、後から差し替えられます。
 */
export class DeterministicContentAgentAdapter implements ContentAgentAdapter {
  public readonly id = "deterministic-content-agent";

  public propose(input: ContentAgentProposalInput): ContentAgentProposalOutput {
    return {
      searchIntent: input.searchIntent,
      relatedKeywords: [...input.relatedKeywords],
      outline: [...input.outline],
      rationale: input.rationale,
    };
  }

  public draft(input: ContentAgentDraftInput): ContentAgentDraftOutput {
    const title = `${input.proposal.topic}｜${input.audienceLabel}向け${input.contentTypeLabel}`;
    const summary = limit(`${input.proposal.topic}について、${input.audienceIntent}ためのCMS-OS編集原稿です。`, 160);
    const seoTitle = limit(title, 60);
    const seoDescription = limit(summary, 160);
    return {
      title,
      summary,
      body: createDeterministicBody(title, input.proposal, input.audienceIntent),
      seo: {
        title: seoTitle,
        description: seoDescription,
        keywords: [input.proposal.primaryKeyword, ...input.proposal.relatedKeywords],
        ogTitle: seoTitle,
        ogDescription: seoDescription,
        jsonLdType: input.jsonLdType,
        faq: input.proposal.outline.slice(-1).map((question) => ({
          question: `${question}は確認できますか？`,
          answer: "公開前に一次情報と担当者の確認結果を反映します。",
        })),
      },
    };
  }

  public polish(input: ContentAgentPolishInput): ContentAgentPolishOutput {
    const normalizedBody = input.content.body
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const instructionNote = input.instructions?.trim() ? `\n\n> 清書方針: ${input.instructions.trim()}` : "";
    return {
      body: `${normalizedBody}${instructionNote}`,
      seo: {
        title: limit(input.content.seo.title.trim(), 60),
        description: limit(input.content.seo.description.trim(), 160),
      },
    };
  }

  public translate(input: ContentAgentTranslateInput): ContentAgentTranslateOutput {
    const translationNote = input.instructions?.trim() ? `\n\n> 翻訳指示: ${input.instructions.trim()}` : "";
    const title = `【${input.targetLabel}翻訳下書き】${input.source.title}`;
    return {
      title,
      summary: `翻訳先: ${input.targetLabel}。原文「${input.source.summary}」をもとにした翻訳下書きです。`,
      body: `# ${title}\n\n> 翻訳先: ${input.targetLabel}\n> 原文コンテンツID: ${input.source.id}\n> 原文バージョン: ${input.source.version}\n\n${input.source.body}${translationNote}`,
      seo: {
        title: `【${input.targetLabel}】${input.source.seo.title}`,
        description: `翻訳版: ${input.source.seo.description}`,
        ogTitle: `【${input.targetLabel}】${input.source.seo.ogTitle}`,
        ogDescription: `翻訳版: ${input.source.seo.ogDescription}`,
        keywords: trimList([...input.source.seo.keywords, input.targetLocale]),
      },
    };
  }
}

/**
 * CMS-OS Content Agent Protocol v1に接続する汎用HTTPアダプターです。
 * 特定のAIベンダーに依存せず、BuilderOSやCMS-OS本体から分離した推論サービスを接続します。
 */
export class HttpContentAgentAdapter implements ContentAgentAdapter {
  public readonly id = "http-content-agent";
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: HttpContentAgentAdapterOptions) {
    const endpoint = options.endpoint.trim();
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("CMS_OS_CONTENT_AGENT_ENDPOINTはhttpまたはhttpsで指定してください。");
    }
    this.endpoint = endpoint;
    this.apiKey = options.apiKey?.trim() || undefined;
    this.model = options.model?.trim() || undefined;
    this.timeoutMs = Number.isSafeInteger(options.timeoutMs) && (options.timeoutMs ?? 0) >= 1 ? options.timeoutMs! : 30_000;
    this.maxRequestBytes = Number.isSafeInteger(options.maxRequestBytes) && (options.maxRequestBytes ?? 0) >= 1 ? options.maxRequestBytes! : DEFAULT_MAX_REQUEST_BYTES;
    this.maxResponseBytes = Number.isSafeInteger(options.maxResponseBytes) && (options.maxResponseBytes ?? 0) >= 1 ? options.maxResponseBytes! : DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public propose(input: ContentAgentProposalInput): Promise<ContentAgentProposalOutput> {
    return this.request("propose", input);
  }

  public draft(input: ContentAgentDraftInput): Promise<ContentAgentDraftOutput> {
    return this.request("draft", input);
  }

  public polish(input: ContentAgentPolishInput): Promise<ContentAgentPolishOutput> {
    return this.request("polish", input);
  }

  public translate(input: ContentAgentTranslateInput): Promise<ContentAgentTranslateOutput> {
    return this.request("translate", input);
  }

  public planPortal(input: ContentAgentPortalPlanInput): Promise<ContentAgentPortalPlanOutput> {
    return this.request("portal_plan", input);
  }

  private async request<T>(operation: string, input: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const requestBody = JSON.stringify({
        protocol: "cms-os-content-agent/v1",
        operation,
        ...(this.model ? { model: this.model } : {}),
        input,
      });
      if (Buffer.byteLength(requestBody, "utf8") > this.maxRequestBytes) {
        throw new Error(`AIエージェントへの入力が上限（${this.maxRequestBytes}バイト）を超えています。`);
      }
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: requestBody,
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isSafeInteger(declaredLength) && declaredLength > this.maxResponseBytes) {
        throw new Error(`AIエージェントの応答が上限（${this.maxResponseBytes}バイト）を超えています。`);
      }
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > this.maxResponseBytes) {
        throw new Error(`AIエージェントの応答が上限（${this.maxResponseBytes}バイト）を超えています。`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        throw new Error("AIプロバイダーがJSON形式の応答を返しませんでした。");
      }
      if (!response.ok) throw new Error(`AIプロバイダーの呼び出しに失敗しました（HTTP ${response.status}）。`);
      if (!payload || typeof payload !== "object" || !("output" in payload)) {
        throw new Error("AIプロバイダーの応答にoutputがありません。");
      }
      return (payload as { output: T }).output;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`AIプロバイダーが${this.timeoutMs}ms以内に応答しませんでした。`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** 環境変数が未設定なら無料・ローカル利用可能な決定的アダプターを返します。 */
export function contentAgentAdapterFromEnvironment(env: NodeJS.ProcessEnv = process.env): ContentAgentAdapter {
  const endpoint = env.CMS_OS_CONTENT_AGENT_ENDPOINT?.trim();
  if (!endpoint) return new DeterministicContentAgentAdapter();
  const timeoutValue = Number(env.CMS_OS_CONTENT_AGENT_TIMEOUT_MS ?? "30000");
  const maxRequestValue = Number(env.CMS_OS_CONTENT_AGENT_MAX_REQUEST_BYTES ?? String(DEFAULT_MAX_REQUEST_BYTES));
  const maxResponseValue = Number(env.CMS_OS_CONTENT_AGENT_MAX_RESPONSE_BYTES ?? String(DEFAULT_MAX_RESPONSE_BYTES));
  return new HttpContentAgentAdapter({
    endpoint,
    ...(env.CMS_OS_CONTENT_AGENT_API_KEY?.trim() ? { apiKey: env.CMS_OS_CONTENT_AGENT_API_KEY.trim() } : {}),
    ...(env.CMS_OS_CONTENT_AGENT_MODEL?.trim() ? { model: env.CMS_OS_CONTENT_AGENT_MODEL.trim() } : {}),
    ...(Number.isSafeInteger(timeoutValue) && timeoutValue >= 1 ? { timeoutMs: timeoutValue } : {}),
    ...(Number.isSafeInteger(maxRequestValue) && maxRequestValue >= 1 ? { maxRequestBytes: maxRequestValue } : {}),
    ...(Number.isSafeInteger(maxResponseValue) && maxResponseValue >= 1 ? { maxResponseBytes: maxResponseValue } : {}),
  });
}
