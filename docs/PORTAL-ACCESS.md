# CMS-OS Portal アクセス制御実装

## 実装済みの垂直スライス

初期実装では、次の動作をTypeScriptで提供します。

- デモアカウントのログイン・ログアウト
- アカウントごとのカテゴリ別ロール割当
- 士業・弁護士カテゴリの表示ポリシー
- 美容カテゴリの表示ポリシー
- 未ログインユーザーの公開表示
- 発注者・事業者・リクルーターの表示モジュール切り替え
- サーバー側の表示フィールド投影
- REST API
- MCPの`tools/list`と`tools/call`
- 発注者による依頼作成
- 担当事業者による依頼閲覧
- カテゴリ別求人検索
- リクルーターによる求人応募

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

## API例

```text
POST /api/v1/auth/login
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
POST /api/v1/requests
GET  /api/v1/requests
GET  /api/v1/jobs?category=legal
POST /api/v1/jobs/{jobId}/applications
GET  /api/v1/applications
POST /mcp
```

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
