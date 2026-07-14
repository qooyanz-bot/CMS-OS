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
| ポータル案内 | カテゴリ別の外部ディレクトリ、予約、事業者向け案内 |
| ポータル計画 | テーマ・地域・対象ポジションから検索意図、SEOページ案、既存コンテンツの被覆、不足情報、次アクションを生成し、企画案・下書きへ反映 |
| 運用 | ジョブ、再試行、Webhook、監査ログ、権限、テナント設定 |

RESTに定義したCMS操作は、対応するMCPツールを必ず持つ。`tests/api-mcp-parity.test.ts`がOpenAPIの`operationId`とMCPツールの対応、`tools/list`の網羅性、各入力スキーマを自動検証する。新しいREST操作を追加する場合は、同じ変更で対応MCPツールと対応表を追加する。

## API方針

- `/api/v1`のような明示的なバージョンを持つ
- リソース指向のREST/JSONを基本とする
- OpenAPIをAPI契約の正本とする
- 一覧取得はページネーション、フィルター、検索、ソートに対応する
- エラー形式を統一する
- 認証系のREST/MCP入口では、IP・識別子単位のレート制限により超過時はHTTP 429（`Retry-After`付き）を返す
- 更新・公開・ジョブ投入は冪等性キーに対応させ、現在は非同期コンテンツ作成ジョブ投入で同一入力の再送を重複実行しない
- 認証、テナント境界、ロール、スコープをサーバー側で検証する
- 非同期処理はジョブIDを返し、状態をAPI/MCPで取得できるようにする

開発版で実装済みのコンテンツ操作は次の通りです。

```text
GET  /api/v1/auth/config
ログインロールは`user`、`orderer`、`provider`、`recruiter`を正式な公開名とし、既存クライアント互換のため`candidate`もリクルーターと同じ権限で受け付けます。
GET  /api/v1/categories
GET  /api/v1/categories/{category}
GET  /api/v1/categories/{category}/experience
GET  /api/v1/categories/{category}/directories
POST /api/v1/directories                  # 運営キーで外部案内を追加
PATCH /api/v1/directories/{directoryId}   # 運営キーで外部案内を更新
DELETE /api/v1/directories/{directoryId}  # 運営キーで外部案内を削除
POST /api/v1/portal-plans                 # 事業者がテーマ・地域・対象ポジションから計画を生成
GET  /api/v1/portal-plans?limit=50&cursor=0
GET  /api/v1/portal-plans/{planId}
POST /api/v1/portal-plans/{planId}/apply  # ページ案をコンテンツ企画案へ冪等に反映
外部案内の管理操作は `CMS_OS_OPERATOR_KEY` と `x-cms-os-operator-key` ヘッダーで保護します。通常のログインロールには運営キーを渡しません。
POST /api/v1/auth/oidc/start
GET  /api/v1/auth/oidc/callback
POST /api/v1/auth/mfa/enroll
POST /api/v1/auth/mfa/confirm
POST /api/v1/auth/mfa/complete
POST /api/v1/content/proposals
GET  /api/v1/content/proposals
POST /api/v1/content/drafts
POST /api/v1/content                         # 検証済み本文を直接下書き登録
GET  /api/v1/content
GET  /api/v1/content/{contentId}
PATCH /api/v1/content/{contentId}
DELETE /api/v1/content/{contentId}                 # アーカイブ
POST /api/v1/content/{contentId}/duplicate
POST /api/v1/content/{contentId}/restore
POST /api/v1/content/{contentId}/polish
POST /api/v1/content/{contentId}/seo-audit
GET /api/v1/seo/audit
POST /api/v1/content/{contentId}/fact-check
GET  /api/v1/content/{contentId}/reviews
POST /api/v1/content/{contentId}/review-request
POST /api/v1/content/{contentId}/request-changes
POST /api/v1/content/{contentId}/approve
GET  /api/v1/publications
POST /api/v1/publications/build
POST /api/v1/publications/deploy
POST /api/v1/publications/publish
POST /api/v1/publications/unpublish
GET  /api/v1/publications/schedules
POST /api/v1/publications/schedules
POST /api/v1/publications/schedules/execute
POST /api/v1/publications/schedules/{scheduleId}/cancel
POST /api/v1/publications/{publicationId}/rollback
GET  /api/v1/providers?category=legal&limit=50&cursor=0
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
GET  /api/v1/requests?limit=50&cursor=0
GET  /api/v1/jobs?category=legal&limit=50&cursor=0
GET  /api/v1/applications?limit=50&cursor=0
POST /api/v1/jobs
PATCH /api/v1/jobs/{jobId}
```

