import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const platformSchema = z.enum(["win32", "linux", "darwin"]);
export const installationSourceSchema = z.enum(["steam", "gog", "epic", "manual"]);

export const kspInstallationSchema = z.object({
  path: z.string().min(1),
  version: z.string().min(1).optional(),
  platform: platformSchema,
  source: installationSourceSchema,
});

export type KspInstallation = z.infer<typeof kspInstallationSchema>;

export const installationsResponseSchema = z.object({
  installations: z.array(kspInstallationSchema),
});

export type InstallationsResponse = z.infer<typeof installationsResponseSchema>;

export const unconfiguredResponseSchema = z.object({
  configured: z.literal(false),
});

export const configuredResponseSchema = z.object({
  configured: z.literal(true),
  installation: kspInstallationSchema,
});

export const configResponseSchema = z.union([unconfiguredResponseSchema, configuredResponseSchema]);
export type ConfigResponse = z.infer<typeof configResponseSchema>;

export const updateConfigRequestSchema = z.object({
  installationPath: z.string().min(1).max(4_096),
});

export type UpdateConfigRequest = z.infer<typeof updateConfigRequestSchema>;

export const directoryListingResponseSchema = z.object({
  roots: z.array(z.string().min(1)),
  currentPath: z.string().min(1),
  parentPath: z.string().min(1).nullable(),
  directories: z.array(z.string().min(1)),
});

export type DirectoryListingResponse = z.infer<typeof directoryListingResponseSchema>;

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
