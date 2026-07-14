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
- カテゴリ別の外部ディレクトリ・予約・事業者向け案内
- サーバー側の表示フィールド投影
- REST API
- カテゴリ別のお気に入り事業者保存・解除
- MCPの`tools/list`と`tools/call`
- 発注者による依頼作成
- 担当事業者による依頼閲覧
- 公開事業者への問い合わせ送信と状態管理
- 事業者掲載情報の審査待ち・公開・差戻し・停止管理
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
| `ai-business@example.com` | 生成AI・業務改革カテゴリの事業者 |
| `labor-shortage@example.com` | 人手不足・省人化カテゴリの事業者 |
| `tourism@example.com` | 地域観光・インバウンドカテゴリの事業者 |
| `mobility-dx@example.com` | モビリティDX・SDVカテゴリの事業者 |
| `gx@example.com` | GX・省エネ・資源循環カテゴリの事業者 |
| `regional@example.com` | 地方創生・移住・空き家再生カテゴリの事業者 |
| `candidate@example.com` | リクルーター |

APIの公開ロールは`recruiter`を正式名称とし、既存クライアント互換のため`candidate`も同じ権限で受け付けます。

ログイン成功、`GET /api/v1/auth/me`、`POST /api/v1/auth/context`の主体情報には`availableContexts`を返します。カテゴリごとに利用可能なロールを示すため、UIは事業者が所属するカテゴリだけを管理対象として表示し、別カテゴリではユーザー向け表示へ安全に切り替えます。互換入力の`candidate`は、切り替え候補では正規名`recruiter`として表示します。

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
カテゴリ文脈の`visibleModules`はカテゴリごとに異なります。`ai-business`はAI活用、`labor-shortage`は採用支援、`tourism`は観光体験、`mobility-dx`はフリート、`gx`は脱炭素、`regional-revitalization`は地域プロジェクトの専用モジュールを、ユーザー・発注者・事業者・リクルーターのロール別に投影します。
GET  /api/v1/categories/{category}
GET  /api/v1/categories/{category}/experience
GET  /api/v1/categories/{category}/directories
POST /api/v1/directories                  # 運営キーで外部案内を追加
PATCH /api/v1/directories/{directoryId}   # 運営キーで外部案内を更新
DELETE /api/v1/directories/{directoryId}  # 運営キーで外部案内を削除
外部案内は運営キーを持つAPI/MCP連携だけが追加・更新・削除できます。閲覧時はカテゴリと現在のロールに応じて対象案内を投影します。
GET  /api/v1/providers?category=beauty&theme=カラー
GET  /api/v1/providers/{providerId}
GET  /api/v1/favorites?limit=50&cursor=0
POST /api/v1/favorites
DELETE /api/v1/favorites/{favoriteId}
PATCH /api/v1/providers/{providerId}
POST /api/v1/providers/{providerId}/listing-submission
PATCH /api/v1/providers/{providerId}/listing-review
GET  /api/v1/provider-listing-reviews
POST /api/v1/requests
GET  /api/v1/requests
PATCH /api/v1/requests/{requestId}
POST /api/v1/inquiries
GET  /api/v1/inquiries
PATCH /api/v1/inquiries/{inquiryId}
GET  /api/v1/notifications
PATCH /api/v1/notifications/{notificationId}
GET  /api/v1/jobs?category=legal
POST /api/v1/jobs
PATCH /api/v1/jobs/{jobId}
POST /api/v1/jobs/{jobId}/applications
GET  /api/v1/applications
PATCH /api/v1/applications/{applicationId}
GET  /api/v1/notifications?limit=50&cursor=0
PATCH /api/v1/notifications/{notificationId}
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

## カテゴリ別外部案内

`GET /api/v1/categories/{category}/directories` またはMCPの`directory.list`で、現在のカテゴリとロールに応じた外部案内を取得できます。案内は事業者掲載情報とは分離し、外部サイトへのリンク、用途、対象ロール、最終確認日を返します。

法律カテゴリでは、弁護士ドットコムに加えて、弁護士・税理士・司法書士・行政書士などを横断検索できる「士業ねっと！」をユーザー・発注者向けの案内として初期登録しています。外部サイトの掲載内容や利用条件は、`verifiedAt`を更新しながら運営が確認します。

- 法律カテゴリ：弁護士ドットコムなどの相談・検索案内
- 美容カテゴリ：ホットペッパービューティーなどの検索・予約案内
- 美容事業者ロール：掲載案内など事業者向け情報
- 生成AI・業務改革：デジタル化・AI導入補助金
- 人手不足・省人化：ハローワークインターネットサービス
- 地域観光・インバウンド：日本政府観光局（JNTO）
- モビリティDX・SDV：経済産業省のモビリティDX戦略
- GX・省エネ・資源循環：環境省の脱炭素ポータル
- 地方創生・移住・空き家再生：ニッポン移住・交流ナビ JOIN

外部サービスの掲載は推薦・提携・品質保証を意味しません。URL、用途、確認日を管理対象にし、変更や掲載終了を反映できるようにします。

`PATCH /api/v1/providers/{providerId}`、`POST /api/v1/jobs`、`PATCH /api/v1/jobs/{jobId}` は、対象カテゴリに所属する事業者本人だけが実行できます。MCPでも `provider.get`、`provider.update`、`job.create`、`job.update` を同じ権限判定で利用できます。

掲載状態は `draft`（下書き）、`pending_review`（審査中）、`published`（公開中）、`suspended`（停止中）で管理します。事業者本人が `POST /api/v1/providers/{providerId}/listing-submission` またはMCPの `provider.listing_submit` を実行すると審査中になり、公開検索から除外されます。運営審査はログインロールとは分離し、`CMS_OS_OPERATOR_KEY` と `x-cms-os-operator-key` ヘッダーを使う `PATCH /api/v1/providers/{providerId}/listing-review` またはMCPの `provider.listing_review` で行います。

