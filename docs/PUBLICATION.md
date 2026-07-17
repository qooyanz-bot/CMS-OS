# CMS-OS静的公開仕様

## 公開条件

CMS-OSはAI生成物をそのまま公開しません。事業者が企画、下書き、清書、SEO確認を行った後、`workflow.approve`で承認したコンテンツだけを静的公開ビルドの対象にします。

```text
drafted
  ↓ 清書・SEO監査
seo_reviewed
        ↓ 人間の確認
approved
        ↓ publication.build
Cloudflare Pagesへ配置可能な静的ファイル
```

## REST API

```text
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
```

`publication.build`の入力例です。

```json
{
  "contentIds": ["content-..."],
  "baseUrl": "https://www.example.com"
}
```

`contentIds`を省略すると、ログイン中の事業者が管理する承認済みコンテンツをまとめてビルドします。公開対象は`visibility=public`かつ`expiresAt`が未到来のコンテンツに限定します。`baseUrl`はcanonical、sitemap、robots.txt、rss.xml、llms.txtの絶対URLに使用します。`publication.deploy`と`publication.publish`、予約公開の実行では、サイト全体のSEO監査も実行し、canonical重複、監査証跡の欠落、事実確認未完了、構造化データ不備などの重大エラーが残っている場合はCloudflare Pagesへ送信しません。`publication.build`はプレビュー生成として利用できます。

## 公開取消

`POST /api/v1/publications/unpublish`またはMCPの`publication.unpublish`は、指定した公開済みコンテンツを除外した静的スナップショットを作成し、BuilderOS Adapter経由で再デプロイします。実デプロイが成功した場合だけ、対象コンテンツを`archived`へ移行し、対象コンテンツを含む未実行の予約公開を自動的に取消します。dry-runまたはデプロイ失敗時は、CMS上の公開状態を変更しません。

## 予約公開

`POST /api/v1/publications/schedules`またはMCPの`publication.schedule`は、承認済みコンテンツを静的スナップショットとして固定し、`scheduledFor`（ISO 8601形式）が到来した後に公開できる予約を作成します。予約後にコンテンツを編集しても、予約スナップショットへは反映されません。

- `GET /api/v1/publications/schedules` / `publication.schedule_list`：事業者自身の予約一覧
- `POST /api/v1/publications/schedules/{scheduleId}/cancel` / `publication.schedule_cancel`：未実行予約の取消
- `POST /api/v1/publications/schedules/execute` / `publication.schedule_execute`：事業者トークンで自社分を実行。`x-cms-os-operator-key`を付けた運営Cronでは全カテゴリの期限到来分を実行

実行入口はCMS-OS内部のタイマーに依存せず、Cloudflare Cronや外部ジョブからAPI/MCPで呼び出します。運営ジョブは`CMS_OS_OPERATOR_KEY`と`x-cms-os-operator-key`を使用し、事業者ごとのアクセストークンを外部ジョブへ配布せずに全カテゴリを処理できます。Cloudflare Pagesへの実デプロイが成功した場合だけ、予約を`executed`、対象コンテンツを`published`へ更新します。ドライランでは予約を保持し、再実行できます。

## 公開履歴とロールバック

ビルド、デプロイ、公開のたびに、生成時点の静的ファイルをスナップショットとして公開履歴へ保存します。`GET /api/v1/publications`またはMCPの`publication.history`では、事業者自身の履歴だけを取得できます。履歴一覧にはファイル本体を含めず、ファイル数、対象コンテンツ、状態、デプロイ情報を返します。

`POST /api/v1/publications/{publicationId}/rollback`またはMCPの`publication.rollback`は、`deployed`または`published`状態の履歴をBuilderOS Adapter経由で再デプロイします。これは現在のコンテンツを編集する操作ではなく、過去の静的スナップショットを再公開する操作です。ドライランでは外部公開せず、履歴状態も`built`のまま保持します。

## 出力ファイル

ビルド結果は、Cloudflare Pagesの静的アセットとして配置できるファイル配列で返します。

| パス | 役割 |
|---|---|
| `index.html` | 公開コンテンツ一覧 |
| `content/{slug}/index.html` | 各コンテンツの静的HTML |
| `categories/{category}/themes/{theme}/index.html` | テーマ別の事業者案内 |
| `categories/{category}/regions/{region}/index.html` | 地域別の事業者案内 |
| `categories/{category}/providers/index.html` | カテゴリ別事業者一覧 |
| `categories/{category}/providers/{providerId}/index.html` | 事業者プロフィール、公開求人、関連する公開情報と`Organization`構造化データ |
| `categories/{category}/jobs/index.html` | カテゴリ別の公開求人一覧 |
| `categories/{category}/jobs/{jobId}/index.html` | 公開求人の詳細と`JobPosting`構造化データ |
| `assets/cms-os.css` | 最小表示スタイル |
| `sitemap.xml` | 公開ページの検索エンジン向け一覧 |
| `rss.xml` | 公開コンテンツの更新フィード。タグを`category`として出力 |
| `robots.txt` | クローラーの公開方針とsitemap URL |
| `llms.txt` | AI検索・エージェント向けの機械可読インデックス |
| `_headers` | Cloudflare Pagesの静的セキュリティヘッダー |

各ページには次のSEO要素を埋め込みます。

- `structuredData`に登録された会社、求人、PR、IRの型付き情報をJSON-LDと本文補助領域へ出力
- `sourceFacts`と`sourceEvidence`を「確認済みの一次情報」として公開ページへ出力
- `author`、著者プロフィール、シリーズ、タグ、読了目安、発行者、公開日、更新日、求人の`JobPosting`項目をコンテンツ種別に応じて出力
- 訂正・撤回の履歴はCMS-OS内部に保存し、公開ページの本文へ未承認の履歴を混入させない

