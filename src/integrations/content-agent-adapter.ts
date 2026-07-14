import type {
  CategorySlug,
  ContentAudience,
  ContentJsonLdType,
  ContentLocale,
  ContentProposal,
  ContentRecord,
  ContentSeo,
  ContentType,
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

/**
 * CMS-OSのAI編集機能とモデルプロバイダーの境界です。
 *
 * 実運用ではこのインターフェースをOpenAI互換API、社内モデル、または
 * キュー経由の非同期ワーカーで実装します。API/MCPの入力・権限・監査・
 * SEOゲートはContentService側に残るため、モデルを交換しても契約は変わりません。
 */
export interface ContentAgentAdapter {
  readonly id: string;
  propose(input: ContentAgentProposalInput): ContentAgentProposalOutput;
  draft(input: ContentAgentDraftInput): ContentAgentDraftOutput;
  polish(input: ContentAgentPolishInput): ContentAgentPolishOutput;
  translate(input: ContentAgentTranslateInput): ContentAgentTranslateOutput;
}

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
