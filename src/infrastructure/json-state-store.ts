import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StateStore {
  load<T>(name: string, fallback: T): T;
  save<T>(name: string, value: T): void;
}

export class JsonStateStore implements StateStore {
  public constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  public load<T>(name: string, fallback: T): T {
    const path = join(this.directory, name);
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return fallback;
      throw error;
    }
  }

  public save<T>(name: string, value: T): void {
    const path = join(this.directory, name);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, path);
    } finally {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // 正常なrename後は一時ファイルが存在しないため、後処理の失敗は無視します。
      }
    }
  }
}
