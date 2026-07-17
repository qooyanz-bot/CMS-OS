import { fileURLToPath } from "node:url";
import { runPostgresMigrations } from "../infrastructure/postgres-migrations.js";

const connectionString = process.env.DATABASE_URL ?? process.env.CMS_OS_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URLまたはCMS_OS_DATABASE_URLが必要です。");

const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const result = await runPostgresMigrations(connectionString, migrationsDirectory);
console.log(`マイグレーション適用: ${result.applied.length}件`);
console.log(`マイグレーション済み: ${result.skipped.length}件`);
if (result.applied.length > 0) console.log(result.applied.join("\n"));
