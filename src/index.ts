import { InMemoryAuthService } from "./domain/auth.js";
import { PortalService } from "./application/portal-service.js";
import { ContentService } from "./application/content-service.js";
import { createHttpServer } from "./api/http-server.js";

const port = Number(process.env.PORT ?? "8787");
const auth = new InMemoryAuthService();
const portal = new PortalService(auth);
const content = new ContentService(portal);
const server = createHttpServer(auth, portal, content);

server.listen(port, () => {
  console.log(`CMS-OS API/MCP server listening on http://localhost:${port}`);
});
