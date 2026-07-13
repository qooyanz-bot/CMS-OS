import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { blake3 } from "@noble/hashes/blake3.js";
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

export interface CloudflarePagesDeployOptions {
  accountId: string;
  projectName: string;
  apiToken?: string;
  branch?: string;
  commitHash?: string;
  commitMessage?: string;
  commitDirty?: boolean;
  skipCaching?: boolean;
  dryRun?: boolean;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
}

export interface CloudflarePagesDeploymentResult {
  status: "submitted" | "dry_run";
  provider: "cloudflare-pages";
  projectName: string;
  requestId: string;
  publicationId: string;
  fileCount: number;
  uploadedFileCount: number;
  deploymentId?: string;
  deploymentUrl?: string;
  environment?: string;
}

const cloudflareHeaders = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;

const CLOUDFLARE_API_DEFAULT = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_MAX_FILE_SIZE = 25 * 1024 * 1024;
const CLOUDFLARE_MAX_FILE_COUNT = 20_000;
const CLOUDFLARE_UPLOAD_BATCH_SIZE = 10 * 1024 * 1024;

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

type CloudflareApiResponse<T> = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: T;
};

type CloudflareAsset = {
  path: string;
  content: string;
  contentType: string;
  hash: string;
  size: number;
};

function hashContent(content: string, path: string): string {
  const base64Content = Buffer.from(content, "utf8").toString("base64");
  const extension = extname(path).substring(1);
  return Buffer.from(blake3(new TextEncoder().encode(base64Content + extension))).toString("hex").slice(0, 32);
}

function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function getCloudflareResult<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "result" in payload) {
    return (payload as CloudflareApiResponse<T>).result as T;
  }
  return payload as T;
}