コンテンツの`GET`応答には、実行済みであれば`lastSeoAudit`と`lastFactCheck`が含まれます。各結果の`contentVersion`が現在のコンテンツ`version`と一致しない場合、その結果は古い証跡として扱われ、承認には利用できません。`approve`は、最新版のファクトチェックが合格し、SEO監査に重大なエラーがない場合だけ成功します。

コンテンツの版管理は次のREST APIとMCPツールで提供します。

- `GET /api/v1/content/{contentId}/versions` / `content.versions`
- `GET /api/v1/content/{contentId}/versions/{version}` / `content.version_get`
- `POST /api/v1/content/{contentId}/versions/{version}/restore` / `content.version_restore`

版の復元は新しい下書き版を作成し、古いSEO監査・ファクトチェック証跡を破棄します。復元後は再監査が必要です。版履歴はコンテンツ所有者である事業者本人だけが取得・復元できます。

レビュー依頼は`seo_reviewed`かつ最新版のファクトチェック・SEO監査が有効なコンテンツだけが実行できます。レビュー中は編集を禁止し、`request-changes`で理由を付けて`changes_requested`へ戻します。再編集後は監査をやり直し、再度レビューを依頼します。レビュー履歴は`workflow.reviews`または`GET /api/v1/content/{contentId}/reviews`で取得できます。

管理画面や外部クライアントは、カテゴリごとの表示を決める際に`GET /api/v1/categories/{category}`を利用します。応答の`experience.visibleModules`、`experience.allowedActions`、`navigation`、`directoryGuides`を同じカテゴリ文脈として扱い、UIだけで表示制御を再実装しません。

## 事業者掲載情報と求人管理

- `GET /api/v1/providers/{providerId}` は、未ログインを含む現在のカテゴリ・ロールに応じて掲載情報を投影します。
- `PATCH /api/v1/providers/{providerId}` は、対象カテゴリの事業者本人だけが利用できます。名前、テーマ、所在地、公開項目を更新でき、`id`、カテゴリ、ロール別項目、確認状態などの保護項目は更新できません。
- `POST /api/v1/jobs` と `PATCH /api/v1/jobs/{jobId}` は、事業者本人のカテゴリ・providerIdを検証します。求人状態は `published` または `closed` です。
- 公開・ユーザー・発注者・リクルーターには公開中求人だけを返し、事業者本人には自社求人の状態を含めて返します。

掲載情報の状態は `draft`、`pending_review`、`published`、`suspended` を使います。事業者本人の `listing-submission` は審査待ちへ進め、審査待ちの事業者は公開検索から除外します。運営審査用の `listing-review` は4つのポータルロールとは分離し、`CMS_OS_OPERATOR_KEY` と `x-cms-os-operator-key` ヘッダーで保護します。

問い合わせは `inquiry.create` で公開事業者へ送信し、`inquiry.list` では送信者本人または担当事業者だけが取得できます。状態遷移は `open` → `responded` → `closed` に限定し、RESTとMCPで同じ所有者検証を実行します。

