# CMS-OSコンテンツワークフロー

## 目的

CMS-OSのAI編集機能は、単に本文を生成するのではなく、対象ポジション、検索意図、企業の確認済み情報、SEO要件を一つの編集単位として扱います。

現在の開発版では、外部AIプロバイダーに依存しない決定的アダプターを使用しています。企画、下書き、清書、翻訳は`ContentAgentAdapter`の差し替え契約を通過し、SEO監査・事実確認・権限境界はCMS-OS本体が保持します。本番ではこのアダプターを複数のAIモデルへ差し替えますが、API/MCP契約と公開承認ゲートは維持します。

AIが生成した企画・下書き・清書・翻訳には、`generationAudit`としてアダプターID、モデル名、入力ソース、生成日時、承認者を保存します。生成結果は自動公開せず、承認時に承認者を記録します。手動編集や外部APIからの直接登録には、AI生成物であると偽装するメタデータを自動付与しません。

## 対象ポジション

| audience | 対象 | 文章で重視する内容 |
|---|---|---|
| `customer` | 顧客・発注者 | 課題、料金、相談・予約・依頼の判断材料 |
| `candidate` | 求職者・リクルーター | 仕事内容、働き方、成長機会、応募判断 |
| `media` | 報道・メディア | ニュースの要点、背景、社会的な意味 |
| `investor` | 投資家・株主 | 事業指標、根拠、今後の見通し |
| `beginner` | 初心者・導入検討者 | 前提、選び方、最初の一歩 |
| `existingCustomer` | 既存顧客 | 利用方法、変更点、次のアクション |

## ワークフロー

```text
企画提案
  ↓ audience・検索意図・主キーワード・確認済み情報
対象ポジション別の下書き
  ↓ 見出し・本文・FAQ・JSON-LD・メタ情報
事実確認
  ↓ 登録済み一次情報と出典の確認
清書
  ↓ 表記、空白、読みやすさ、編集方針
SEO監査
  ↓ タイトル、説明文、H1、キーワード、canonical、出典をコンテンツ版数ごとに保存
レビュー依頼
  ↓ review_requested（依頼者・版数・メモを保存）
人間の確認
  ├─ 差し戻し → changes_requested → 再編集・再監査・再レビュー
  ↓ 承認
承認・静的公開
```

## REST API

```text
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
POST /api/v1/content/{contentId}/translate
POST /api/v1/content/{contentId}/seo-audit
GET /api/v1/seo/audit
POST /api/v1/content/{contentId}/fact-check
GET  /api/v1/content/{contentId}/reviews
POST /api/v1/content/{contentId}/review-request
POST /api/v1/content/{contentId}/request-changes
POST /api/v1/content/{contentId}/approve
GET  /api/v1/content/{contentId}/versions
GET  /api/v1/content/{contentId}/versions/{version}
POST /api/v1/content/{contentId}/versions/{version}/restore
POST /api/v1/publications/publish
```

`GET /api/v1/content/proposals`は`search`、`audience`、`contentType`、`sort`、`limit`、`cursor`で企画案を絞り込み、`{ items, page }`形式で返します。MCPでは`content.proposals`が同じ条件とページ形式を提供します。

## 多言語翻訳ワークフロー

`content.translate` は原文を上書きせず、原文の `contentId` と `version` を記録した言語別の翻訳下書きを作成します。対応言語は `ja`、`en`、`zh-CN`、`es`、`ko`、`de`、`fr` です。

大量生成では、`operation.submit`に`content.propose_batch`、`content.draft_batch`、`content.polish_batch`、`content.prepare_batch`を指定できます。前者は同一カテゴリ・最大50件の対象ポジション別企画案を生成し、`content.draft_batch`は企画案IDを最大50件受け取って下書きを生成します。`content.polish_batch`は下書きのcontentIdを最大50件受け取り、任意の清書方針を全対象へ適用します。`content.prepare_batch`は対象ポジション別の企画入力から企画・下書き・清書・事実確認・SEO監査を一つのジョブで実行し、`seo_reviewed`または監査エラー時の`polished`で停止します。承認・公開は自動実行せず、通常の人間確認ワークフローへ戻します。

