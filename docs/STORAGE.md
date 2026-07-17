# CMS-OSストレージ仕様

## 現在の実装

CMS-OSは、ドメインサービスがストレージの詳細を直接知らない構成です。

| モード | 設定 | 用途 |
|---|---|---|
| `file` | `CMS_OS_STORAGE=file`（既定） | DBなしのローカル開発、単一プロセス運用 |
| `memory` | `CMS_OS_STORAGE=memory` | テスト、短時間のデモ |
| `postgres` | `CMS_OS_STORAGE=postgres` | 本番、複数プロセス、監査・バックアップ |

## ファイル永続化

```powershell
$env:CMS_OS_STORAGE = "file"
$env:CMS_OS_DATA_DIR = ".cms-os-data"
npm run dev
```

次のJSONファイルがデータディレクトリに保存されます。

- `auth-accounts.json`
- `auth-sessions.json`
- `auth-oidc-transactions.json`
- `auth-mfa-challenges.json`
- `auth-mfa-enrollments.json`
- `auth-audit-log.json`
- `portal-requests.json`
- `portal-bookings.json`: 美容カテゴリの予約リクエストと状態
- `portal-directory-guides.json`
- `portal-favorites.json`（アカウント・カテゴリごとの公開事業者お気に入り）
- `portal-jobs.json`
- `portal-applications.json`
- `portal-plans.json`（事業者ごとのテーマ・地域別ポータル計画、検索意図、ページ案、ギャップ）
- `content-proposals.json`
- `content-records.json`
- `content-versions.json`
- 翻訳版も `content-records.json` に保存し、`locale` と `translationOf` で原文・基準バージョンを参照します。
- `content-review-records.json`
- `seo-site-audits.json`
- `publication-history.json`
- `publication-schedules.json`
- `portal-media-assets.json`（画像・動画・PDFのメタデータ、権利状態、派生アセット）
- `media-seo-audits.json`（メディアSEO監査の履歴。アセット単位の直近結果はメディアアセットにも保持）
- `webhook-subscriptions.json`（Webhook購読と暗号化secret。暗号化キーは `CMS_OS_WEBHOOK_ENCRYPTION_KEY` を使用し、未指定時は `CMS_OS_AUTH_ENCRYPTION_KEY` を使用）
- `webhook-deliveries.json`（署名付きWebhook配信アウトボックス、試行回数、再試行状態）
- `operation-jobs.json`（単一・一括の非同期コンテンツ作成ジョブ、冪等性キー、実行状態、途中結果、AI段階チェックポイント、再開用の生成済みID）

セッション、OIDC state、MFAチャレンジは生値ではなくハッシュ化した値を保存します。MFA秘密鍵は`CMS_OS_AUTH_ENCRYPTION_KEY`で暗号化します。ファイルモードは単一インスタンスの開発・小規模検証用であり、複数プロセスからの同時書き込みや暗号化バックアップは別途運用設計が必要です。本番はPostgreSQLと秘密管理基盤を使用してください。

## PostgreSQL移行

PostgreSQL向けの正規化スキーマは[`db/migrations/001_initial.sql`](../db/migrations/001_initial.sql)、移行期の状態ストアは[`db/migrations/002_state_store.sql`](../db/migrations/002_state_store.sql)にあります。既存環境向けのカテゴリ拡張は[`003_expand_category_slugs.sql`](../db/migrations/003_expand_category_slugs.sql)、コンテンツのアーカイブ状態は[`004_content_archive_status.sql`](../db/migrations/004_content_archive_status.sql)、recruiterロール・公開可視性・Blogメタデータ・版管理項目は[`005_content_metadata.sql`](../db/migrations/005_content_metadata.sql)で更新します。

接続モードは次の環境変数で起動します。

```powershell
$env:CMS_OS_STORAGE = "postgres"
$env:DATABASE_URL = "postgres://user:password@localhost:5432/cms_os"
npm run dev
```

`PostgresStateStore`は起動時に`cms_os_state`をロードし、ドメインストアの書き込みを直列化してJSONBへ保存します。移行期間中もAPI/MCPの契約と所有者チェックを維持できます。正規化した各テーブルへ直接読み書きするリポジトリは、データ量とクエリパターンを確認したうえで段階的に切り替えます。

マイグレーションは次のコマンドで適用します。

```powershell
npm run db:migrate
```

`db:migrate`は`cms_os_schema_migrations`にファイル名とSHA-256チェックサムを保存し、PostgreSQL Advisory Lockで同時実行を直列化します。適用済みファイルは再実行せず、内容が変更されていた場合は停止します。接続先は`DATABASE_URL`または`CMS_OS_DATABASE_URL`から取得し、値は対象環境のシークレットストアだけで管理してください。

接続に失敗した場合、PostgreSQLモードからメモリモードへフォールバックしません。誤って揮発性ストレージで起動することを防ぎます。

スキーマでは、次の境界を分離します。

- アカウント、ロール割当、セッション
  - 公開ロールとは別のCMS内部ロール割当（担当カテゴリ・事業者・組織スコープ）
- カテゴリ別事業者、依頼、求人、応募
- AI企画案、コンテンツ、コンテンツバージョン
  - コンテンツのblocks、構造化データ、出典、locale、visibility、タグ、シリーズ、著者、注目表示、読了時間、公開期限、現在版
- 静的公開ビルド
- 監査ログ

本番接続時は、ファイルストアと同じリポジトリポートをPostgreSQL実装へ差し替えます。API/MCPの認証・認可、所有者境界、承認条件はストレージ実装によって変更しません。
