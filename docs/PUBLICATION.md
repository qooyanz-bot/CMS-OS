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

`contentIds`を省略すると、ログイン中の事業者が管理する承認済みコンテンツをまとめてビルドします。`baseUrl`はcanonical、sitemap、robots.txt、llms.txtの絶対URLに使用します。

## 公開取消

`POST /api/v1/publications/unpublish`またはMCPの`publication.unpublish`は、指定した公開済みコンテンツを除外した静的スナップショットを作成し、BuilderOS Adapter経由で再デプロイします。実デプロイが成功した場合だけ、対象コンテンツを`archived`へ移行し、対象コンテンツを含む未実行の予約公開を自動的に取消します。dry-runまたはデプロイ失敗時は、CMS上の公開状態を変更しません。

## 予約公開

`POST /api/v1/publications/schedules`またはMCPの`publication.schedule`は、承認済みコンテンツを静的スナップショットとして固定し、`scheduledFor`（ISO 8601形式）が到来した後に公開できる予約を作成します。予約後にコンテンツを編集しても、予約スナップショットへは反映されません。

- `GET /api/v1/publications/schedules` / `publication.schedule_list`：事業者自身の予約一覧
- `POST /api/v1/publications/schedules/{scheduleId}/cancel` / `publication.schedule_cancel`：未実行予約の取消
- `POST /api/v1/publications/schedules/execute` / `publication.schedule_execute`：外部Cronから期限到来分を実行

実行入口はCMS-OS内部のタイマーに依存せず、Cloudflare Cronや外部ジョブからAPI/MCPで呼び出します。Cloudflare Pagesへの実デプロイが成功した場合だけ、予約を`executed`、対象コンテンツを`published`へ更新します。ドライランでは予約を保持し、再実行できます。

## 公開履歴とロールバック

ビルド、デプロイ、公開のたびに、生成時点の静的ファイルをスナップショットとして公開履歴へ保存します。`GET /api/v1/publications`またはMCPの`publication.history`では、事業者自身の履歴だけを取得できます。履歴一覧にはファイル本体を含めず、ファイル数、対象コンテンツ、状態、デプロイ情報を返します。

`POST /api/v1/publications/{publicationId}/rollback`またはMCPの`publication.rollback`は、`deployed`または`published`状態の履歴をBuilderOS Adapter経由で再デプロイします。これは現在のコンテンツを編集する操作ではなく、過去の静的スナップショットを再公開する操作です。ドライランでは外部公開せず、履歴状態も`built`のまま保持します。

## 出力ファイル

ビルド結果は、Cloudflare Pagesの静的アセットとして配置できるファイル配列で返します。

| パス | 役割 |
|---|---|
| `index.html` | 公開コンテンツ一覧 |
| `content/{slug}/index.html` | 各コンテンツの静的HTML |
| `assets/cms-os.css` | 最小表示スタイル |
| `sitemap.xml` | 公開ページの検索エンジン向け一覧 |
| `robots.txt` | クローラーの公開方針とsitemap URL |
| `llms.txt` | AI検索・エージェント向けの機械可読インデックス |
| `_headers` | Cloudflare Pagesの静的セキュリティヘッダー |

各ページには次のSEO要素を埋め込みます。

- `title`
- `meta description`
- `canonical`
- `robots`
- OGPタイトル・説明・URL
- `application/ld+json`
- 公開日・更新日
- 言語属性`lang="ja"`

本文は現在Markdownの安全なサブセットをHTMLへ変換します。HTMLエスケープを行うため、本文中のスクリプトやタグは実行されません。

## Cloudflare Pagesとの接続

BuilderOS Adapterは、ビルド結果の`files`をCloudflare Pagesのデプロイ入力へ変換します。CMS-OS本体は公開ファイルの生成と検証を担当し、Cloudflare固有の認証情報やデプロイ処理はAdapter側に分離します。

ローカルの出力先へ変換する場合は、次のように実行します。

```ts
const adapter = new BuilderOSAdapter();
const manifest = await adapter.exportToDirectory(buildResult, "./cloudflare-pages-dist");
```

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
