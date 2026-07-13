# CMS-OSストレージ仕様

## 現在の実装

CMS-OSは、ドメインサービスがストレージの詳細を直接知らない構成です。

| モード | 設定 | 用途 |
|---|---|---|
| `memory` | `CMS_OS_STORAGE=memory`（既定） | テスト、短時間のデモ |
| `file` | `CMS_OS_STORAGE=file` | ローカル開発、単一プロセスの検証 |
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
- `portal-requests.json`
- `portal-jobs.json`
- `portal-applications.json`
- `content-proposals.json`
- `content-records.json`

セッションは生トークンではなくSHA-256ハッシュだけを保存します。ファイルモードは単一インスタンスの開発用であり、複数プロセスからの同時書き込み、暗号化バックアップ、OIDC、MFAを提供するものではありません。

## PostgreSQL移行

PostgreSQL向けの正規化スキーマは[`db/migrations/001_initial.sql`](../db/migrations/001_initial.sql)、移行期の状態ストアは[`db/migrations/002_state_store.sql`](../db/migrations/002_state_store.sql)にあります。

接続モードは次の環境変数で起動します。

```powershell
$env:CMS_OS_STORAGE = "postgres"
$env:DATABASE_URL = "postgres://user:password@localhost:5432/cms_os"
npm run dev
```

`PostgresStateStore`は起動時に`cms_os_state`をロードし、ドメインストアの書き込みを直列化してJSONBへ保存します。移行期間中もAPI/MCPの契約と所有者チェックを維持できます。正規化した各テーブルへ直接読み書きするリポジトリは、データ量とクエリパターンを確認したうえで段階的に切り替えます。

接続に失敗した場合、PostgreSQLモードからメモリモードへフォールバックしません。誤って揮発性ストレージで起動することを防ぎます。

スキーマでは、次の境界を分離します。

- アカウント、ロール割当、セッション
- カテゴリ別事業者、依頼、求人、応募
- AI企画案、コンテンツ、コンテンツバージョン
- 静的公開ビルド
- 監査ログ

本番接続時は、ファイルストアと同じリポジトリポートをPostgreSQL実装へ差し替えます。API/MCPの認証・認可、所有者境界、承認条件はストレージ実装によって変更しません。
