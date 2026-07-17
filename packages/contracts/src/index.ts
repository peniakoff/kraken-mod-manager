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

export const registryStatusSchema = z.enum(["missing", "ready"]);

export const registryResponseSchema = z.object({
  status: registryStatusSchema,
  moduleCount: z.number().int().nonnegative(),
  updatedAt: z.string().min(1).optional(),
  sourceUrl: z.string().min(1).optional(),
  parseErrors: z.number().int().nonnegative().optional(),
});

export type RegistryResponse = z.infer<typeof registryResponseSchema>;

export const ckanModuleSchema = z.object({
  identifier: z.string().min(1),
  name: z.string().min(1),
  abstract: z.string().optional(),
  authors: z.array(z.string().min(1)),
  version: z.string().min(1),
  kspVersion: z.string().min(1).optional(),
  kspVersionMin: z.string().min(1).optional(),
  kspVersionMax: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)),
  download: z.string().min(1).optional(),
  downloadSize: z.number().int().nonnegative().optional(),
});

export type CkanModule = z.infer<typeof ckanModuleSchema>;

export const modsQuerySchema = z.object({
  q: z.string().max(256).optional(),
  tag: z.string().max(128).optional(),
  compatibleWith: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ModsQuery = z.infer<typeof modsQuerySchema>;

export const modsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  mods: z.array(ckanModuleSchema),
});

export type ModsResponse = z.infer<typeof modsResponseSchema>;