通知は問い合わせ作成・状態変更・掲載審査送信・審査結果を契機に作成します。`GET /api/v1/notifications` と `notification.list` は `limit`（1〜100）と `cursor` を受け取り、本人または自社事業者の通知だけを返します。通知の既読状態は `PATCH /api/v1/notifications/{notificationId}` または `notification.mark_read` で更新します。

運営審査キューは `GET /api/v1/provider-listing-reviews` または `provider.listing_review_queue` で取得します。`category`、`status`、`limit`、`cursor` で絞り込み・ページングできます。審査キューと掲載審査更新は、ログインロールではなく運営キーで保護します。

依頼、求人、応募の一覧も `limit`（1〜100）と `cursor` による共通ページ形式 `{ items, page }` を返します。MCPでは `request.list`、`job.search`、`application.list` に同じ引数を渡します。依頼作成・状態変更、応募作成・状態変更も通知を作成し、対象の発注者、事業者、リクルーターへ投影します。

## ポータル一覧の検索・ソート・フィルター

一覧系のRESTとMCPは、ページングと検索条件を同じドメインサービスで処理します。指定した条件はすべてAND条件で組み合わせます。`limit` は1〜100、`cursor` は次ページの開始位置です。

| 一覧 | 検索・フィルター | `sort` |
|---|---|---|
| `provider.search` / `GET /api/v1/providers` | `search`、`theme`、`location` | `relevance`、`name_asc`、`location_asc` |
| `request.list` / `GET /api/v1/requests` | `search`、`status` | `createdAt_desc`、`createdAt_asc`、`title_asc` |
| `job.search` / `GET /api/v1/jobs` | `search`、`employmentType`、`location`、`status` | `title_asc`、`title_desc`、`location_asc` |
| `application.list` / `GET /api/v1/applications` | `search`、`jobId`、`status` | `createdAt_desc`、`createdAt_asc`、`status` |
| `content.list` / `GET /api/v1/content` | `search`、`status`、`audience`、`contentType`、`locale` | `updatedAt_desc`、`updatedAt_asc`、`title_asc`、`status` |

コンテンツ一覧は、現在のカテゴリ・事業者に属するデータだけを対象に、対象ポジション（`audience`）、コンテンツ種別、言語、ワークフロー状態をAND条件で絞り込みます。AIエージェントは`page.nextCursor`を使って大量生成後の監査対象を分割取得できます。

予約公開は`publication.schedule` / `POST /api/v1/publications/schedules`で作成します。作成時に承認済みコンテンツの静的スナップショットを固定するため、予約後に編集された内容が意図せず混ざりません。`publication.schedule_list` / `GET /api/v1/publications/schedules`で一覧を取得し、未実行の予約だけを`publication.schedule_cancel`で取り消せます。事業者トークンで`publication.schedule_execute` / `POST /api/v1/publications/schedules/execute`を呼び出すと自社分を実行し、`CMS_OS_OPERATOR_KEY`と`x-cms-os-operator-key`を付けて呼び出すと全カテゴリの期限到来分を運営ジョブとして実行します。ドライランでは予約を実行済みにせず、実デプロイ成功時だけコンテンツとスケジュールを公開済みへ進めます。

公開済みコンテンツの除外は`publication.unpublish` / `POST /api/v1/publications/unpublish`で行います。除外対象を含まない新しい静的スナップショットをBuilderOS Adapter経由でデプロイし、実デプロイ成功時だけ対象コンテンツをアーカイブし、対象を含む未実行の予約公開を取消します。dry-runやデプロイ失敗時はCMSの公開状態を変更しません。

RESTの応答は `{ items, page }`、MCPの`structuredContent`も同じ形式です。認証が必要な一覧では、フィルター適用前にロール・カテゴリ・本人所有のアクセス制御を行い、他カテゴリや他ユーザーのデータが検索条件で露出しないようにします。

## MCP方針

MCP Serverは、APIの単なる別実装ではなく、APIと同じドメインサービスを呼び出す薄い操作アダプターとする。

