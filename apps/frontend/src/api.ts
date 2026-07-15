import { healthResponseSchema, type HealthResponse } from "@kraken/contracts";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health");

  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}.`);
  }

  return healthResponseSchema.parse(await response.json());
}