- `locale` はコンテンツ単位で保持し、翻訳版は独立したURL・canonical・OG情報・JSON-LD言語属性を持ちます。
- `translationOf.sourceVersion` に原文の基準版を記録するため、原文更新後も翻訳の根拠を追跡できます。
- 翻訳下書きは自動公開されません。AIエージェントは `content.translate` の入力に翻訳済みの `title`、`summary`、`body`、`seo` を渡すか、作成後に `content.update` で補完します。
- 翻訳版も個別に事実確認、SEO監査、レビュー、承認を通過してから `publication.publish` を実行します。
- 同じ原文・同じ翻訳先の有効な下書きは二重作成できません。既存版を更新して再利用します。

採用・PR・IR・会社情報では、本文とは別に `structuredData` を保存します。求人の職種・雇用形態・勤務地、PRの発行者・発表日、IRの資料種別・公開日・参照資料URLなどを型付きで保持し、静的HTMLのJSON-LDと表示領域へ再利用します。Blogは `tags`、`series`、`authors`、`featured`、`readingTimeMinutes`、`publishedAt`、`expiresAt` を持ち、HTML、JSON-LD、RSSへ同じメタデータを投影します。確認に使った一次情報は `sourceEvidence`（タイトル、HTTPS URL、発行元、確認日、注記）として最大20件まで登録できます。公開後の訂正・撤回履歴には訂正前後の本文、ブロック、構造化データ、出典を保存し、監査とAIエージェントの再利用に耐える証跡にします。

現在は`provider`ロールが、自分のカテゴリ・自分の事業者IDに紐づくコンテンツだけを操作できます。一般ユーザー、発注者、リクルーターが事業者の編集領域へ入ることはできません。

開発用ポータルUIには、生成済みコンテンツの手動編集フォームも用意しています。タイトル、要約、Markdown本文、確認済み一次情報、SEOメタ情報、canonical、JSON-LD種別、FAQを`PATCH /api/v1/content/{contentId}`で保存し、保存後は版数を進めて事実確認とSEO監査をやり直します。公開承認済み・公開済み・レビュー中・アーカイブ済みのコンテンツは編集フォームを表示しません。

## MCPツール

- `content.propose`
- `content.list`
- `content.draft`
- `content.update`
- `content.versions`
- `content.version_get`
- `content.version_restore`
- `content.duplicate`
- `content.archive`
- `publication.unpublish`
- `content.restore`
- `content.polish`
- `content.fact_check`
- `workflow.reviews`
- `workflow.request_review`
- `workflow.request_changes`
- `seo.audit`
- `seo.site_audit`
- `workflow.approve`
- `publication.publish`

MCPはREST APIと同じ`ContentService`を呼び出します。MCP専用の本文生成ロジックや、APIを迂回する権限判定は持たせません。

## コンテンツ版管理

本文、要約、SEO、確認済み一次情報を変更するたびに、現在のコンテンツとは別に版スナップショットを保存します。状態変更も版履歴に記録しますが、SEO監査とファクトチェックの証跡更新は版数を進めません。

版の復元は既存版を上書きせず、現在のコンテンツに復元内容を適用した新しい下書き版を作成します。復元時には`lastSeoAudit`と`lastFactCheck`を破棄するため、承認・公開前に事実確認とSEO監査を再実行します。公開済みコンテンツは直接復元できず、複製してから編集します。

## レビュー依頼と差し戻し

`review-request`は、最新版のファクトチェックとSEO監査を通過した`seo_reviewed`コンテンツを`review_requested`へ進め、依頼時点のコンテンツ版数と依頼者、任意の依頼メモを保存します。レビュー中のコンテンツは編集・清書・版復元を禁止します。

レビュー担当者は`request-changes`で3文字以上の理由を記録し、コンテンツを`changes_requested`へ戻します。事業者は理由を確認して再編集し、再度ファクトチェック、SEO監査、レビュー依頼を実行します。承認するとレビュー記録は`approved`になり、コンテンツは`approved`へ進みます。旧レビュー記録は履歴として残します。

