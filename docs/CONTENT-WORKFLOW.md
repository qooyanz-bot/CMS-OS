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
  ↓ タイトル、説明文、H1、キーワード、canonical、出典
人間の確認
  ↓
承認・静的公開
```

## REST API

```text
POST /api/v1/content/proposals
GET  /api/v1/content/proposals
POST /api/v1/content/drafts
GET  /api/v1/content
GET  /api/v1/content/{contentId}
POST /api/v1/content/{contentId}/polish
POST /api/v1/content/{contentId}/seo-audit
POST /api/v1/content/{contentId}/fact-check
```

現在は`provider`ロールが、自分のカテゴリ・自分の事業者IDに紐づくコンテンツだけを操作できます。一般ユーザー、発注者、リクルーターが事業者の編集領域へ入ることはできません。

## MCPツール

- `content.propose`
- `content.list`
- `content.draft`
- `content.polish`
- `content.fact_check`
- `seo.audit`

MCPはREST APIと同じ`ContentService`を呼び出します。MCP専用の本文生成ロジックや、APIを迂回する権限判定は持たせません。

## SEO監査の初期ルール

- SEOタイトルは10〜60文字を目安にする
- メタディスクリプションは50〜160文字を目安にする
- 主キーワードをタイトルまたは本文に含める
- H1を1つ以上持つ
- canonicalパスをサイト内パスとして持つ
- 企業の確認済み一次情報・出典を登録する
- コンテンツ種別に応じたJSON-LDタイプを持つ

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

生成結果を即時公開せず、`drafted`または`polished`状態で止めているのは、監査可能性とSEO品質を守るためです。
