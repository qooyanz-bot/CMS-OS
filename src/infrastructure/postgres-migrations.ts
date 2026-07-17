import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Client } from "pg";

export interface MigrationQueryClient {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface MigrationDefinition {
  id: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

interface AppliedMigrationRow {
  migration_id: string;
  migration_name: string;
  checksum: string;
}

const migrationFilePattern = /^\d+_[a-z0-9][a-z0-9_-]*\.sql$/i;
const migrationTableSql = `
CREATE TABLE IF NOT EXISTS cms_os_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
const migrationLockKey = "cms-os:database-migrations";

export async function discoverMigrations(directory: string): Promise<MigrationDefinition[]> {
  const entries = await readdir(resolve(directory), { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && migrationFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(directory, name), "utf8");
    return {
      id: basename(name, ".sql"),
      name,
      sql,
      checksum: createHash("sha256").update(sql, "utf8").digest("hex"),
    } satisfies MigrationDefinition;
  }));

  const ids = new Set<string>();
  for (const migration of migrations) {
    if (ids.has(migration.id)) throw new Error(`マイグレーションIDが重複しています: ${migration.id}`);
    ids.add(migration.id);
  }
  return migrations;
}

export async function runMigrations(client: MigrationQueryClient, migrations: readonly MigrationDefinition[]): Promise<MigrationRunResult> {
  if (migrations.length === 0) throw new Error("適用対象のマイグレーションがありません。");

  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [migrationLockKey]);
  try {
    await client.query(migrationTableSql);
    const existing = await client.query<AppliedMigrationRow>(
      "SELECT migration_id, migration_name, checksum FROM cms_os_schema_migrations ORDER BY migration_id",
    );
    const appliedById = new Map(existing.rows.map((row) => [row.migration_id, row]));
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      const current = appliedById.get(migration.id);
      if (current) {
        if (current.checksum !== migration.checksum) {
          throw new Error(`適用済みマイグレーションのチェックサムが一致しません: ${migration.name}`);
        }
        skipped.push(migration.name);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(stripTransactionWrappers(migration.sql));
        await client.query(
          "INSERT INTO cms_os_schema_migrations (migration_id, migration_name, checksum) VALUES ($1, $2, $3)",
          [migration.id, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.name);
        appliedById.set(migration.id, {
          migration_id: migration.id,
          migration_name: migration.name,
          checksum: migration.checksum,
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`マイグレーションの適用に失敗しました: ${migration.name}`, { cause: error });
      }
    }

    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [migrationLockKey]);
  }
}

export async function runPostgresMigrations(connectionString: string, migrationsDirectory: string): Promise<MigrationRunResult> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: Number(process.env.CMS_OS_DB_CONNECTION_TIMEOUT_MS ?? "5000"),
  });
  try {
    await client.connect();
    const migrations = await discoverMigrations(migrationsDirectory);
    return await runMigrations(client, migrations);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function stripTransactionWrappers(sql: string): string {
  const leading = sql.replace(/^\uFEFF?\s*BEGIN\s*;\s*/i, "");
  return leading.replace(/\s*COMMIT\s*;\s*$/i, "");
}