## 公開承認ゲート

コンテンツには、最後に実行した`lastFactCheck`と`lastSeoAudit`を保存します。両方に対象コンテンツの`contentVersion`を記録し、本文・SEO項目・一次情報が更新されると版数が進むため、古い結果は承認に利用できません。

承認には次の条件をすべて満たす必要があります。

- ステータスが`seo_reviewed`である
- 最新版のファクトチェックが存在し、`passed: true`である
- 最新版のSEO監査が存在する
- 最新版のSEO監査に`severity: error`がない

SEOの警告は人間が確認したうえで承認できますが、重大なエラーは修正して再監査するまで承認できません。ファクトチェックの現在の範囲は、登録済み一次情報の存在確認です。外部情報源との照合は本番アダプターで拡張します。

## 公開ロールと内部編集ロール

`user`、`orderer`、`provider`、`recruiter`はポータル上の公開利用者ロールです。CMS編集・承認・公開の内部ロールは別の`internalRoleAssignments`として管理します。

| 内部ロール | 主な責務 |
|---|---|
| `editor` | 企画、本文、ブロック、SEOメタデータの編集 |
| `hr` / `pr` / `ir` | 担当領域の内容確認 |
| `legal_reviewer` | 法務・規制・根拠の確認 |
| `approver` | 最新版の承認。IRは作成者と別アカウントを必須化 |
| `publisher` | 承認済みスナップショットの公開 |
| `partner_editor` / `partner_viewer` | 委託先の限定範囲での編集・閲覧 |

内部ロール割当が設定されたアカウントでは、`workflow.approve`に`approver`、`publication.publish`に`publisher`が必要です。内部ロール割当がない既存のデモ・移行アカウントは従来の事業者権限で動作します。カテゴリ、事業者ID、組織IDの範囲を割当単位に持たせ、他テナントのコンテンツを操作できないようにします。

## SEO監査の初期ルール

- SEOタイトルは10〜60文字を目安にする
- メタディスクリプションは50〜160文字を目安にする
- 主キーワードをタイトルまたは本文に含め、SEOタイトルにも含める
- H1を1つだけ持つ。複数H1は重大エラーとして扱う
- 可読テキストが少ない薄い本文を警告し、結論・根拠・具体例・次の行動の追加を促す
- canonicalパスをサイト内パスとして持つ
- 企業の確認済み一次情報・出典を登録する
- コンテンツ種別に応じたJSON-LDタイプを持つ
- `FAQPage`を指定する場合はFAQ項目を1件以上持つ
- FAQがある場合はFAQPage、全ページにパンくず・canonical・Article/ItemList構造化データを持つ
- カテゴリーハブ、事業者一覧、事業者プロフィール、関連記事の内部リンクを生成する
- `robots.txt`で検索・AIクローラーの公開ページアクセスを許可し、API/MCPはクロール対象外にする
- `llms.txt`にカテゴリ、事業者、公開ページ、最終更新日を機械可読形式で出力する

監査スコアは編集者の判断を置き換えるものではありません。法務、IR、求人条件、料金、資格、日付などの重要情報は、一次情報の確認と人間の承認を経て公開します。

## AIプロバイダー差し替え契約

AI編集のモデル依存部分は`src/integrations/content-agent-adapter.ts`の`ContentAgentAdapter`に分離しています。アダプターは次の編集処理とポータル計画処理を実装できます。

