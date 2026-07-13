# CMS-OS Portal アクセス制御実装

## 実装済みの垂直スライス

初期実装では、次の動作をTypeScriptで提供します。

- デモアカウントのログイン・ログアウト
- アカウントごとのカテゴリ別ロール割当
- 士業・弁護士カテゴリの表示ポリシー
- 美容カテゴリの表示ポリシー
- 生成AI・業務改革、人手不足・省人化、地域観光・インバウンド、モビリティDX・SDV、GX・省エネ・資源循環、地方創生・移住・空き家再生のテーマカテゴリ
- 未ログインユーザーの公開表示
- 発注者・事業者・リクルーターの表示モジュール切り替え
- サーバー側の表示フィールド投影
- REST API
- MCPの`tools/list`と`tools/call`
- 発注者による依頼作成
- 担当事業者による依頼閲覧
- カテゴリ別求人検索
- リクルーターによる求人応募

カテゴリの一覧、追加方法、カテゴリ別の標準ロール表示は[`CATEGORY-REGISTRY.md`](./CATEGORY-REGISTRY.md)にまとめています。

## デモアカウント

すべてのデモアカウントのパスワードは、ローカル検証用の`demo-password`です。本番環境では使用せず、OIDC、パスキー、MFA、永続セッションストアへ置き換えます。

| メール | 主なロール |
|---|---|
| `user@example.com` | ユーザー |
| `orderer@example.com` | 発注者 |
| `lawyer@example.com` | 士業カテゴリの事業者 |
| `beauty@example.com` | 美容カテゴリの事業者 |
| `candidate@example.com` | リクルーター |

## 本番認証設定

本番環境では、`NODE_ENV=production` の場合にOIDCが既定のログイン方式になります。デモアカウントとパスワードログインは既定で無効です。次の環境変数を設定してください。

```text
CMS_OS_AUTH_MODE=oidc
CMS_OS_OIDC_ISSUER=https://認証基盤.example.com
CMS_OS_OIDC_CLIENT_ID=...
CMS_OS_OIDC_CLIENT_SECRET=...
CMS_OS_OIDC_REDIRECT_URI=https://cms.example.com/api/v1/auth/oidc/callback
CMS_OS_OIDC_SCOPES=openid profile email
CMS_OS_OIDC_AUTO_PROVISION=false
CMS_OS_OIDC_REQUIRE_MFA=true
CMS_OS_AUTH_ENCRYPTION_KEY=32文字以上の秘密値
```

OIDCはAuthorization Code + PKCEを使用し、`state` はハッシュ化して短時間・一回限りで検証します。OIDCプロバイダーからメールアドレスが未検証と通知された場合はログインを許可しません。CMS-OS側のMFAを使う場合は、暗号化キーでTOTP秘密鍵をAES-256-GCMにより暗号化して保存します。

ブラウザUIは`GET /api/v1/auth/config`で利用可能なログイン方式を取得し、パスワード入力、OIDC遷移、MFAチャレンジを切り替えます。アクセストークンはブラウザの永続ストレージへ保存しません。ログイン、OIDC、MFAの公開入口にはIP・識別子単位のレート制限を適用し、認証成否は`auth-audit-log.json`またはPostgreSQL状態ストアへ秘密情報なしで記録します。

## API例

```text
POST /api/v1/auth/login
GET  /api/v1/auth/config
GET  /api/v1/auth/me
POST /api/v1/auth/context
POST /api/v1/auth/oidc/start
GET  /api/v1/auth/oidc/callback
POST /api/v1/auth/mfa/enroll
POST /api/v1/auth/mfa/confirm
POST /api/v1/auth/mfa/complete
GET  /api/v1/categories
GET  /api/v1/categories/{category}/experience
GET  /api/v1/providers?category=beauty&theme=カラー
GET  /api/v1/providers/{providerId}
PATCH /api/v1/providers/{providerId}
POST /api/v1/requests
GET  /api/v1/requests
PATCH /api/v1/requests/{requestId}
GET  /api/v1/jobs?category=legal
POST /api/v1/jobs
PATCH /api/v1/jobs/{jobId}
POST /api/v1/jobs/{jobId}/applications
GET  /api/v1/applications
PATCH /api/v1/applications/{applicationId}
POST /mcp
```

## 事業者掲載情報・求人管理

事業者の掲載情報は、カテゴリとロールに応じて次のように投影します。

| ロール | 事業者情報 | 求人情報 |
|---|---|---|
| ユーザー | 公開項目のみ | 公開中のみ・providerIdは非公開 |
| 発注者 | 公開項目＋発注者向け項目 | 公開中のみ・providerIdは非公開 |
| 事業者 | 自社の公開項目＋事業者向け項目 | 自社求人の公開・終了を含む |
| リクルーター | 公開項目＋候補者向け項目 | 公開中のみ・providerIdは非公開 |

`PATCH /api/v1/providers/{providerId}`、`POST /api/v1/jobs`、`PATCH /api/v1/jobs/{jobId}` は、対象カテゴリに所属する事業者本人だけが実行できます。MCPでも `provider.get`、`provider.update`、`job.create`、`job.update` を同じ権限判定で利用できます。

## 依頼・求人応募の権限

| 操作 | ユーザー | 発注者 | 事業者 | リクルーター |
|---|---:|---:|---:|---:|
| 公開事業者検索 | ○ | ○ | ○ | ○ |
| 依頼作成 | × | ○ | × | × |
| 担当依頼の閲覧 | × | ○ | ○ | × |
| 公開求人の閲覧 | ○ | ○ | ○ | ○ |
| 求人への応募 | × | × | × | ○ |
| 担当求人の応募閲覧 | × | × | ○ | × |

## 開発用ポータルUI

事業者ロールでログインすると、APIを正本とした次の管理導線が表示されます。

- 掲載情報フォーム：事業者名、テーマ、所在地、公開項目を `PATCH /api/v1/providers/{providerId}` で更新
- 求人作成フォーム：求人を `POST /api/v1/jobs` で作成
- 求人一覧の状態操作：自社求人を `PATCH /api/v1/jobs/{jobId}` で公開・終了
- 依頼・応募の状態表示：発注者、事業者、リクルーターの対象データだけを一覧表示
- 状態操作：事業者の依頼受付・応募選考、発注者の依頼終了を許可された遷移だけ実行
- 一般ユーザー、発注者、リクルーターには事業者管理フォームを表示しない

APIを操作する最小のブラウザUIを同梱しています。カテゴリを選択すると、そのカテゴリの表示モジュール、事業者、求人が切り替わります。ログイン後にカテゴリを変更した場合は、カテゴリコンテキストの混在を避けるため自動的にログアウトします。

```bash
npm run dev
```

起動後、`http://localhost:8787/` を開いてください。デモアカウントのパスワードはすべて `demo-password` です。

## 設計上の注意

- UIで隠すだけでなく、APIサーバー側でカテゴリ・ロール・リソース所有者を検証します。
- 事業者の内部指標、発注案件、応募書類は公開プロフィールへ混ぜません。
- APIとMCPは同じドメインサービスを利用します。
- 既定のインメモリ認証はテスト・短時間デモ用です。ローカル再起動後も保持する場合は`CMS_OS_STORAGE=file`を使用できます。
- ファイルモードは単一インスタンスの開発用であり、本番ではPostgreSQL、OIDC、セッション失効、MFA、レート制限、監査ログへ置き換えます。
