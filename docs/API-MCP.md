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
- 認証系のREST/MCP入口では、IP・識別子単位のレート制限により超過時はHTTP 429（`Retry-After`付き）を返す
- 更新・公開・ジョブ投入には冪等性キーを利用できるようにする
- 認証、テナント境界、ロール、スコープをサーバー側で検証する
- 非同期処理はジョブIDを返し、状態をAPIで取得できるようにする

開発版で実装済みのコンテンツ操作は次の通りです。

```text
GET  /api/v1/auth/config
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
PATCH /api/v1/content/{contentId}
DELETE /api/v1/content/{contentId}                 # アーカイブ
POST /api/v1/content/{contentId}/duplicate
POST /api/v1/content/{contentId}/restore
POST /api/v1/content/{contentId}/polish
POST /api/v1/content/{contentId}/seo-audit
POST /api/v1/content/{contentId}/fact-check
POST /api/v1/content/{contentId}/approve
POST /api/v1/publications/build
POST /api/v1/publications/deploy
POST /api/v1/publications/publish
GET  /api/v1/providers/{providerId}
PATCH /api/v1/providers/{providerId}
POST /api/v1/providers/{providerId}/listing-submission
PATCH /api/v1/providers/{providerId}/listing-review
GET  /api/v1/provider-listing-reviews
POST /api/v1/inquiries
GET  /api/v1/inquiries
PATCH /api/v1/inquiries/{inquiryId}
GET  /api/v1/notifications
PATCH /api/v1/notifications/{notificationId}
POST /api/v1/jobs
PATCH /api/v1/jobs/{jobId}
```

## 事業者掲載情報と求人管理

- `GET /api/v1/providers/{providerId}` は、未ログインを含む現在のカテゴリ・ロールに応じて掲載情報を投影します。
- `PATCH /api/v1/providers/{providerId}` は、対象カテゴリの事業者本人だけが利用できます。名前、テーマ、所在地、公開項目を更新でき、`id`、カテゴリ、ロール別項目、確認状態などの保護項目は更新できません。
- `POST /api/v1/jobs` と `PATCH /api/v1/jobs/{jobId}` は、事業者本人のカテゴリ・providerIdを検証します。求人状態は `published` または `closed` です。
- 公開・ユーザー・発注者・リクルーターには公開中求人だけを返し、事業者本人には自社求人の状態を含めて返します。

掲載情報の状態は `draft`、`pending_review`、`published`、`suspended` を使います。事業者本人の `listing-submission` は審査待ちへ進め、審査待ちの事業者は公開検索から除外します。運営審査用の `listing-review` は4つのポータルロールとは分離し、`CMS_OS_OPERATOR_KEY` と `x-cms-os-operator-key` ヘッダーで保護します。

問い合わせは `inquiry.create` で公開事業者へ送信し、`inquiry.list` では送信者本人または担当事業者だけが取得できます。状態遷移は `open` → `responded` → `closed` に限定し、RESTとMCPで同じ所有者検証を実行します。

通知は問い合わせ作成・状態変更・掲載審査送信・審査結果を契機に作成します。`GET /api/v1/notifications` と `notification.list` は `limit`（1〜100）と `cursor` を受け取り、本人または自社事業者の通知だけを返します。通知の既読状態は `PATCH /api/v1/notifications/{notificationId}` または `notification.mark_read` で更新します。

運営審査キューは `GET /api/v1/provider-listing-reviews` または `provider.listing_review_queue` で取得します。`category`、`status`、`limit`、`cursor` で絞り込み・ページングできます。審査キューと掲載審査更新は、ログインロールではなく運営キーで保護します。

## MCP方針

MCP Serverは、APIの単なる別実装ではなく、APIと同じドメインサービスを呼び出す薄い操作アダプターとする。

例として、次のツールを提供する。

- `content.propose`
- `auth.login`
- `auth.me`
- `auth.logout`
- `auth.config`
- `auth.oidc_start`
- `auth.oidc_callback`
- `auth.mfa_enroll`
- `auth.mfa_confirm`
- `auth.mfa_complete`
- `content.list`
- `content.draft`
- `content.update`
- `content.duplicate`
- `content.archive`
- `content.restore`
- `content.polish`
- `content.fact_check`
- `seo.audit`
- `workflow.approve`
- `publication.build`
- `publication.deploy`
- `publication.publish`
- `provider.get`
- `provider.update`
- `provider.listing_submit`
- `provider.listing_review`
- `provider.listing_review_queue`
- `request.create`
- `request.list`
- `request.update_status`
- `inquiry.create`
- `inquiry.list`
- `inquiry.update_status`
- `notification.list`
- `notification.mark_read`
- `job.search`
- `job.create`
- `job.update`
- `application.create`
- `application.list`
- `application.update_status`

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