| メソッド | 入力 | 出力 | CMS-OSが引き続き担う処理 |
|---|---|---|---|
| `propose` | カテゴリ、対象ポジション、テーマ、検索意図、一次情報 | 検索意図、関連語、見出し構成、企画理由 | 所有権、入力制限、企画案保存 |
| `draft` | 保存済み企画案、対象ポジション、JSON-LD種別 | タイトル、要約、本文、`structuredData`、SEO候補 | slug、canonical、SEO監査、版保存 |
| `polish` | 保存済みコンテンツ、清書指示 | 清書本文、任意のタイトル・要約・`structuredData`・SEO候補 | 状態遷移、版保存、権限、監査 |
| `translate` | 原文、翻訳先言語、翻訳指示 | 翻訳タイトル、要約、本文、`structuredData`、SEO候補 | 原文との関連付け、canonical、重複防止、公開ゲート |
| `planPortal`（任意） | カテゴリ、対象ポジション、テーマ、地域、既存データ、基準案 | 検索意図、ページ案、ギャップ、次のアクション | カテゴリ権限、件数・パス検証、計画保存、企画反映 |

標準の`DeterministicContentAgentAdapter`は、無料のCloudflare静的公開環境、ローカル開発、テストで利用できます。外部プロバイダーを接続するときは、`ContentService`のコンストラクターへ実装を注入します。モデルの出力はサービス側で長さ・空文字・SEO項目を正規化し、API/MCPから直接モデルを呼び出す経路は作りません。

起動プロセスからHTTPアダプターを選ぶ場合は、次の環境変数を設定します。`CMS_OS_CONTENT_AGENT_ENDPOINT`が未設定なら決定的アダプターが選択されます。

| 環境変数 | 必須 | 用途 |
|---|---|---|
| `CMS_OS_CONTENT_AGENT_ENDPOINT` | 外部AIを使う場合 | `POST`先のHTTP(S)エンドポイント |
| `CMS_OS_CONTENT_AGENT_API_KEY` | 接続先の仕様による | Bearer認証トークン |
| `CMS_OS_CONTENT_AGENT_MODEL` | 任意 | 接続先へ渡すモデル識別子 |
| `CMS_OS_CONTENT_AGENT_TIMEOUT_MS` | 任意 | タイムアウト。既定30,000ms |
| `CMS_OS_CONTENT_AGENT_MAX_REQUEST_BYTES` | 任意 | AIへ送るJSON入力の上限。既定1,048,576バイト |
| `CMS_OS_CONTENT_AGENT_MAX_RESPONSE_BYTES` | 任意 | AIから受け取るJSON応答の上限。既定4,194,304バイト |

HTTPリクエストは次の形式です。AIプロバイダーは`output`へ、対象操作に対応したJSONを返します。`operation`は`propose`、`draft`、`polish`、`translate`、`portal_plan`のいずれかです。APIキーは本文やログへ含めません。

```json
{
  "protocol": "cms-os-content-agent/v1",
  "operation": "draft",
  "model": "任意のモデル識別子",
  "input": {}
}
```

```json
{
  "output": {
    "title": "生成タイトル",
    "summary": "生成要約",
    "body": "生成本文",
    "structuredData": {
      "type": "pressRelease",
      "releaseDate": "2026-07-16",
      "issuer": "株式会社サンプル"
    }
  }
}
```

外部モデルが長時間処理になる場合は、`operation.submit`の非同期ジョブから同じアダプターを呼び出し、途中結果・失敗・再開用IDを`operation_jobs`へ保存します。承認・公開はAIアダプターに委譲せず、人間の確認とBuilderOS Adapter経由の公開処理を通します。

## 本番運用の拡張ポイント

HTTPアダプターで外部AIを接続した後も、次の運用機能を段階的に追加できます。

1. モデルプロバイダーの選択
2. 企業情報・ブランドルール・出典の取得
3. 構成・本文・清書案の生成
4. 生成内容と参照情報の保存
5. 事実確認・SEO監査
6. 人間の承認
7. 静的HTML、sitemap、robots、JSON-LDのビルド
8. BuilderOS Adapter経由のCloudflare Pages公開

静的ビルドでは、承認済みコンテンツだけでなく、カテゴリーハブ（`/categories/{category}/`）、事業者一覧（`/categories/{category}/providers/`）、公開事業者プロフィールも生成します。事業者情報はポータルの公開フィールドだけを使用し、発注者・事業者・応募者向けの非公開フィールドを静的ページへ出力しません。

