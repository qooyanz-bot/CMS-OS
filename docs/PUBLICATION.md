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
POST /api/v1/publications/build
```

`publication.build`の入力例です。

```json
{
  "contentIds": ["content-..."],
  "baseUrl": "https://www.example.com"
}
```

`contentIds`を省略すると、ログイン中の事業者が管理する承認済みコンテンツをまとめてビルドします。`baseUrl`はcanonical、sitemap、robots.txt、llms.txtの絶対URLに使用します。

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

開発版はファイル配列をAPI/MCPの結果として返します。本番では次の処理をAdapterで追加します。

1. ファイルパスの安全性を検証する
2. 差分と公開対象を記録する
3. Cloudflare Pagesへデプロイする
4. デプロイID、公開URL、失敗理由をCMS-OSへ返す
5. ロールバック可能な公開履歴を保存する