function getCloudflareError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("errors" in payload)) return undefined;
  const errors = (payload as CloudflareApiResponse<unknown>).errors;
  return errors?.map((error) => error.message).filter((message): message is string => Boolean(message)).join("; ");
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

  public async deployToCloudflarePages(
    build: PublicationBuildResult,
    options: CloudflarePagesDeployOptions,
  ): Promise<CloudflarePagesDeploymentResult> {
    const requestId = this.createRequestId();
    const assets = this.createCloudflareAssets(build);
    this.validateCloudflareDeployOptions(options, assets.length);

    if (options.dryRun) {
      return {
        status: "dry_run",
        provider: "cloudflare-pages",
        projectName: options.projectName,
        requestId,
        publicationId: build.publicationId,
        fileCount: assets.length,
        uploadedFileCount: 0,
      };
    }

    const apiToken = options.apiToken as string;
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const apiBaseUrl = (options.apiBaseUrl ?? CLOUDFLARE_API_DEFAULT).replace(/\/$/, "");
    const accountId = encodeURIComponent(options.accountId);
    const projectName = encodeURIComponent(options.projectName);
    const uploadTokenPath = `/accounts/${accountId}/pages/projects/${projectName}/upload-token`;
    const uploadTokenResponse = await this.cloudflareRequest<{ jwt: string }>(fetchImplementation, `${apiBaseUrl}${uploadTokenPath}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}` },
    }, apiToken);
    if (!uploadTokenResponse.jwt) throw new BuilderOSAdapterError("Cloudflare PagesのアップロードJWTを取得できませんでした。");

    const hashes = assets.map((asset) => asset.hash);
    const missingHashesResponse = options.skipCaching
      ? hashes
      : await this.cloudflareRequest<string[]>(fetchImplementation, `${apiBaseUrl}/pages/assets/check-missing`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${uploadTokenResponse.jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ hashes }),
      }, apiToken);
    const missingHashes = new Set(missingHashesResponse);
    const missingAssets = assets.filter((asset) => missingHashes.has(asset.hash));

    for (const batch of this.createUploadBatches(missingAssets)) {
      await this.cloudflareRequest(fetchImplementation, `${apiBaseUrl}/pages/assets/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${uploadTokenResponse.jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(batch.map((asset) => ({
          key: asset.hash,
          value: Buffer.from(asset.content, "utf8").toString("base64"),
          metadata: { contentType: asset.contentType },
          base64: true,
        }))),
      }, apiToken);
    }

    await this.cloudflareRequest(fetchImplementation, `${apiBaseUrl}/pages/assets/upsert-hashes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${uploadTokenResponse.jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ hashes }),
    }, apiToken);

    const formData = new FormData();
    formData.append("manifest", JSON.stringify(Object.fromEntries(assets.map((asset) => [`/${asset.path}`, asset.hash]))));
    formData.append("_headers", new File([cloudflareHeaders], "_headers", { type: "text/plain" }));
    if (options.branch) formData.append("branch", options.branch);
    if (options.commitHash) formData.append("commit_hash", options.commitHash);
    if (options.commitMessage) formData.append("commit_message", options.commitMessage);
    if (options.commitDirty !== undefined) formData.append("commit_dirty", String(options.commitDirty));

    const deployment = await this.cloudflareRequest<{
      id?: string;
      url?: string;
      environment?: string;
    }>(fetchImplementation, `${apiBaseUrl}/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: formData,
    }, apiToken);

    return {
      status: "submitted",
      provider: "cloudflare-pages",
      projectName: options.projectName,
      requestId,
      publicationId: build.publicationId,
      fileCount: assets.length,
      uploadedFileCount: missingAssets.length,
      ...(deployment.id ? { deploymentId: deployment.id } : {}),
      ...(deployment.url ? { deploymentUrl: deployment.url } : {}),
      ...(deployment.environment ? { environment: deployment.environment } : {}),
    };
  }

  private createCloudflareAssets(build: PublicationBuildResult): CloudflareAsset[] {
    const paths = new Set<string>();
    return build.files.map((file) => {
      const path = safeRelativePath(file.path);
      if (paths.has(path)) throw new BuilderOSAdapterError(`公開ファイルが重複しています: ${path}`);
      paths.add(path);
      const size = Buffer.byteLength(file.content, "utf8");
      if (size > CLOUDFLARE_MAX_FILE_SIZE) throw new BuilderOSAdapterError(`Cloudflare Pagesの1ファイル上限を超えています: ${path}`);
      return { path, content: file.content, contentType: file.contentType, hash: hashContent(file.content, path), size };
    });
  }

  private validateCloudflareDeployOptions(options: CloudflarePagesDeployOptions, fileCount: number): void {
    if (!options.accountId.trim()) throw new BuilderOSAdapterError("Cloudflare Account IDが必要です。");
    if (!options.projectName.trim()) throw new BuilderOSAdapterError("Cloudflare Pagesプロジェクト名が必要です。");
    if (fileCount > CLOUDFLARE_MAX_FILE_COUNT) throw new BuilderOSAdapterError("Cloudflare Pagesのファイル数上限を超えています。");
    if (!options.dryRun && !options.apiToken?.trim()) throw new BuilderOSAdapterError("Cloudflare API Tokenが必要です。");
    if (options.apiBaseUrl) {
      let parsed: URL;
      try {
        parsed = new URL(options.apiBaseUrl);
      } catch {
        throw new BuilderOSAdapterError("Cloudflare APIのURLが不正です。");
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new BuilderOSAdapterError("Cloudflare APIのURLはHTTPまたはHTTPSで指定してください。");
    }
  }

  private createUploadBatches(assets: CloudflareAsset[]): CloudflareAsset[][] {
    const batches: CloudflareAsset[][] = [];
    let batch: CloudflareAsset[] = [];
    let batchSize = 0;
    for (const asset of assets) {
      if (batch.length > 0 && batchSize + asset.size > CLOUDFLARE_UPLOAD_BATCH_SIZE) {
        batches.push(batch);
        batch = [];
        batchSize = 0;
      }
      batch.push(asset);
      batchSize += asset.size;
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  }

  private async cloudflareRequest<T>(
    fetchImplementation: typeof fetch,
    url: string,
    init: RequestInit,
    secret: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImplementation(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloudflare APIへの接続に失敗しました。";
      throw new BuilderOSAdapterError(redactSecret(`Cloudflare APIへの接続に失敗しました: ${message}`, secret));
    }
    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = undefined;
      }
    }
    const apiReportedFailure = payload && typeof payload === "object" && "success" in payload && (payload as CloudflareApiResponse<unknown>).success === false;
    if (!response.ok || apiReportedFailure) {
      const detail = getCloudflareError(payload) ?? `HTTP ${response.status}`;
      throw new BuilderOSAdapterError(redactSecret(`Cloudflare APIが失敗しました: ${detail}`, secret));
    }
    return getCloudflareResult<T>(payload);
  }

  public createRequestId(): string {
    return `builderos-deploy-${randomUUID()}`;
  }
}
