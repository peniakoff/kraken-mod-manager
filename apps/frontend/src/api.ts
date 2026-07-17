import {
  apiErrorSchema,
  configResponseSchema,
  directoryListingResponseSchema,
  healthResponseSchema,
  installAcceptedResponseSchema,
  installedModsResponseSchema,
  installationsResponseSchema,
  jobProgressEventSchema,
  jobResponseSchema,
  modsResponseSchema,
  registryResponseSchema,
  type ConfigResponse,
  type DirectoryListingResponse,
  type HealthResponse,
  type InstallAcceptedResponse,
  type InstalledModsResponse,
  type InstallationsResponse,
  type JobProgressEvent,
  type JobResponse,
  type ModsResponse,
  type RegistryResponse,
} from "@kraken/contracts";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health");

  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}.`);
  }

  return healthResponseSchema.parse(await response.json());
}

export async function getConfig(): Promise<ConfigResponse> {
  return request("/api/v1/config", configResponseSchema);
}

export async function getInstallations(): Promise<InstallationsResponse> {
  return request("/api/v1/ksp/installations", installationsResponseSchema);
}

export async function saveInstallation(installationPath: string): Promise<ConfigResponse> {
  return request("/api/v1/config", configResponseSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ installationPath }),
  });
}

export async function getDirectories(path?: string): Promise<DirectoryListingResponse> {
  const query = path === undefined ? "" : `?${new URLSearchParams({ path })}`;
  return request(`/api/v1/fs/directories${query}`, directoryListingResponseSchema);
}

export async function getRegistry(): Promise<RegistryResponse> {
  return request("/api/v1/registry", registryResponseSchema);
}

export async function refreshRegistry(): Promise<RegistryResponse> {
  return request("/api/v1/registry/refresh", registryResponseSchema, { method: "POST" });
}

export async function searchMods(options: {
  q?: string;
  tag?: string;
  compatibleWith?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ModsResponse> {
  const params = new URLSearchParams();
  if (options.q !== undefined && options.q.length > 0) {
    params.set("q", options.q);
  }
  if (options.tag !== undefined && options.tag.length > 0) {
    params.set("tag", options.tag);
  }
  if (options.compatibleWith !== undefined && options.compatibleWith.length > 0) {
    params.set("compatibleWith", options.compatibleWith);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request(`/api/v1/mods${query}`, modsResponseSchema);
}

export async function getInstalledMods(): Promise<InstalledModsResponse> {
  return request("/api/v1/installed-mods", installedModsResponseSchema);
}

export async function installMod(identifier: string, version?: string): Promise<InstallAcceptedResponse> {
  return request(`/api/v1/mods/${encodeURIComponent(identifier)}/install`, installAcceptedResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(version === undefined ? {} : { version }),
  });
}

export async function uninstallMod(identifier: string): Promise<void> {
  const response = await fetch(`/api/v1/mods/${encodeURIComponent(identifier)}`, { method: "DELETE" });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const error = apiErrorSchema.safeParse(payload);
    throw new Error(error.success ? error.data.message : `Request failed with HTTP ${response.status}.`);
  }
}

export async function getJob(jobId: string): Promise<JobResponse> {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, jobResponseSchema);
}

export function watchJobProgress(jobId: string, onEvent: (event: JobProgressEvent) => void): () => void {
  const source = new EventSource(`/api/v1/jobs/${encodeURIComponent(jobId)}/events`);
  source.onmessage = (message) => {
    const parsed = jobProgressEventSchema.safeParse(JSON.parse(message.data as string));
    if (parsed.success) {
      onEvent(parsed.data);
      if (parsed.data.status === "succeeded" || parsed.data.status === "failed") {
        source.close();
      }
    }
  };
  source.onerror = () => {
    source.close();
  };
  return () => {
    source.close();
  };
}

async function request<T>(
  path: string,
  schema: { parse(value: unknown): T },
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = apiErrorSchema.safeParse(payload);
    throw new Error(error.success ? error.data.message : `Request failed with HTTP ${response.status}.`);
  }

  return schema.parse(payload);
}
