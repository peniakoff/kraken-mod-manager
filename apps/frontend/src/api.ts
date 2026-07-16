import {
  apiErrorSchema,
  configResponseSchema,
  directoryListingResponseSchema,
  healthResponseSchema,
  installationsResponseSchema,
  type ConfigResponse,
  type DirectoryListingResponse,
  type HealthResponse,
  type InstallationsResponse,
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