例として、次のツールを提供する。

- `content.propose`
- `content.create`
- `content.create_batch`
- `webhook.list`
- `webhook.create`
- `webhook.update`
- `webhook.revoke`
- `webhook.deliveries`
- `webhook.retry`
- `webhook.deliver`
- `webhook.deliver_pending`
- `operation.submit`
- `operation.list`
- `operation.get`
- `operation.execute`
- `operation.execute_pending`
- `auth.login`
- `auth.me`
- `auth.logout`
- `auth.config`
- `directory.list`
- `category.get`
- `category.list`
- `directory.create`（運営キー）
- `directory.update`（運営キー）
- `directory.delete`（運営キー）
- `auth.oidc_start`
- `auth.oidc_callback`
- `auth.mfa_enroll`
- `auth.mfa_confirm`
- `auth.mfa_complete`
- `content.list`
- `content.get`
- `content.draft`
- `content.update`
- `content.translate`
- `content.versions`
- `content.version_get`
- `content.version_restore`
- `content.duplicate`
- `content.archive`
- `content.restore`
- `content.polish`
- `content.fact_check`
- `workflow.reviews`
- `workflow.request_review`
- `workflow.request_changes`
- `seo.audit`
- `seo.site_audit`
- `GET /api/v1/seo/audit`と`seo.site_audit`は、事業者が管理する公開対象をサイト全体で監査します。canonicalの不備・重複、SEOタイトルの重複、内部リンクの欠落・リンク先不在、JSON-LDタイプ、最新版のSEO監査・事実確認証跡を横断し、カテゴリ・事業者単位のスコアと改善提案を保存します。
- `workflow.approve`
- `publication.build`
- `publication.deploy`
- `publication.publish`
- `publication.unpublish`
- `publication.history`
- `publication.rollback`
- `provider.get`
- `provider.update`
- `provider.listing_submit`
- `provider.listing_review`
- `provider.listing_review_queue`
- `request.create`
- `request.list`（limit/cursor対応）
- `request.update_status`
- `inquiry.create`
- `inquiry.list`
- `inquiry.update_status`
- `notification.list`
- `notification.mark_read`
- `job.search`（limit/cursor対応）
- `job.create`
- `job.update`
- `application.create`
- `application.list`（limit/cursor対応）
- `application.update_status`

## メディアアセット管理

事業者は、カテゴリに紐づく画像・動画・PDFをAPIまたはMCPから同じ操作で管理できます。対象は現在のログインカテゴリと自分の事業者に限定します。

| REST | MCP | 用途 |
|---|---|---|
| `GET /api/v1/media` | `media.list` | キーワード、種別、公開状態、権利状態、ページングで検索 |
| `POST /api/v1/media` | `media.register` | ストレージキー、MIME、サイズ、altText、権利情報を登録 |
| `GET /api/v1/media/{assetId}` | `media.get` | アセットのメタデータを取得 |
| `PATCH /api/v1/media/{assetId}` | `media.update` | SEO・アクセシビリティ・権利情報を更新 |
| `DELETE /api/v1/media/{assetId}` | `media.archive` | 実体を削除せず論理アーカイブ |
| `POST /api/v1/media/{assetId}/transform` | `media.transform` | 画像・動画の変換条件を持つ派生アセットを作成 |
| `POST /api/v1/media/seo-audit` | `media.seo_audit` | 現在の事業者が管理するメディア全体を監査し、スコアと改善点を保存 |
| `POST /api/v1/media/{assetId}/seo-audit` | `media.asset_seo_audit` | 個別アセットのaltText、権利、公開URL、容量、表示寸法を監査 |

## 非同期操作ジョブ

