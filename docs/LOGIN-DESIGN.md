# CMS-OS ログイン設計

CMS-OSのログインは、アカウントそのものと「現在どのカテゴリを、どの立場で利用するか」を分離して扱います。ログイン後の表示・操作・データ投影は、必ず `カテゴリ × ロール` の組み合わせで決定します。

## 1. ロール定義

| ロール | 対象者 | 主な目的 |
|---|---|---|
| `user` | 普通の客、公開情報へアクセスする人 | カテゴリ情報、事業者検索、公開ガイドの閲覧 |
| `orderer` | 事業運営者へ発注する人 | 事業者への相談、依頼、見積、予約、履歴管理 |
| `provider` | 選択したカテゴリの事業運営者 | 掲載情報、問い合わせ、案件、求人、AIコンテンツ、SEO、公開を管理 |
| `recruiter` | カテゴリの事業者へ応募する意思がある人 | 求人検索、求人詳細、応募、応募状況の確認 |

`candidate` は既存クライアント互換の入力値として受け付けますが、ログイン後の正規表示名とコンテキストは `recruiter` に統一します。

未ログインのアクセスは、認証済み `user` と同じ公開表示を使います。ただし、未ログイン状態では発注、問い合わせ、予約、お気に入りなどの本人操作は許可しません。

## 2. カテゴリ別表示対象

カテゴリごとに同じロールでも専用モジュールを返します。画面は固定のロール別メニューを持たず、API/MCPの `visibleModules` と `navigation` を正本にして表示します。

| カテゴリ | ユーザー | 発注者 | 事業者 | リクルーター |
|---|---|---|---|---|
| `legal` | 事業者検索、法務テーマ、注意事項、FAQ | 相談・依頼、見積、セキュアメッセージ、履歴 | 掲載、問い合わせ、案件、AIコンテンツ、SEO | 求人検索、カルチャー、応募、応募状況 |
| `beauty` | メニュー検索、事業者検索、スタイル、FAQ | メニュー選択、予約リクエスト、予約履歴 | メニュー、予約、スタイル、掲載、AIコンテンツ、SEO | 求人検索、応募、応募状況 |
| `ai-business` | AI活用ガイド、事業者検索 | 自動化相談、依頼・見積 | AIソリューション管理、掲載、求人、AIコンテンツ、SEO | AIキャリア、求人、応募 |
| `labor-shortage` | 人材不足ガイド、事業者検索 | 採用相談、依頼・見積 | 採用支援管理、掲載、求人、AIコンテンツ、SEO | キャリア支援、求人、応募 |
| `tourism` | 観光・地域ガイド、事業者検索 | 旅行計画、依頼・見積 | 観光体験管理、掲載、求人、AIコンテンツ、SEO | ホスピタリティ求人、応募 |
| `mobility-dx` | モビリティ活用ガイド、事業者検索 | フリート相談、依頼・見積 | フリート管理、掲載、求人、AIコンテンツ、SEO | モビリティキャリア、応募 |
| `gx` | 脱炭素ガイド、事業者検索 | GX計画相談、依頼・見積 | 脱炭素・環境管理、掲載、求人、AIコンテンツ、SEO | サステナビリティキャリア、応募 |
| `regional-revitalization` | 地域ガイド、事業者検索 | 地域プロジェクト相談、依頼・見積 | 地域プロジェクト管理、掲載、求人、AIコンテンツ、SEO | コミュニティキャリア、応募 |

### データ項目の投影

事業者プロフィールは、同じ事業者でもロールに応じて返す項目を変えます。

| ロール | 返却する項目 |
|---|---|
| `user` | `publicFields`、確認状態、最終確認日 |
| `orderer` | `publicFields`、`ordererFields`、確認状態、最終確認日 |
| `provider` | 自社の場合のみ `providerFields` と掲載状態を追加 |
| `recruiter` | `publicFields`、`candidateFields`、確認状態、最終確認日 |

案件、応募、依頼、予約、通知も同じカテゴリ境界と本人・自社境界で絞り込みます。UIで隠すだけではなく、REST/MCPのサーバー側で再検証します。

## 3. ログインフロー

```text
未ログイン
  └─ GET /api/v1/auth/login-options
       └─ カテゴリと対象ロールを選択
            └─ POST /api/v1/auth/login または auth.login
                 ├─ 成功: accessToken + principal + experience
                 └─ MFA対象: challengeToken
                      └─ POST /api/v1/auth/mfa/complete
                           └─ accessToken + principal + experience
```

ログイン後のカテゴリ・ロール切替は再ログインではなく、許可済みの `availableContexts` から次のAPIを使います。

```text
POST /api/v1/auth/context
MCP: auth.switch_context
```

アカウントに割り当てのないカテゴリ・ロールへの切替は `403` とします。事業者は自社が所属するカテゴリ以外へ事業者ロールで切り替えられません。

## 4. REST / MCP契約

### ログイン前

```text
GET  /api/v1/auth/config
GET  /api/v1/auth/login-options
POST /api/v1/auth/login
POST /api/v1/auth/oidc/start
```

MCPでは、対応する操作を次の名前で提供します。

```text
auth.config
auth.login_options
auth.login
auth.oidc_start
```

`auth.login_options` は秘密情報やアカウント一覧を返さず、カテゴリ、ロール、対象者説明、表示モジュール、ナビゲーションだけを返します。

### ログイン後

```text
GET  /api/v1/auth/me
POST /api/v1/auth/context
POST /api/v1/auth/logout
```

`auth.me` と `auth.switch_context` は、現在の `principal` とそのカテゴリ・ロールに対応する `experience` を返します。AIエージェントはこの応答を読み、許可されていない操作を提案しません。

## 5. 認証・セキュリティ方針

- 開発時はデモアカウントを利用できます。本番ではOIDCを既定とし、デモアカウントとパスワードログインを無効化します。
- セッションは短時間のBearerトークンで管理し、状態ストアにはトークンのハッシュだけを保存します。
- パスワードは平文保存せず、MFA秘密鍵は暗号化キーが設定された場合だけ暗号化して保存します。
- ログイン、OIDC、MFAにはレート制限と監査ログを適用します。
- DBが追加できない環境ではファイルストアを利用できます。状態ストアの差し替え後もロール判定とカテゴリ投影の契約は変えません。

## 6. 実装上の正本

- ロール・カテゴリ定義: `src/domain/types.ts`
- カテゴリ別表示ポリシー: `src/domain/catalog.ts`
- 認証・セッション・コンテキスト切替: `src/domain/auth.ts`
- カテゴリ別投影・操作認可: `src/application/portal-service.ts`
- REST/MCP入口: `src/api/http-server.ts`
- ブラウザUI: `public/app.js`

表示制御を新しく追加するときは、画面側に条件を直書きせず、カテゴリポリシーの `visibleModules`、`visibleFields`、`allowedActions` に追加し、RESTとMCPの両方で同じ契約を返すことを原則とします。
