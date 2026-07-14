import { authOptionsFromEnvironment, InMemoryAuthService } from "./domain/auth.js";
import { PortalService } from "./application/portal-service.js";
import { ContentService } from "./application/content-service.js";
import { PublicationService } from "./application/publication-service.js";
import { MediaService } from "./application/media-service.js";
import { WebhookService } from "./application/webhook-service.js";
import { OperationService } from "./application/operation-service.js";
import { PortalPlanningService } from "./application/portal-planning-service.js";
import { createHttpServer } from "./api/http-server.js";
import { PortalStore } from "./domain/portal-store.js";
import { ContentStore } from "./domain/content-store.js";
import { PublicationStore } from "./domain/publication-store.js";
import { MediaStore } from "./domain/media-store.js";
import { JsonStateStore, type StateStore } from "./infrastructure/json-state-store.js";
import { PostgresStateStore } from "./infrastructure/postgres-state-store.js";

async function createStateStore(): Promise<StateStore | undefined> {
  const storageMode = process.env.CMS_OS_STORAGE ?? "memory";
  if (storageMode === "memory") return undefined;
  if (storageMode === "file") return new JsonStateStore(process.env.CMS_OS_DATA_DIR ?? ".cms-os-data");
  if (storageMode === "postgres") {
    const connectionString = process.env.DATABASE_URL ?? process.env.CMS_OS_DATABASE_URL;
    if (!connectionString) throw new Error("CMS_OS_STORAGE=postgresにはDATABASE_URLまたはCMS_OS_DATABASE_URLが必要です。");
    return PostgresStateStore.connect(connectionString);
  }
  throw new Error(`未対応のCMS_OS_STORAGEです: ${storageMode}`);
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? "8787");
  const stateStore = await createStateStore();
  const auth = new InMemoryAuthService(stateStore, authOptionsFromEnvironment());
  const portal = new PortalService(auth, new PortalStore(stateStore));
  const webhook = new WebhookService(portal, undefined, stateStore);
  const content = new ContentService(portal, new ContentStore(stateStore), webhook);
  const publication = new PublicationService(portal, content, undefined, undefined, new PublicationStore(stateStore), webhook);
  const media = new MediaService(portal, new MediaStore(stateStore), webhook);
  const operation = new OperationService(portal, content, stateStore);
  const portalPlanning = new PortalPlanningService(portal, stateStore);
  const server = createHttpServer(auth, portal, content, publication, media, webhook, operation, portalPlanning);

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (stateStore instanceof PostgresStateStore) await stateStore.close();
  };

  let shuttingDown = false;
  const handleSignal = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown().then(() => process.exit(0)).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "終了処理に失敗しました。");
      process.exit(1);
    });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  server.listen(port, () => {
    console.log(`CMS-OS API/MCP server listening on http://localhost:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "CMS-OSの起動に失敗しました。");
  process.exitCode = 1;
});