大量生成や外部ジョブからの実行に対応するため、事業者はコンテンツ操作を非同期ジョブとして投入できます。`content.create`は単一登録、`content.create_batch`は検証済み本文の一括登録、`content.propose_batch`は対象ポジション別の企画案一括生成、`content.draft_batch`は企画案から下書きの一括生成に対応し、それぞれ同一カテゴリの1〜50件を1ジョブにまとめて処理します。投入時は `202` とジョブIDを返し、`operation.get` または `GET /api/v1/operations/{operationId}` で状態を取得します。バッチ成功時は`result.contentIds`または`result.proposalIds`、途中失敗時は作成済みIDと`completedCount`を返します。Cloudflare Cronなどの外部スケジューラは `operation.execute_pending` または `POST /api/v1/operations/execute-pending` を呼び出してキューを処理できます。

`Idempotency-Key` を指定すると、同じ事業者・操作・キー・入力の再送は既存ジョブを返します。同じキーで異なる入力を送ると `409` を返します。ジョブの入力本文は状態取得結果に含めず、カテゴリとproviderIdで所有者を分離します。

| REST | MCP | 内容 |
|---|---|---|
| `POST /api/v1/operations` | `operation.submit` | 単一・一括の非同期コンテンツ作成ジョブを投入 |
| `GET /api/v1/operations` | `operation.list` | 自分のジョブ一覧 |
| `GET /api/v1/operations/{operationId}` | `operation.get` | ジョブ状態を取得 |
| `POST /api/v1/operations/{operationId}/execute` | `operation.execute` | 指定ジョブを実行 |
| `POST /api/v1/operations/execute-pending` | `operation.execute_pending` | キュー済みジョブをまとめて実行 |

## Webhook配信アウトボックス

Webhookは事業者単位の購読として管理し、イベント発生時は署名付き配信をアウトボックスへ保存します。作成時に返す `secret` は一度だけ表示し、保存時は暗号化します。送信失敗は最大5回まで指数バックオフで再試行し、配信結果はAPI/MCPから確認できます。暗号化キーは `CMS_OS_WEBHOOK_ENCRYPTION_KEY` に固定して運用し、キーを変更すると既存secretを復号できなくなるため、ローテーション時は移行手順を用意してください。

| REST | MCP | 用途 |
|---|---|---|
| `GET /api/v1/webhooks` | `webhook.list` | 自分のWebhook購読一覧 |
| `POST /api/v1/webhooks` | `webhook.create` | 購読と対象イベントを登録 |
| `PATCH /api/v1/webhooks/{subscriptionId}` | `webhook.update` | 送信先・イベント・状態を更新 |
| `DELETE /api/v1/webhooks/{subscriptionId}` | `webhook.revoke` | 購読を論理停止 |
| `GET /api/v1/webhooks/deliveries` | `webhook.deliveries` | 配信履歴と再試行状態を取得 |
| `POST /api/v1/webhooks/deliveries/{deliveryId}/retry` | `webhook.retry` | 配信を再試行キューへ戻す |
| `POST /api/v1/webhooks/deliveries/{deliveryId}/deliver` | `webhook.deliver` | 指定配信を送信 |
| `POST /api/v1/webhooks/deliveries/deliver-pending` | `webhook.deliver_pending` | 再試行時刻を迎えた配信をまとめて送信 |

配信先には `X-CMS-OS-Event`、`X-CMS-OS-Delivery`、`X-CMS-OS-Signature: sha256=...` を付与します。Webhookの対象は現在の事業者とカテゴリに限定され、他事業者の購読・配信履歴は取得できません。

画像の `altText` は必須です。変換操作は派生アセットと変換条件をCMS-OSに保存し、実際のバイナリ変換・配信はBuilderOS Adapterまたは接続先ストレージに委譲できます。

メディアSEO監査は、構造化データの前段となるメタデータ品質、アクセシビリティ、公開可否、容量、権利状態、更新鮮度を決定的に検査します。外部検索順位やAIサービスの露出を直接測定する機能ではなく、API/MCPから再実行できる改善台帳として扱います。

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
