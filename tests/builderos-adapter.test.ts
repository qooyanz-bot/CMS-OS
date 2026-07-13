import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { BuilderOSAdapter, BuilderOSAdapterError } from "../src/integrations/builderos-adapter.js";
import type { PublicationBuildResult } from "../src/domain/types.js";

let outputDirectory: string;

before(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), "cms-os-builderos-"));
});

after(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

const build: PublicationBuildResult = {
  publicationId: "publication-test",
  baseUrl: "https://www.example.com",
  contentIds: ["content-test"],
  generatedAt: "2026-07-14T00:00:00.000Z",
  files: [
    { path: "index.html", contentType: "text/html; charset=utf-8", content: "<html>CMS-OS</html>" },
    { path: "content/example/index.html", contentType: "text/html; charset=utf-8", content: "<article>記事</article>" },
  ],
};

describe("BuilderOS Adapter", () => {
  it("Cloudflare Pages向けの静的ファイルとマニフェストを出力する", async () => {
    const adapter = new BuilderOSAdapter();
    const manifest = await adapter.exportToDirectory(build, outputDirectory);

    assert.equal(manifest.adapter, "BuilderOS Adapter");
    assert.equal(manifest.provider, "cloudflare-pages");
    assert.equal(manifest.mode, "static");
    assert.equal(manifest.freeTierCompatible, true);
    assert.ok(manifest.files.includes("_headers"));
    assert.equal(await readFile(join(outputDirectory, "index.html"), "utf8"), "<html>CMS-OS</html>");
    assert.equal(await readFile(join(outputDirectory, "content/example/index.html"), "utf8"), "<article>記事</article>");
    assert.match(await readFile(join(outputDirectory, "_headers"), "utf8"), /X-Content-Type-Options: nosniff/);
    assert.match(await readFile(join(outputDirectory, ".builderos-adapter.json"), "utf8"), /cloudflare-pages/);
  });

  it("絶対パスとパストラバーサルを拒否する", async () => {
    const adapter = new BuilderOSAdapter();
    const firstFile = build.files[0];
    if (!firstFile) throw new Error("テスト用ファイルがありません。");
    const unsafe: PublicationBuildResult = { ...build, files: [{ ...firstFile, path: "../outside.html" }] };
    await assert.rejects(() => adapter.exportToDirectory(unsafe, outputDirectory), BuilderOSAdapterError);

    const absolute: PublicationBuildResult = { ...build, files: [{ ...firstFile, path: "/outside.html" }] };
    await assert.rejects(() => adapter.exportToDirectory(absolute, outputDirectory), BuilderOSAdapterError);
  });

  it("Cloudflare Pages Direct Uploadの段階APIをモック通信で実行する", async () => {
    const adapter = new BuilderOSAdapter();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/upload-token")) {
        return new Response(JSON.stringify({ success: true, result: { jwt: "upload-jwt" } }), { status: 200 });
      }
      if (url.endsWith("/check-missing")) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ success: true, result: body.hashes }), { status: 200 });
      }
      if (url.endsWith("/assets/upload") || url.endsWith("/upsert-hashes")) {
        return new Response(JSON.stringify({ success: true, result: null }), { status: 200 });
      }
      if (url.endsWith("/deployments")) {
        return new Response(JSON.stringify({
          success: true,
          result: { id: "deployment-test", url: "https://cms-os.pages.dev", environment: "production" },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, errors: [{ message: "想定外のURL" }] }), { status: 404 });
    };

    const result = await adapter.deployToCloudflarePages(build, {
      accountId: "account-test",
      projectName: "cms-os-test",
      apiToken: "token-that-must-not-be-logged",
      apiBaseUrl: "https://api.example.test/client/v4",
      fetchImplementation: mockFetch,
    });

    assert.equal(result.status, "submitted");
    assert.equal(result.deploymentId, "deployment-test");
    assert.equal(result.deploymentUrl, "https://cms-os.pages.dev");
    assert.equal(result.uploadedFileCount, build.files.length);
    assert.equal(calls.length, 5);
    assert.equal(calls[0]?.init?.headers && new Headers(calls[0].init.headers).get("authorization"), "Bearer token-that-must-not-be-logged");
    assert.equal(calls[4]?.init?.headers && new Headers(calls[4].init.headers).get("authorization"), "Bearer token-that-must-not-be-logged");
    const deploymentBody = calls[4]?.init?.body;
    assert.ok(deploymentBody instanceof FormData);
    assert.match(String(deploymentBody.get("manifest")), /index\.html/);
    assert.ok(deploymentBody.get("_headers") instanceof File);
  });

  it("Cloudflare Pages Direct Uploadのドライランは認証情報なしで実行できる", async () => {
    const adapter = new BuilderOSAdapter();
    const result = await adapter.deployToCloudflarePages(build, {
      accountId: "account-test",
      projectName: "cms-os-test",
      dryRun: true,
    });

    assert.equal(result.status, "dry_run");
    assert.equal(result.fileCount, build.files.length);
    assert.equal(result.uploadedFileCount, 0);
  });
});
