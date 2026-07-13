# CMS-OSコンテンツワークフロー

## 目的

CMS-OSのAI編集機能は、単に本文を生成するのではなく、対象ポジション、検索意図、企業の確認済み情報、SEO要件を一つの編集単位として扱います。

現在の開発版では、外部AIプロバイダーに依存しない決定的アダプターを使用しています。本番ではこのアダプターを複数のAIモデルへ差し替えますが、企画、下書き、清書、SEO監査のAPI/MCP契約と権限境界は維持します。

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

## 多言語翻訳ワークフロー

`content.translate` は原文を上書きせず、原文の `contentId` と `version` を記録した言語別の翻訳下書きを作成します。対応言語は `ja`、`en`、`zh-CN`、`es`、`ko`、`de`、`fr` です。

- `locale` はコンテンツ単位で保持し、翻訳版は独立したURL・canonical・OG情報・JSON-LD言語属性を持ちます。
- `translationOf.sourceVersion` に原文の基準版を記録するため、原文更新後も翻訳の根拠を追跡できます。
- 翻訳下書きは自動公開されません。AIエージェントは `content.translate` の入力に翻訳済みの `title`、`summary`、`body`、`seo` を渡すか、作成後に `content.update` で補完します。
- 翻訳版も個別に事実確認、SEO監査、レビュー、承認を通過してから `publication.publish` を実行します。
- 同じ原文・同じ翻訳先の有効な下書きは二重作成できません。既存版を更新して再利用します。
```

現在は`provider`ロールが、自分のカテゴリ・自分の事業者IDに紐づくコンテンツだけを操作できます。一般ユーザー、発注者、リクルーターが事業者の編集領域へ入ることはできません。

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

## SEO監査の初期ルール

- SEOタイトルは10〜60文字を目安にする
- メタディスクリプションは50〜160文字を目安にする
- 主キーワードをタイトルまたは本文に含める
- H1を1つ以上持つ
- canonicalパスをサイト内パスとして持つ
- 企業の確認済み一次情報・出典を登録する
- コンテンツ種別に応じたJSON-LDタイプを持つ
- FAQがある場合はFAQPage、全ページにパンくず・canonical・Article/ItemList構造化データを持つ
- カテゴリーハブ、事業者一覧、事業者プロフィール、関連記事の内部リンクを生成する
- `robots.txt`で検索・AIクローラーの公開ページアクセスを許可し、API/MCPはクロール対象外にする
- `llms.txt`にカテゴリ、事業者、公開ページ、最終更新日を機械可読形式で出力する

監査スコアは編集者の判断を置き換えるものではありません。法務、IR、求人条件、料金、資格、日付などの重要情報は、一次情報の確認と人間の承認を経て公開します。

## 本番アダプターへの拡張

決定的アダプターを次のインターフェースへ置き換えます。

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
