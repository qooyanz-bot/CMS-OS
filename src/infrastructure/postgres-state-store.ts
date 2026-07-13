import { Pool } from "pg";
import type { StateStore } from "./json-state-store.js";

export interface PostgresQueryClient {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface StateRow {
  state_key: string;
  state_value: unknown;
}

const ensureTableSql = `
CREATE TABLE IF NOT EXISTS cms_os_state (
  state_key TEXT PRIMARY KEY,
  state_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

const upsertSql = `
INSERT INTO cms_os_state (state_key, state_value, updated_at)
VALUES ($1, $2::jsonb, NOW())
ON CONFLICT (state_key) DO UPDATE
SET state_value = EXCLUDED.state_value, updated_at = NOW()`;

export class PostgresStateStore implements StateStore {
  private readonly values: Map<string, unknown>;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastWriteError: unknown;

  private constructor(
    private readonly client: PostgresQueryClient,
    initialValues: Map<string, unknown>,
  ) {
    this.values = initialValues;
  }

  public static async connect(connectionString: string): Promise<PostgresStateStore> {
    const pool = new Pool({
      connectionString,
      max: Number(process.env.CMS_OS_DB_POOL_MAX ?? "10"),
      connectionTimeoutMillis: Number(process.env.CMS_OS_DB_CONNECTION_TIMEOUT_MS ?? "5000"),
    });
    try {
      return await PostgresStateStore.fromClient(pool as unknown as PostgresQueryClient);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  public static async fromClient(client: PostgresQueryClient): Promise<PostgresStateStore> {
    await client.query(ensureTableSql);
    const result = await client.query<StateRow>("SELECT state_key, state_value FROM cms_os_state");
    const values = new Map(result.rows.map((row) => [row.state_key, row.state_value]));
    return new PostgresStateStore(client, values);
  }

  public load<T>(name: string, fallback: T): T {
    const value = this.values.get(name);
    return value === undefined ? fallback : value as T;
  }

  public save<T>(name: string, value: T): void {
    this.values.set(name, value);
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      try {
        await this.client.query(upsertSql, [name, JSON.stringify(value)]);
      } catch (error) {
        this.lastWriteError = error;
      }
    });
  }

  public async flush(): Promise<void> {
    await this.writeQueue;
    if (this.lastWriteError) {
      const error = this.lastWriteError;
      this.lastWriteError = undefined;
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.client.end();
    }
  }
}
