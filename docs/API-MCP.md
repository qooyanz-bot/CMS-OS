# CMS-OS API/MCP仕様方針

## 目的

CMS-OSの全操作を、管理画面に依存せずAPIまたはMCPから実行可能にする。AIエージェント、BuilderOS Adapter、外部システム、CLI、管理画面は、共通のドメインサービスを利用する。

REST APIの契約正本は[OpenAPI 3.1定義](openapi.json)です。実装、管理画面、BuilderOS Adapter、外部クライアントはこの定義を基準にします。

## 操作面の構成

```text
管理画面 ─┐
AIエージェント ─┼─ API / MCP ─ ドメインサービス ─ データベース・ジョブ・公開基盤
BuilderOS Adapter ─┘
```

- API：外部アプリケーション、管理画面、CLI、連携基盤向け
- MCP：AIエージェントがCMSを安全に操作するためのツール・リソース向け
- ドメインサービス：APIとMCPが共有する唯一の業務ロジック

## 操作カバレッジ

| 領域 | 必須操作 |
|---|---|
| コンテンツ | 作成、取得、検索、更新、削除、複製、版管理、翻訳、アーカイブ |
| AI編集 | 企画提案、構成作成、下書き、清書、要約、翻訳、事実確認、SEO監査 |
| ワークフロー | レビュー依頼、承認、差し戻し、予約公開、公開取消 |
| メディア | 登録、取得、変換、メタデータ更新、権利情報管理 |
| SEO | メタ情報、canonical、構造化データ、sitemap、robots、内部リンク監査 |
| 公開 | ビルド、プレビュー、公開、ロールバック、公開状態取得 |
| 依頼・送客 | 依頼作成、担当事業者への割当、依頼一覧、問い合わせ、ステータス更新 |
| 採用 | 求人検索、応募作成、応募状況、事業者側の応募確認 |
| 運用 | ジョブ、再試行、Webhook、監査ログ、権限、テナント設定 |

## API方針

- `/api/v1`のような明示的なバージョンを持つ
- リソース指向のREST/JSONを基本とする
- OpenAPIをAPI契約の正本とする
- 一覧取得はページネーション、フィルター、検索、ソートに対応する
- エラー形式を統一する
- 更新・公開・ジョブ投入には冪等性キーを利用できるようにする
- 認証、テナント境界、ロール、スコープをサーバー側で検証する
- 非同期処理はジョブIDを返し、状態をAPIで取得できるようにする

開発版で実装済みのコンテンツ操作は次の通りです。

```text
POST /api/v1/auth/oidc/start
GET  /api/v1/auth/oidc/callback
POST /api/v1/auth/mfa/enroll
POST /api/v1/auth/mfa/confirm
POST /api/v1/auth/mfa/complete
POST /api/v1/content/proposals
GET  /api/v1/content/proposals
POST /api/v1/content/drafts
GET  /api/v1/content
GET  /api/v1/content/{contentId}
POST /api/v1/content/{contentId}/polish
POST /api/v1/content/{contentId}/seo-audit
POST /api/v1/content/{contentId}/fact-check
POST /api/v1/content/{contentId}/approve
POST /api/v1/publications/build
POST /api/v1/publications/deploy
```

## MCP方針

MCP Serverは、APIの単なる別実装ではなく、APIと同じドメインサービスを呼び出す薄い操作アダプターとする。

例として、次のツールを提供する。

- `content.propose`
- `auth.login`
- `auth.me`
- `auth.logout`
- `auth.oidc_start`
- `auth.oidc_callback`
- `auth.mfa_enroll`
- `auth.mfa_confirm`
- `auth.mfa_complete`
- `content.list`
- `content.draft`
- `content.polish`
- `content.fact_check`
- `seo.audit`
- `workflow.approve`
- `publication.build`
- `publication.deploy`
- `workflow.request_review`
- `workflow.approve`
- `request.create`
- `request.list`
- `job.search`
- `application.create`
- `application.list`
- `publication.build`
- `publication.publish`
- `publication.rollback`

各ツールには、入力スキーマ、権限、対象テナント、承認要件、実行結果、監査情報を定義する。破壊的操作や公開操作は、プレビューまたはドライランを基本とする。

## 禁止事項

- 管理画面だけで実行できるCMS操作を作らない
- MCPだけに存在する業務ロジックを作らない
- APIとMCPで権限・承認・監査のルールを分けない
- AIエージェントに承認なしのIR公開権限を与えない
- 直接DB操作を正式な外部連携手段にしない

## 実装順序

1. ドメイン操作と権限モデル
2. OpenAPIによるAPI契約
3. 共通ドメインサービス
4. MCP Serverとツール定義
5. 管理画面・AIエージェント・BuilderOS Adapter
6. API/MCPの契約テストと監査テスト
