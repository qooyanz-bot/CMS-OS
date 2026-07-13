import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class JsonStateStore {
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
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
