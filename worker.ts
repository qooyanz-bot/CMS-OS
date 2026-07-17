interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

const apiOrigin = "https://cms-os-api.tsumugix.uk";

function isApiRequest(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/api/v1/");
}

function isBodylessMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    if (!isApiRequest(requestUrl.pathname)) {
      return env.ASSETS.fetch(request);
    }

    const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, apiOrigin);
    const headers = new Headers(request.headers);
    headers.delete("host");

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers,
      body: isBodylessMethod(request.method) ? undefined : request.body,
      redirect: "manual",
    });
    const upstreamResponse = await fetch(upstreamRequest);
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("Access-Control-Allow-Origin", requestUrl.origin);
    responseHeaders.set("Vary", "Origin");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
