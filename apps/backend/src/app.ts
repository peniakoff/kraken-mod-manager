import {
  apiErrorSchema,
  configResponseSchema,
  directoryListingResponseSchema,
  healthResponseSchema,
  installAcceptedResponseSchema,
  installModRequestSchema,
  installedModsResponseSchema,
  installationsResponseSchema,
  jobProgressEventSchema,
  jobResponseSchema,
  modsQuerySchema,
  modsResponseSchema,
  registryResponseSchema,
  updateConfigRequestSchema,
} from "@kraken/contracts";
import {
  discoverInstallations,
  type FileSystemPort,
  type PlatformPort,
  validateKspInstallation,
} from "@kraken/core";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ConfigStore, ConfigStoreError } from "./adapters/config-store.js";
import { InstallManifestStore, InstallManifestError } from "./adapters/install-manifest-store.js";
import { NodeFileSystem } from "./adapters/node-file-system.js";
import { NodeHttp } from "./adapters/node-http.js";
import { RegistryCacheStore, RegistryCacheError } from "./adapters/registry-cache-store.js";
import { StreamingHttp } from "./adapters/streaming-http.js";
import { TarGzArchive } from "./adapters/tar-gz-archive.js";
import { ZipArchive } from "./adapters/zip-archive.js";
import { DirectoryBrowser, DirectoryBrowserError } from "./directory-browser.js";
import {
  InstallService,
  InstallServiceError,
  StreamingHttpError,
  ZipArchiveError,
  InstallPolicyError,
} from "./install-service.js";
import { JobStore } from "./job-store.js";
import {
  getBrowseRoots,
  getConfigFilePath,
  getDownloadCacheDirectory,
  getInstallManifestFilePath,
  getPlatformPort,
  getRegistryCacheFilePath,
} from "./platform.js";
import { RegistryService, RegistryServiceError } from "./registry-service.js";

export interface AppDependencies {
  fileSystem: FileSystemPort;
  platform: PlatformPort;
  configStore: ConfigStore;
  directoryBrowser: DirectoryBrowser;
  registryService: RegistryService;
  installService: InstallService;
  frontendDirectory?: string;
}

export function createDefaultDependencies(frontendDirectory = process.env.KMM_FRONTEND_DIR): AppDependencies {
  const platform = getPlatformPort();
  const registryService = new RegistryService(
    new NodeHttp(),
    new TarGzArchive(),
    new RegistryCacheStore(getRegistryCacheFilePath(platform)),
  );
  const dependencies: AppDependencies = {
    fileSystem: new NodeFileSystem(),
    platform,
    configStore: new ConfigStore(getConfigFilePath(platform)),
    directoryBrowser: new DirectoryBrowser(getBrowseRoots(platform)),
    registryService,
    installService: new InstallService(
      new NodeFileSystem(),
      registryService,
      new StreamingHttp(),
      new ZipArchive(),
      new InstallManifestStore(getInstallManifestFilePath(platform)),
      new JobStore(),
      getDownloadCacheDirectory(platform),
    ),
  };
  if (frontendDirectory !== undefined) {
    dependencies.frontendDirectory = frontendDirectory;
  }
  return dependencies;
}

