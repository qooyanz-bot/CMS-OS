import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import test from "node:test";
import { discoverMigrations, runMigrations, type MigrationDefinition, type MigrationQueryClient } from "../src/infrastructure/postgres-migrations.js";

class FakeMigrationClient implements MigrationQueryClient {
  public readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  public readonly applied = new Map<string, { name: string; checksum: string }>();

  public async query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ text, ...(values ? { values } : {}) });
    if (text.startsWith("SELECT migration_id, migration_name, checksum")) {
      return {
        rows: [...this.applied.entries()].map(([migrationId, migration]) => ({
          migration_id: migrationId,
          migration_name: migration.name,
          checksum: migration.checksum,
        })) as T[],
      };
    }
    if (text.startsWith("INSERT INTO cms_os_schema_migrations")) {
      const [migrationId, name, checksum] = values ?? [];
      this.applied.set(String(migrationId), { name: String(name), checksum: String(checksum) });
    }
    return { rows: [] as T[] };
  }
}

test("CMS-OS PostgreSQLマイグレーションの検出順とチェックサムを生成できる", async () => {
  const migrations = await discoverMigrations(resolve("db", "migrations"));
  assert.deepEqual(migrations.map((migration) => migration.name), [
    "001_initial.sql",
    "002_state_store.sql",
    "003_expand_category_slugs.sql",
    "004_content_archive_status.sql",
    "005_content_metadata.sql",
  ]);
  assert.ok(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksum)));
});

test("CMS-OS PostgreSQLマイグレーションは初回適用後に再実行をスキップできる", async () => {
  const migrations: MigrationDefinition[] = [
    { id: "001_first", name: "001_first.sql", sql: "BEGIN; SELECT 1; COMMIT;", checksum: "a".repeat(64) },
    { id: "002_second", name: "002_second.sql", sql: "BEGIN; SELECT 2; COMMIT;", checksum: "b".repeat(64) },
  ];
  const client = new FakeMigrationClient();

  const first = await runMigrations(client, migrations);
  const second = await runMigrations(client, migrations);

  assert.deepEqual(first.applied, ["001_first.sql", "002_second.sql"]);
  assert.deepEqual(first.skipped, []);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, ["001_first.sql", "002_second.sql"]);
  assert.equal(client.calls.filter((call) => call.text === "BEGIN").length, 2);
  assert.equal(client.calls.filter((call) => call.text === "COMMIT").length, 2);
});

test("CMS-OS PostgreSQLマイグレーションは適用済みファイルの改変を拒否する", async () => {
  const migration: MigrationDefinition = {
    id: "001_first",
    name: "001_first.sql",
    sql: "BEGIN; SELECT 1; COMMIT;",
    checksum: "a".repeat(64),
  };
  const client = new FakeMigrationClient();
  client.applied.set(migration.id, { name: migration.name, checksum: "c".repeat(64) });

  await assert.rejects(
    () => runMigrations(client, [migration]),
    /チェックサムが一致しません/,
  );
});