- `title`
- Markdownのリンク記法は、安全なサイト内パス・HTTPS URL・ページ内アンカーだけを実リンクへ変換し、その他のURLは文字列としてエスケープします。
- `meta description`
- `canonical`
- `robots`
- OGPタイトル・説明・URL
- `application/ld+json`
- 事業者プロフィールには`Organization`、`@id`、canonical、sitemapリンクを出力し、当該事業者に紐づく公開求人・公開情報へ内部リンクします。関連求人がある場合は、その最新更新日時を事業者URLのsitemap `lastmod`へ反映します。
- 公開日・更新日
- `structuredData`があるコンテンツでは、会社情報・求人・PR・IRの正規項目をHTMLの公開情報欄とJSON-LDへ反映します。求人は勤務地・雇用形態・募集期間、PR/IRは発表日・公表日・発行者・原資料URLを再利用します。
- `sourceFacts`が登録されているコンテンツでは、承認済みページに確認済みの一次情報として表示し、AI検索が本文の根拠を追跡できるようにします。
- 記事ページの`author`とJSON-LDの作成者は掲載事業者名を優先し、PRは発行者をpublisherへ反映します。
- 公開求人には`JobPosting`、求人一覧には`CollectionPage`・`ItemList`を出力し、掲載事業者名、掲載日、更新日、勤務地、雇用形態、応募導線を明示します。求人は公開情報として静的生成しますが、応募操作はリクルーター認証後に限定します。
- 言語属性はコンテンツの `locale` に合わせて出力します。翻訳版は `lang`、`og:locale`、JSON-LD の `inLanguage` を個別に持ちます。
- 同じ原文に紐づく翻訳版が同時に公開対象に含まれる場合、各ページに言語別の `hreflang` と `x-default` を出力します。

本文は現在Markdownの安全なサブセットをHTMLへ変換します。HTMLエスケープを行うため、本文中のスクリプトやタグは実行されません。

## Cloudflare Pagesとの接続

BuilderOS Adapterは、ビルド結果の`files`をCloudflare Pagesのデプロイ入力へ変換します。CMS-OS本体は公開ファイルの生成と検証を担当し、Cloudflare固有の認証情報やデプロイ処理はAdapter側に分離します。

ローカルの出力先へ変換する場合は、次のように実行します。

```ts
const adapter = new BuilderOSAdapter();
const manifest = await adapter.exportToDirectory(buildResult, "./cloudflare-pages-dist");
```

## Cloudflare Pages Freeプランとの対応

CMS-OSの静的公開は、Pages Functionsや常時稼働サーバーを使わないCloudflare Pages Direct Uploadを基本とします。静的アセットの配信はCloudflare Pagesの無料枠で利用でき、BuilderOS Adapterは無料枠の公開上限を超えないように次の値で事前検証します。

- 1サイトあたり最大20,000ファイル
- 1ファイルあたり最大25MiB
- 静的アセットのリクエストは無料・無制限

20,000ファイル超過または25MiB超過の公開は、Cloudflareへ送信する前に`BuilderOSAdapterError`で拒否します。上限や料金は変更される可能性があるため、公開前に[Cloudflare Pagesの制限](https://developers.cloudflare.com/pages/platform/limits/)を確認してください。Direct Uploadの方式は[Cloudflare Pages Direct Upload公式ガイド](https://developers.cloudflare.com/pages/get-started/direct-upload/)に準拠します。

## Cloudflare Pages Direct Upload

`deployToCloudflarePages`は、BuilderOS AdapterからCloudflare PagesのDirect Uploadを呼び出します。実行時はCloudflare API Tokenを引数で受け取り、ログや戻り値にはトークンを含めません。ドライランでは外部通信を行わず、公開対象ファイル数だけを確認できます。

```ts
const result = await adapter.deployToCloudflarePages(buildResult, {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  projectName: process.env.CLOUDFLARE_PAGES_PROJECT!,
  apiToken: process.env.CLOUDFLARE_API_TOKEN!,
  branch: "main",
});
```

処理は次の順序で行います。

1. PagesプロジェクトのアップロードJWTを取得する
2. 未登録ハッシュを確認する
3. 未登録の静的アセットだけをBase64形式でアップロードする
4. ハッシュを登録する
5. `manifest`と`_headers`を添えてデプロイを作成する

本番運用では、`CLOUDFLARE_API_TOKEN`にPages Write権限を持つAPI Tokenを設定し、Cloudflare PagesのDirect Uploadプロジェクトを使用してください。Cloudflareの公式API仕様は[Create deployment](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/)および[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)を参照します。

Adapterは絶対パス、`..`、重複パスを拒否し、出力先をCloudflare Pagesの静的アセットディレクトリとして扱います。

BuilderOS Adapterは次の処理を担当します。公開履歴とロールバック対象のスナップショットはCMS-OS本体で管理します。

1. ファイルパスの安全性を検証する
2. 差分と公開対象を記録する
3. Cloudflare Pagesへデプロイする
4. デプロイID、公開URL、失敗理由をCMS-OSへ返す

## コンテンツに関連付けたメディア

コンテンツが`mediaIds`を持つ場合、ビルド前に同一カテゴリ・同一事業者のアセットであることを確認します。さらに、アセットが公開済みで`publicUrl`を持ち、権利期限を超えていないことを確認します。いずれかを満たさない場合はHTML生成とCloudflare Pages送信を行いません。

公開HTMLには画像・動画・PDFの関連メディア領域を生成します。画像は`alt`、寸法、遅延読み込みを付与し、記事JSON-LDの`image`にもURLを登録します。コンテンツの版履歴にはメディアIDを保存するため、どの公開版がどのアセットを参照したかを追跡できます。
