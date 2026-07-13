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
});
