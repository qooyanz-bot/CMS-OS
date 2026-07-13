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

## API例

```text
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/context
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
- インメモリ認証は開発用です。永続化前に、本番OIDC、セッション失効、MFA、レート制限、監査ログを実装します。