問い合わせは `POST /api/v1/inquiries` またはMCPの `inquiry.create` で作成します。送信者は自分の問い合わせ、事業者は自社宛ての問い合わせだけを取得できます。状態は `open`（受付中）→ `responded`（返信済み）→ `closed`（終了）で、RESTとMCPは同じ状態遷移・所有者検証を利用します。

問い合わせの作成・返信・終了、掲載審査の送信・結果を通知として保存します。`GET /api/v1/notifications` はログイン中の本人または自社事業者の通知だけを返し、`limit` と `cursor` によるページングに対応します。通知は本人の操作で既読・未読を切り替えられます。

依頼、求人、応募の一覧も `{ items, page }` 形式で返します。`limit` は1〜100、`cursor` は次ページ取得位置です。依頼の作成・状態変更、応募の作成・状態変更は、対象の事業者、発注者、リクルーターへ通知されます。

事業者・依頼・求人・応募の一覧は、`search`、カテゴリ固有のフィルター、`sort` を組み合わせて検索できます。条件はANDで適用し、RESTとMCPで同じ結果形式・同じ権限制御を使用します。公開事業者はテーマ・地域、依頼は状態、求人は雇用形態・地域・状態、応募は求人ID・状態で絞り込めます。

運営は `GET /api/v1/provider-listing-reviews` またはMCPの `provider.listing_review_queue` で審査待ち掲載情報を取得できます。カテゴリ、掲載状態、limit、cursorで絞り込みます。運営キーはブラウザUIへ渡さず、API/MCP連携側で管理します。

お気に入りは `POST /api/v1/favorites`（`favorite.add`）、`GET /api/v1/favorites`（`favorite.list`）、`DELETE /api/v1/favorites/{favoriteId}`（`favorite.remove`）で操作します。現在のアカウントとカテゴリに限定し、公開中の事業者だけを保存できます。同じ事業者の再登録は冪等に既存項目を返し、事業者ロールにはお気に入り操作を表示・許可しません。

## 依頼・求人応募の権限

| 操作 | ユーザー | 発注者 | 事業者 | リクルーター |
|---|---:|---:|---:|---:|
| 公開事業者検索 | ○ | ○ | ○ | ○ |
| お気に入り保存・解除 | ○ | ○ | × | ○ |
| 依頼作成 | × | ○ | × | × |
| 担当依頼の閲覧 | × | ○ | ○ | × |
| 公開事業者への問い合わせ | ○ | ○ | × | ○ |
| 自分の問い合わせの閲覧・終了 | ○ | ○ | × | ○ |
| 自社宛て問い合わせの閲覧・返信 | × | × | ○ | × |
| 公開求人の閲覧 | ○ | ○ | ○ | ○ |
| 求人への応募 | × | × | × | ○ |
| 担当求人の応募閲覧 | × | × | ○ | × |

## 開発用ポータルUI

- お気に入り一覧：ユーザー、発注者、リクルーターが現在カテゴリの公開事業者を保存・解除
- 事業者プロフィール詳細：一覧からAPIのロール別投影を取得し、公開項目・発注者向け項目・リクルーター向け項目を権限に応じて表示

事業者ロールでログインすると、APIを正本とした次の管理導線が表示されます。

- 掲載情報フォーム：事業者名、テーマ、所在地、公開項目を `PATCH /api/v1/providers/{providerId}` で更新
- 求人作成フォーム：求人を `POST /api/v1/jobs` で作成
- 求人一覧の状態操作：自社求人を `PATCH /api/v1/jobs/{jobId}` で公開・終了
- 依頼・応募の状態表示：発注者、事業者、リクルーターの対象データだけを一覧表示
- 状態操作：事業者の依頼受付・応募選考、発注者の依頼終了を許可された遷移だけ実行
- 問い合わせフォーム：ユーザー、発注者、リクルーターが検索結果から送信
- 問い合わせ管理：事業者は自社宛て問い合わせを返信済み・終了へ更新
- 掲載審査送信：事業者が自社掲載を審査へ送信し、状態と審査メモを確認
- ポータル企画：事業者がテーマ・地域・対象ポジションから計画を作成し、既存コンテンツの被覆不足を確認して下書きへ適用
- AIコンテンツ編集：清書・事実確認・SEO監査・レビュー・承認後、BuilderOS Adapter経由の静的ビルドと公開を実行
- 予約公開管理：承認済みコンテンツの公開日時を指定し、予約一覧の確認と未実行予約の取消を実行。Cloudflare Cronなどの運営ジョブは運営キーで全カテゴリの期限到来分を実行
- 通知一覧：問い合わせ・掲載審査に関する本人向け通知を表示し、既読化
- 一覧フィルター：事業者、求人、依頼、応募をAPIの検索・状態・地域・雇用形態・並び順で再取得
- 一般ユーザー、発注者、リクルーターには事業者管理フォームを表示しない

APIを操作する最小のブラウザUIを同梱しています。起動時に`GET /api/v1/categories`からカテゴリ一覧を取得して選択肢を生成するため、カテゴリ定義を追加してもUIへ自動反映されます。カテゴリを選択すると、そのカテゴリの表示モジュール、事業者、求人が切り替わります。複数カテゴリに割り当てられたユーザー・発注者・リクルーターは、ログイン状態を保持したまま`POST /api/v1/auth/context`でカテゴリまたはロールを切り替えます。カテゴリ割り当てのない事業者は切り替えを拒否し、対象カテゴリへ再ログインします。

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
