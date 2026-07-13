import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresStateStore, type PostgresQueryClient } from "../src/infrastructure/postgres-state-store.js";

class FakePostgresClient implements PostgresQueryClient {
  public readonly values = new Map<string, unknown>();
  public readonly queries: string[] = [];
  public ended = false;

  public async query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    this.queries.push(text);
    if (text.includes("SELECT state_key")) {
      return {
        rows: [...this.values.entries()].map(([state_key, state_value]) => ({ state_key, state_value })) as T[],
      };
    }
    if (text.includes("INSERT INTO cms_os_state")) {
      const key = String(values?.[0]);
      this.values.set(key, JSON.parse(String(values?.[1])));
    }
    return { rows: [] as T[] };
  }

  public async end(): Promise<void> {
    this.ended = true;
  }
}

describe("PostgresStateStore", () => {
  it("起動時にロードし、書き込みを直列化して再起動後に復元する", async () => {
    const client = new FakePostgresClient();
    const first = await PostgresStateStore.fromClient(client);
    assert.deepEqual(first.load("missing", { fallback: true }), { fallback: true });

    first.save("example.json", { count: 1, values: ["cms-os"] });
    first.save("example.json", { count: 2, values: ["cms-os", "postgres"] });
    await first.flush();

    const restarted = await PostgresStateStore.fromClient(client);
    assert.deepEqual(restarted.load("example.json", null), { count: 2, values: ["cms-os", "postgres"] });
    assert.ok(client.queries.some((query) => query.includes("ON CONFLICT")));

    await restarted.close();
    assert.equal(client.ended, true);
  });
});
