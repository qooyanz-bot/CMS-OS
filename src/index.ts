import { InMemoryAuthService } from "./domain/auth.js";
import { PortalService } from "./application/portal-service.js";
import { ContentService } from "./application/content-service.js";
import { PublicationService } from "./application/publication-service.js";
import { createHttpServer } from "./api/http-server.js";
import { PortalStore } from "./domain/portal-store.js";
import { ContentStore } from "./domain/content-store.js";
import { JsonStateStore } from "./infrastructure/json-state-store.js";

const port = Number(process.env.PORT ?? "8787");
const storageMode = process.env.CMS_OS_STORAGE ?? "memory";
const stateStore = storageMode === "file"
  ? new JsonStateStore(process.env.CMS_OS_DATA_DIR ?? ".cms-os-data")
  : undefined;
const auth = new InMemoryAuthService(stateStore);
const portal = new PortalService(auth, new PortalStore(stateStore));
const content = new ContentService(portal, new ContentStore(stateStore));
const publication = new PublicationService(portal, content);
const server = createHttpServer(auth, portal, content, publication);

server.listen(port, () => {
  console.log(`CMS-OS API/MCP server listening on http://localhost:${port}`);
});