export function createApp(version = "0.0.0", dependencies = createDefaultDependencies()): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", version }));
  });

  app.get("/api/v1/ksp/installations", async (_request, response, next) => {
    try {
      response.json(
        installationsResponseSchema.parse({
          installations: await discoverInstallations(dependencies.fileSystem, dependencies.platform),
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/config", async (_request, response, next) => {
    try {
      const config = await dependencies.configStore.read();
      if (config === undefined) {
        response.json(configResponseSchema.parse({ configured: false }));
        return;
      }

      const installation = await validateKspInstallation(
        dependencies.fileSystem,
        dependencies.platform.platform,
        config.activeInstallationPath,
        "manual",
      );
      if (installation === undefined) {
        response.json(configResponseSchema.parse({ configured: false }));
        return;
      }
      response.json(configResponseSchema.parse({ configured: true, installation }));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/v1/config", async (request, response, next) => {
    const parsed = updateConfigRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_REQUEST", "A valid installationPath is required.");
      return;
    }

    try {
      const installation = await validateKspInstallation(
        dependencies.fileSystem,
        dependencies.platform.platform,
        parsed.data.installationPath,
        "manual",
      );
      if (installation === undefined) {
        sendError(response, 422, "INVALID_INSTALLATION", "The selected directory is not a valid KSP installation.");
        return;
      }
      await dependencies.configStore.write({
        schemaVersion: 1,
        activeInstallationPath: installation.path,
        preferences: {},
      });
      response.json(configResponseSchema.parse({ configured: true, installation }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/fs/directories", async (request, response, next) => {
    const rawPath = request.query.path;
    if (typeof rawPath !== "string" && rawPath !== undefined) {
      sendError(response, 400, "INVALID_REQUEST", "Only one path query parameter is allowed.");
      return;
    }
    try {
      response.json(directoryListingResponseSchema.parse(await dependencies.directoryBrowser.list(rawPath)));
    } catch (error) {
      if (error instanceof DirectoryBrowserError) {
        sendError(response, error.code === "OUTSIDE_ALLOWED_ROOT" ? 403 : 400, error.code, error.message);
        return;
      }
      next(error);
    }
  });

  app.get("/api/v1/registry", async (_request, response, next) => {
    try {
      await dependencies.registryService.ensureLoaded();
      response.json(registryResponseSchema.parse(dependencies.registryService.getStatus()));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/registry/refresh", async (_request, response, next) => {
    try {
      await dependencies.registryService.ensureLoaded();
      response.json(registryResponseSchema.parse(await dependencies.registryService.refresh()));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/mods", async (request, response, next) => {
    const parsed = modsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendError(response, 400, "INVALID_REQUEST", "Invalid mods query parameters.");
      return;
    }

    try {
      await dependencies.registryService.ensureLoaded();
      const searchOptions: {
        query?: string;
        tag?: string;
        compatibleWith?: string;
        limit: number;
        offset: number;
        latestOnly: true;
      } = {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        latestOnly: true,
      };
      if (parsed.data.q !== undefined) {
        searchOptions.query = parsed.data.q;
      }
      if (parsed.data.tag !== undefined) {
        searchOptions.tag = parsed.data.tag;
      }
      if (parsed.data.compatibleWith !== undefined) {
        searchOptions.compatibleWith = parsed.data.compatibleWith;
      }
      const result = dependencies.registryService.search(searchOptions);
      response.json(modsResponseSchema.parse(result));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/installed-mods", async (_request, response, next) => {
    try {
      const kspPath = await requireConfiguredInstallation(dependencies);
      if (kspPath === undefined) {
        sendError(response, 409, "NOT_CONFIGURED", "Configure a KSP installation before managing mods.");
        return;
      }
      response.json(installedModsResponseSchema.parse({ mods: await dependencies.installService.listInstalled(kspPath) }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/mods/:identifier/install", async (request, response, next) => {
    const body = installModRequestSchema.safeParse(request.body ?? {});
    if (!body.success) {
      sendError(response, 400, "INVALID_REQUEST", "Invalid install request.");
      return;
    }
    const identifier = request.params.identifier;
    if (typeof identifier !== "string" || identifier.trim().length === 0) {
      sendError(response, 400, "INVALID_REQUEST", "A mod identifier is required.");
      return;
    }

    try {
      const kspPath = await requireConfiguredInstallation(dependencies);
      if (kspPath === undefined) {
        sendError(response, 409, "NOT_CONFIGURED", "Configure a KSP installation before managing mods.");
        return;
      }
      await dependencies.registryService.ensureLoaded();
      const job = dependencies.installService.startInstall(kspPath, identifier, body.data.version);
      response.status(202).json(installAcceptedResponseSchema.parse({ job }));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/v1/mods/:identifier", async (request, response, next) => {
    const identifier = request.params.identifier;
    if (typeof identifier !== "string" || identifier.trim().length === 0) {
      sendError(response, 400, "INVALID_REQUEST", "A mod identifier is required.");
      return;
    }

    try {
      const kspPath = await requireConfiguredInstallation(dependencies);
      if (kspPath === undefined) {
        sendError(response, 409, "NOT_CONFIGURED", "Configure a KSP installation before managing mods.");
        return;
      }
      await dependencies.installService.uninstall(kspPath, identifier);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/jobs/:jobId", (request, response, next) => {
    try {
      response.json(jobResponseSchema.parse(dependencies.installService.getJob(request.params.jobId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/jobs/:jobId/events", (request, response, next) => {
    try {
      const job = dependencies.installService.getJob(request.params.jobId);
      response.setHeader("Content-Type", "text/event-stream");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders?.();

      const writeEvent = (event: unknown): void => {
        response.write(`data: ${JSON.stringify(jobProgressEventSchema.parse(event))}\n\n`);
      };

      const unsubscribe = dependencies.installService.subscribe(job.jobId, (event) => {
        writeEvent(event);
        if (event.status === "succeeded" || event.status === "failed") {
          unsubscribe();
          response.end();
        }
      });

      const latest = dependencies.installService.getJob(job.jobId);
      writeEvent({
        jobId: latest.jobId,
        phase: latest.phase,
        status: latest.status,
        ...(latest.message !== undefined ? { message: latest.message } : {}),
        ...(latest.bytesReceived !== undefined ? { bytesReceived: latest.bytesReceived } : {}),
        ...(latest.bytesTotal !== undefined ? { bytesTotal: latest.bytesTotal } : {}),
        ...(latest.error !== undefined ? { error: latest.error } : {}),
      });
      if (latest.status === "succeeded" || latest.status === "failed") {
        unsubscribe();
        response.end();
        return;
      }

      request.on("close", () => {
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  });

  const frontendDirectory = dependencies.frontendDirectory;
  if (frontendDirectory !== undefined && existsSync(frontendDirectory)) {
    app.use(express.static(frontendDirectory));
    // Express 5 requires a named wildcard (`/{*path}`); bare `*` / `/*` throw.
    // Skip dotted paths so missing `.js`/`.css` assets stay 404 instead of
    // returning `index.html` (Accept: */* still matches `accepts("html")`).
    app.get("/{*path}", (request, response, next) => {
      if (request.path.includes(".") || !request.accepts("html")) {
        next();
        return;
      }

      response.sendFile(join(frontendDirectory, "index.html"));
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ConfigStoreError) {
      sendError(response, 500, "CONFIGURATION_ERROR", error.message);
      return;
    }
    if (error instanceof RegistryCacheError) {
      sendError(response, 500, "REGISTRY_CACHE_ERROR", error.message);
      return;
    }
    if (error instanceof RegistryServiceError) {
      sendError(response, error.code === "REGISTRY_REFRESH_FAILED" ? 503 : 500, error.code, error.message);
      return;
    }
    if (error instanceof InstallManifestError) {
      sendError(response, 500, "INSTALL_MANIFEST_ERROR", error.message);
      return;
    }
    if (error instanceof InstallServiceError) {
      const status =
        error.code === "NOT_CONFIGURED"
          ? 409
          : error.code === "MOD_NOT_FOUND" || error.code === "JOB_NOT_FOUND"
            ? 404
            : error.code === "NOT_MANAGED" || error.code === "NO_DOWNLOAD"
              ? 422
              : 500;
      sendError(response, status, error.code, error.message);
      return;
    }
    if (error instanceof StreamingHttpError || error instanceof ZipArchiveError || error instanceof InstallPolicyError) {
      sendError(response, 422, error instanceof InstallPolicyError ? error.code : error.name, error.message);
      return;
    }
    sendError(response, 500, "INTERNAL_ERROR", "The local service could not complete the request.");
  });

  return app;
}

async function requireConfiguredInstallation(dependencies: AppDependencies): Promise<string | undefined> {
  const config = await dependencies.configStore.read();
  if (config === undefined) {
    return undefined;
  }
  const installation = await validateKspInstallation(
    dependencies.fileSystem,
    dependencies.platform.platform,
    config.activeInstallationPath,
    "manual",
  );
  return installation?.path;
}

function sendError(response: express.Response, status: number, code: string, message: string): void {
  response.status(status).json(apiErrorSchema.parse({ code, message }));
}