生成結果を即時公開せず、`drafted`または`polished`状態で止めているのは、監査可能性とSEO品質を守るためです。編集、複製、アーカイブ、復元は事業者自身のコンテンツに限定し、公開済みコンテンツは直接編集できません。`publication.publish`はCloudflare Pagesへの送信が成功した場合だけ`published`へ遷移し、ドライランでは状態を変更しません。監査・ファクトチェックの結果はコンテンツと同じ永続化領域に保存され、APIとMCPのどちらからでも確認できます。

## メディア参照

コンテンツ企画、下書き、直接作成、更新では、事業者が管理するメディアアセットのIDを`mediaIds`（最大20件）で関連付けられます。カテゴリと事業者IDが一致しないアセットは参照できず、企画から下書きを作成する場合も所有者検証を再実行します。コンテンツ本体にはバイナリを保存せず、メディアアセットIDだけを版履歴へ記録します。

静的公開時は、参照アセットが`published`であること、`publicUrl`が存在すること、利用権限が有効であることを確認します。条件を満たさない場合は公開を中止します。条件を満たした画像・動画・PDFは本文下の関連メディア領域へ出力し、画像URLは記事JSON-LDの`image`にも反映します。

## note型ブロックコンテンツ

`content.create`と`content.update`は、従来のMarkdown本文に加えて`blocks`を受け付けます。`blocks`を指定した場合はCMS-OSがブロックを検証し、公開・SEO監査・版履歴で利用するMarkdown本文をサーバー側で生成します。自由HTMLは受け付けません。

対応ブロックは、見出し、段落、画像、ギャラリー、動画、引用、表、ファイル、埋め込み、CTA、求人カード、プレスリリースカード、IR資料カード、関連コンテンツ、事業者カードです。URLはサイト内パスまたはHTTPSに限定し、ブロックは最大100件、表・ギャラリー・関連コンテンツにも件数上限を設けています。

`structuredData`は本文と別に保存する種別別の正規データです。`company`は会社名・代表者・所在地・サービス、`job`は職種・雇用形態・勤務地・業務内容・必須条件・福利厚生・選考フロー、`pressRelease`は発表日・発行者・メディア窓口、`ir`は公表日・資料種別・対象期間・原資料URLを保持します。contentTypeとtypeの組み合わせはサーバーで検証し、日付はISO 8601、外部URLはHTTPSに限定します。

```json
{
  "type": "ir",
  "publicationDate": "2026-07-16",
  "documentType": "presentation",
  "fiscalPeriod": "2026年3月期",
  "sourceDocumentUrl": "https://example.com/ir/presentation.pdf"
}
```

```json
{
  "category": "legal",
  "contentType": "blog",
  "audience": "beginner",
  "title": "企業法務の相談前に確認したいこと",
  "summary": "初回相談で準備すべき情報を整理します。",
  "blocks": [
    { "type": "heading", "level": 1, "text": "相談前の準備" },
    { "type": "paragraph", "text": "相談の目的と期限を先に整理すると、必要な確認事項が明確になります。" },
    { "type": "cta", "label": "相談窓口を見る", "url": "/categories/legal/providers/" }
  ]
}
```

ブロックを更新すると、生成済み本文・ブロックJSON・SEO監査証跡が同じコンテンツ版に紐付きます。本文を直接更新した場合は既存のブロックJSONを解除し、本文と構造化データの不一致を残しません。AIエージェントはAPI/MCP経由でブロックJSONを生成候補として登録できますが、事実確認・SEO監査・人間承認を通過するまで公開できません。

公開済みのPR・IRを訂正する場合は`POST /api/v1/content/{contentId}/correction`またはMCPの`content.correction`を使い、訂正前本文・訂正後本文（またはブロック）・理由を別履歴として保存します。元の公開本文は上書きしません。撤回は`POST /api/v1/content/{contentId}/withdrawal`または`content.withdrawal`で理由を保存して公開状態を停止し、履歴と元本文を残します。履歴はRESTの`editorial-actions`とMCPの`content.editorial_actions`から取得できます。
