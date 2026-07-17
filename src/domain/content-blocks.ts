import type { ContentBlock } from "./types.js";

const MAX_BLOCKS = 100;
const MAX_BLOCK_TEXT = 20_000;
const MAX_BLOCK_ITEMS = 50;

function objectValue(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName}はオブジェクトで指定してください。`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, fieldName: string, maxLength = MAX_BLOCK_TEXT): string {
  if (typeof value !== "string") throw new Error(`${fieldName}は文字列で指定してください。`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName}は空にできません。`);
  if (normalized.length > maxLength) throw new Error(`${fieldName}は${maxLength}文字以内で指定してください。`);
  return normalized;
}

function optionalText(value: unknown, fieldName: string, maxLength = MAX_BLOCK_TEXT): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, fieldName, maxLength);
}

function requiredId(value: unknown, fieldName: string): string {
  return requiredText(value, fieldName, 200);
}

function safeUrl(value: unknown, fieldName: string): string {
  const candidate = requiredText(value, fieldName, 2_000);
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${fieldName}はサイト内パスまたは有効なHTTPS URLで指定してください。`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${fieldName}はHTTPS URLで指定してください。`);
  return parsed.toString();
}

function textList(value: unknown, fieldName: string, maxItems = MAX_BLOCK_ITEMS): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new Error(`${fieldName}は1〜${maxItems}件の配列で指定してください。`);
  }
  return value.map((item, index) => requiredText(item, `${fieldName}[${index}]`, 2_000));
}

function renderText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
}

function renderLink(label: string, url: string): string {
  return `[${renderText(label)}](${url})`;
}

function normalizeBlock(value: unknown, index: number): ContentBlock {
  const block = objectValue(value, `blocks[${index}]`);
  const type = requiredText(block.type, `blocks[${index}].type`, 40);
  switch (type) {
    case "heading": {
      const level = block.level === undefined ? 2 : block.level;
      if (level !== 1 && level !== 2 && level !== 3) throw new Error(`blocks[${index}].levelは1〜3で指定してください。`);
      return { type, level, text: requiredText(block.text, `blocks[${index}].text`) };
    }
    case "paragraph":
      return { type, text: requiredText(block.text, `blocks[${index}].text`) };
    case "image":
      return {
        type,
        url: safeUrl(block.url, `blocks[${index}].url`),
        alt: requiredText(block.alt, `blocks[${index}].alt`, 300),
        ...(optionalText(block.caption, `blocks[${index}].caption`, 1_000) ? { caption: optionalText(block.caption, `blocks[${index}].caption`, 1_000) } : {}),
      };
    case "gallery": {
      if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 20) {
        throw new Error(`blocks[${index}].itemsは1〜20件で指定してください。`);
      }
      const items = block.items.map((item, itemIndex) => {
        const image = objectValue(item, `blocks[${index}].items[${itemIndex}]`);
        return {
          url: safeUrl(image.url, `blocks[${index}].items[${itemIndex}].url`),
          alt: requiredText(image.alt, `blocks[${index}].items[${itemIndex}].alt`, 300),
          ...(optionalText(image.caption, `blocks[${index}].items[${itemIndex}].caption`, 1_000) ? { caption: optionalText(image.caption, `blocks[${index}].items[${itemIndex}].caption`, 1_000) } : {}),
        };
      });
      return { type, items, ...(optionalText(block.caption, `blocks[${index}].caption`, 1_000) ? { caption: optionalText(block.caption, `blocks[${index}].caption`, 1_000) } : {}) };
    }
    case "video":
      return {
        type,
        url: safeUrl(block.url, `blocks[${index}].url`),
        ...(optionalText(block.title, `blocks[${index}].title`, 300) ? { title: optionalText(block.title, `blocks[${index}].title`, 300) } : {}),
        ...(optionalText(block.caption, `blocks[${index}].caption`, 1_000) ? { caption: optionalText(block.caption, `blocks[${index}].caption`, 1_000) } : {}),
      };
    case "quote":
      return {
        type,
        text: requiredText(block.text, `blocks[${index}].text`),
        ...(optionalText(block.attribution, `blocks[${index}].attribution`, 300) ? { attribution: optionalText(block.attribution, `blocks[${index}].attribution`, 300) } : {}),
      };
    case "table": {
      const headers = textList(block.headers, `blocks[${index}].headers`, 20);
      if (!Array.isArray(block.rows) || block.rows.length > 100) throw new Error(`blocks[${index}].rowsは100行以内で指定してください。`);
      const rows = block.rows.map((row, rowIndex) => {
        const cells = textList(row, `blocks[${index}].rows[${rowIndex}]`, 20);
        if (cells.length !== headers.length) throw new Error(`blocks[${index}].rows[${rowIndex}]の列数がheadersと一致しません。`);
        return cells;
      });
      return { type, headers, rows };
    }
    case "file":
      return {
        type,
        url: safeUrl(block.url, `blocks[${index}].url`),
        label: requiredText(block.label, `blocks[${index}].label`, 300),
        ...(optionalText(block.description, `blocks[${index}].description`, 2_000) ? { description: optionalText(block.description, `blocks[${index}].description`, 2_000) } : {}),
      };
    case "embed":
      return {
        type,
        url: safeUrl(block.url, `blocks[${index}].url`),
        ...(optionalText(block.title, `blocks[${index}].title`, 300) ? { title: optionalText(block.title, `blocks[${index}].title`, 300) } : {}),
      };
    case "cta":
      return {
        type,
        label: requiredText(block.label, `blocks[${index}].label`, 300),
        url: safeUrl(block.url, `blocks[${index}].url`),
        ...(optionalText(block.description, `blocks[${index}].description`, 1_000) ? { description: optionalText(block.description, `blocks[${index}].description`, 1_000) } : {}),
      };
    case "jobCard":
    case "pressReleaseCard":
    case "irDocumentCard":
      return {
        type,
        contentId: requiredId(block.contentId, `blocks[${index}].contentId`),
        title: requiredText(block.title, `blocks[${index}].title`, 300),
        ...(block.url === undefined ? {} : { url: safeUrl(block.url, `blocks[${index}].url`) }),
      };
    case "relatedContent":
      return {
        type,
        contentIds: textList(block.contentIds, `blocks[${index}].contentIds`, 20),
        ...(optionalText(block.title, `blocks[${index}].title`, 300) ? { title: optionalText(block.title, `blocks[${index}].title`, 300) } : {}),
      };
    case "companyCard":
      return {
        type,
        providerId: requiredId(block.providerId, `blocks[${index}].providerId`),
        name: requiredText(block.name, `blocks[${index}].name`, 300),
        ...(block.url === undefined ? {} : { url: safeUrl(block.url, `blocks[${index}].url`) }),
        ...(optionalText(block.description, `blocks[${index}].description`, 1_000) ? { description: optionalText(block.description, `blocks[${index}].description`, 1_000) } : {}),
      };
    default:
      throw new Error(`blocks[${index}].typeが未対応です。`);
  }
}

