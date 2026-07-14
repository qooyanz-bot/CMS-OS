# CMS-OS カテゴリレジストリ

CMS-OSのポータルカテゴリは、REST API、MCP、認証コンテキスト、静的公開、PostgreSQLの全境界で同じスラッグを使用します。現在のカテゴリは次の8件です。

| スラッグ | 表示名 | 主な案内テーマ |
|---|---|---|
| `legal` | 士業・弁護士 | 相続、企業法務、専門家相談 |
| `beauty` | 美容 | メニュー、予約、スタイル事例 |
| `ai-business` | 生成AI・業務改革 | 生成AI導入、業務自動化、社内活用 |
| `labor-shortage` | 人手不足・省人化 | 採用支援、業務省人化、現場改善 |
| `tourism` | 地域観光・インバウンド | 観光DX、多言語対応、地域体験 |
| `mobility-dx` | モビリティDX・SDV | 車両データ、モビリティサービス、業務システム連携 |
| `gx` | GX・省エネ・資源循環 | 省エネ、再エネ活用、資源循環 |
| `regional-revitalization` | 地方創生・移住・空き家再生 | 移住支援、空き家活用、地域事業開発 |

## 表示ポリシー

カテゴリごとに`CategoryPolicy`を持ち、ロールに応じてナビゲーション、表示モジュール、表示フィールド、操作権限、注意事項を返します。

- `user`: 公開事業者、テーマガイド、FAQを閲覧できます。非公開の依頼情報や管理指標は表示しません。
- `orderer`: 公開情報に加えて、依頼作成、見積もり相談、事業者との安全なメッセージ、依頼履歴を利用できます。
- `provider`: 自分の事業者情報、問い合わせ、求人、AIコンテンツ企画・下書き・清書・事実確認・SEO監査・公開ビルドを管理できます。
- `candidate`: 求人、事業者情報、カルチャー、応募、応募状況を利用できます。応募書類と選考情報は本人と関係事業者に限定します。APIでは`recruiter`も同じ権限の互換ロールとして利用できます。

`legal`と`beauty`は、法律相談の注意表示、メニュー・予約、スタイル事例などの専用モジュールを持ちます。追加テーマは共通ポリシーを使い、必要になったカテゴリだけ専用ポリシーへ差し替えられる構成です。

## APIとMCP

カテゴリは次のAPIで取得・利用できます。

```text
GET  /api/v1/categories
GET  /api/v1/categories/{category}
GET  /api/v1/categories/{category}/experience
GET  /api/v1/providers?category={category}
GET  /api/v1/jobs?category={category}
POST /mcp  category.resolve_experience
POST /mcp  category.get
POST /mcp  provider.search
```

MCPの`tools/list`は、実装中の`categorySlugs`からカテゴリ列挙を生成します。RESTとMCPで異なるカテゴリを受け付けないよう、サーバー側の入力検証も同じレジストリを参照します。

## 静的公開とSEO

カテゴリごとに次の静的URLを生成します。

```text
/categories/{category}/
/categories/{category}/providers/
/categories/{category}/providers/{providerId}/
```

カテゴリハブ、事業者一覧、事業者詳細、サイトマップ、`llms.txt`、内部リンク、JSON-LDは同じカテゴリレジストリから生成します。公開事業者の静的ページには公開フィールドだけを出力し、発注者・事業者内部・候補者向けフィールドは含めません。

## DB移行

新規環境は[`001_initial.sql`](../db/migrations/001_initial.sql)を適用します。既存環境で初期マイグレーションを適用済みの場合は、[`003_expand_category_slugs.sql`](../db/migrations/003_expand_category_slugs.sql)を追加適用してカテゴリ制約を更新します。コンテンツのアーカイブ状態を利用する場合は[`004_content_archive_status.sql`](../db/migrations/004_content_archive_status.sql)も適用します。

カテゴリを追加するときは、次の順番で変更します。

1. `src/domain/types.ts`の`categorySlugs`へ安全なURLスラッグを追加する。
2. `src/domain/catalog.ts`へ表示名、案内テーマ、ロール別ポリシー、必要な事業者データを追加する。
3. `001_initial.sql`と追加マイグレーションのカテゴリ制約を更新する。
4. OpenAPI、UI、カテゴリ別テスト、静的公開テストを更新する。
5. `npm test`でREST、MCP、認証、公開ビルドを検証する。
