# CMS-OS

AIエージェントネイティブな、マルチカテゴリ対応のコンテンツ基盤です。

[日本語](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

CMS-OSは、企業情報、採用、PR、IR、ブログ、事業者ポータルを一つの基盤で管理します。ポジション、読者、カテゴリに応じた企画提案・下書き・清書・事実確認・SEO監査・承認・公開を、AIエージェントとAPI/MCPから実行できます。

現在はOSSとして開発中です。

## 主な機能

- AIエージェントによるテーマ提案、対象ポジション別の企画、下書き、清書、翻訳、事実確認、SEO監査
- `ユーザー`、`発注者`、`事業者`、`リクルーター`のロールと、カテゴリ単位の表示・操作権限
- 弁護士・士業、美容、採用などのカテゴリに対応できる事業者ポータルと外部案内
- コンテンツのレビュー、承認、公開、非公開、バージョン履歴
- 画像・動画・PDFなどのメディア管理、alt属性・構造化データ・内部リンクを含むSEO監査
- BuilderOS Adapterによる静的サイト生成とCloudflare Pages向け公開
- Portal Planning Agentによるテーマ・地域・対象ポジション別の検索意図、既存コンテンツの被覆・不足検出、SEOページ生成とコンテンツ下書きへの適用
- 全操作をREST API/MCPで提供し、OpenAPIを契約の正本として管理
- 署名付きWebhook、暗号化secret、配信アウトボックス、指数バックオフ再試行
- 非同期コンテンツ作成ジョブ、ジョブ状態取得、外部スケジューラ向け一括実行、冪等性キー

## ロールとカテゴリ別表示

| ロール | 主な表示・操作 |
|---|---|
| ユーザー | 公開コンテンツ、カテゴリ案内、公開事業者、問い合わせ |
| 発注者 | 事業者検索、発注依頼、依頼状況、注文者向け情報 |
| 事業者 | 自社掲載情報、案件、問い合わせ、求人、応募者、AIコンテンツ、公開ワークフロー |
| リクルーター | 求人検索、応募、応募状況、自分の応募履歴 |

表示対象と操作権限はカテゴリごとに定義され、別カテゴリや別事業者の情報は取得できません。

## コンテンツワークフロー

```text
REQUESTED → PROPOSED → DRAFTED → FACT_CHECKED → SEO_REVIEWED
→ EDITED → APPROVED → PUBLISHED
```

AIの出力は事実確認・レビュー・承認を経て公開します。IRや法務など正確性が重要な情報は、根拠と確認履歴を保持する前提です。

## API / MCP

CMS-OSの操作は、バージョン付きREST APIとMCPから実行できます。コンテンツ、認証、メディア、公開、ポータル、Webhook、SEO監査などの操作を同じドメインサービスで処理し、RESTとMCPの入力・権限・結果の整合性をテストしています。

- OpenAPI: [`docs/openapi.json`](docs/openapi.json)
- API/MCP仕様: [`docs/API-MCP.md`](docs/API-MCP.md)
- カテゴリ登録: [`docs/CATEGORY-REGISTRY.md`](docs/CATEGORY-REGISTRY.md)
- 永続化仕様: [`docs/STORAGE.md`](docs/STORAGE.md)

## 静的公開

CMS-OSは承認済みコンテンツをBuilderOS Adapterで静的HTML、CSS、JavaScript、画像、JSON-LDへ変換し、Cloudflare Pagesへ公開できる構成です。動的CMSの運用機能と、低コストな静的配信を分離します。

## 開発

前提: Node.js 22以上

```bash
npm ci
npm test
npm run dev
```

`npm test`はTypeScriptのビルド、API/MCP整合性、認証、カテゴリ別アクセス制御、コンテンツ、メディア、公開、Webhook、永続化のテストを実行します。

## リポジトリ方針

CMS-OSは、AIエージェントが安全に操作できるCMS-OSを目指します。生成、承認、公開、外部連携をAPI/MCPで検証可能にし、特定の編集画面や外部サービスだけに依存しない構成を採用します。外部サイト構築・公開の責務はBuilderOS Adapterに分離します。

開発ルールは [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。

## ライセンス

ライセンスは開発方針の確定後に決定します。