export function normalizeContentBlocks(value: unknown): ContentBlock[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BLOCKS) {
    throw new Error(`blocksは1〜${MAX_BLOCKS}件の配列で指定してください。`);
  }
  return value.map((block, index) => normalizeBlock(block, index));
}

export function renderContentBlocks(blocks: ContentBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case "heading": return `${"#".repeat(block.level)} ${renderText(block.text)}`;
      case "paragraph": return renderText(block.text);
      case "image": return `![${renderText(block.alt)}](${block.url})${block.caption ? `\n\n${renderText(block.caption)}` : ""}`;
      case "gallery": return block.items.map((item) => `![${renderText(item.alt)}](${item.url})${item.caption ? `\n${renderText(item.caption)}` : ""}`).join("\n\n");
      case "video": return `[動画: ${renderText(block.title ?? block.url)}](${block.url})${block.caption ? `\n\n${renderText(block.caption)}` : ""}`;
      case "quote": return `> ${renderText(block.text)}${block.attribution ? ` — ${renderText(block.attribution)}` : ""}`;
      case "table": return [
        `| ${block.headers.map(renderText).join(" | ")} |`,
        `| ${block.headers.map(() => "---").join(" | ")} |`,
        ...block.rows.map((row) => `| ${row.map(renderText).join(" | ")} |`),
      ].join("\n");
      case "file": return `${renderLink(block.label, block.url)}${block.description ? `\n\n${renderText(block.description)}` : ""}`;
      case "embed": return `${block.title ? `### ${renderText(block.title)}\n\n` : ""}${renderLink("埋め込みコンテンツを開く", block.url)}`;
      case "cta": return `### ${renderText(block.label)}\n\n${block.description ? `${renderText(block.description)}\n\n` : ""}${renderLink(block.label, block.url)}`;
      case "jobCard": return `- 求人: ${block.url ? renderLink(block.title, block.url) : renderText(block.title)}（contentId: ${renderText(block.contentId)}）`;
      case "pressReleaseCard": return `- プレスリリース: ${block.url ? renderLink(block.title, block.url) : renderText(block.title)}（contentId: ${renderText(block.contentId)}）`;
      case "irDocumentCard": return `- IR資料: ${block.url ? renderLink(block.title, block.url) : renderText(block.title)}（contentId: ${renderText(block.contentId)}）`;
      case "relatedContent": return `${block.title ? `### ${renderText(block.title)}\n\n` : ""}${block.contentIds.map((contentId) => `- 関連コンテンツ: ${renderText(contentId)}`).join("\n")}`;
      case "companyCard": return `- 事業者: ${block.url ? renderLink(block.name, block.url) : renderText(block.name)}（providerId: ${renderText(block.providerId)}）${block.description ? `\n\n${renderText(block.description)}` : ""}`;
    }
  }).join("\n\n");
}
