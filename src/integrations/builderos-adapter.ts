import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { PublicationBuildResult } from "../domain/types.js";

export class BuilderOSAdapterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BuilderOSAdapterError";
  }
}

export interface CloudflarePagesManifest {
  adapter: "BuilderOS Adapter";
  provider: "cloudflare-pages";
  mode: "static";
  freeTierCompatible: true;
  publicationId: string;
  outputDirectory: string;
  generatedAt: string;
  fileCount: number;
  files: string[];
}

const cloudflareHeaders = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;

function safeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new BuilderOSAdapterError(`公開ファイルのパスが相対パスではありません: ${path}`);
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.includes("..")) {
    throw new BuilderOSAdapterError(`公開ファイルのパスに安全でない要素があります: ${path}`);
  }
  return segments.join("/");
}

export class BuilderOSAdapter {
  public createCloudflareManifest(build: PublicationBuildResult, outputDirectory: string): CloudflarePagesManifest {
    const paths = new Set(build.files.map((file) => safeRelativePath(file.path)));
    paths.add("_headers");
    return {
      adapter: "BuilderOS Adapter",
      provider: "cloudflare-pages",
      mode: "static",
      freeTierCompatible: true,
      publicationId: build.publicationId,
      outputDirectory: resolve(outputDirectory),
      generatedAt: new Date().toISOString(),
      fileCount: paths.size,
      files: [...paths].sort(),
    };
  }

  public async exportToDirectory(build: PublicationBuildResult, outputDirectory: string): Promise<CloudflarePagesManifest> {
    const output = resolve(outputDirectory);
    const manifest = this.createCloudflareManifest(build, output);
    const seen = new Set<string>();
    await mkdir(output, { recursive: true });

    for (const file of build.files) {
      const path = safeRelativePath(file.path);
      if (seen.has(path)) throw new BuilderOSAdapterError(`公開ファイルが重複しています: ${path}`);
      seen.add(path);
      const destination = resolve(output, ...path.split("/"));
      const relativeDestination = relative(output, destination);
      if (relativeDestination === ".." || relativeDestination.startsWith(`..${sep}`)) {
        throw new BuilderOSAdapterError(`公開先が出力ディレクトリ外です: ${path}`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }

    await writeFile(resolve(output, "_headers"), cloudflareHeaders, "utf8");
    await writeFile(resolve(output, ".builderos-adapter.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  public createRequestId(): string {
    return `builderos-deploy-${randomUUID()}`;
  }
}
