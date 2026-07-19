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

export const ckanInstallStanzaSchema = z.object({
  file: z.string().min(1).optional(),
  find: z.string().min(1).optional(),
  findRegexp: z.string().min(1).optional(),
  installTo: z.string().min(1).optional(),
  as: z.string().min(1).optional(),
});

export type CkanInstallStanza = z.infer<typeof ckanInstallStanzaSchema>;

export const ckanDownloadHashSchema = z.object({
  sha1: z.string().min(1).optional(),
  sha256: z.string().min(1).optional(),
});

export type CkanDownloadHash = z.infer<typeof ckanDownloadHashSchema>;

export const ckanRelationshipSchema = z.object({
  name: z.string().min(1),
  minVersion: z.string().min(1).optional(),
  maxVersion: z.string().min(1).optional(),
  unsupported: z.boolean().optional(),
});

export type CkanRelationship = z.infer<typeof ckanRelationshipSchema>;

export const ckanRelationshipsSchema = z.object({
  depends: z.array(ckanRelationshipSchema),
  conflicts: z.array(ckanRelationshipSchema),
  recommends: z.array(ckanRelationshipSchema),
  suggests: z.array(ckanRelationshipSchema),
});

export type CkanRelationships = z.infer<typeof ckanRelationshipsSchema>;

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
  downloadHash: ckanDownloadHashSchema.optional(),
  install: z.array(ckanInstallStanzaSchema).optional(),
  relationships: ckanRelationshipsSchema.optional(),
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

export const installedModStatusSchema = z.enum(["managed", "detected"]);

export const installedModSchema = z.object({
  identifier: z.string().min(1),
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  status: installedModStatusSchema,
  files: z.array(z.string().min(1)).optional(),
});

export type InstalledMod = z.infer<typeof installedModSchema>;

export const installedModsResponseSchema = z.object({
  mods: z.array(installedModSchema),
});

export type InstalledModsResponse = z.infer<typeof installedModsResponseSchema>;

export const installModRequestSchema = z.object({
  version: z.string().min(1).max(128).optional(),
  installDependencies: z.boolean().optional().default(false),
});

export type InstallModRequest = z.infer<typeof installModRequestSchema>;

export const planModRequestSchema = z.object({
  version: z.string().min(1).max(128).optional(),
});

export type PlanModRequest = z.infer<typeof planModRequestSchema>;

export const installPlanStatusSchema = z.enum(["ok", "blocked"]);

export const installPlanModuleRefSchema = z.object({
  identifier: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
});

export const installPlanSatisfiedSchema = z.object({
  identifier: z.string().min(1),
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  reason: z.enum(["managed", "detected", "planned"]),
});

export const installPlanConflictSchema = z.object({
  identifier: z.string().min(1),
  conflictingWith: z.string().min(1),
  message: z.string().min(1),
});

export const installPlanUnmetSchema = z.object({
  name: z.string().min(1),
  minVersion: z.string().min(1).optional(),
  maxVersion: z.string().min(1).optional(),
  requiredBy: z.string().min(1),
  message: z.string().min(1),
});

export const installPlanOptionalSchema = z.object({
  kind: z.enum(["recommends", "suggests"]),
  name: z.string().min(1),
  minVersion: z.string().min(1).optional(),
  maxVersion: z.string().min(1).optional(),
  requiredBy: z.string().min(1),
});

export const installPlanResponseSchema = z.object({
  status: installPlanStatusSchema,
  target: installPlanModuleRefSchema,
  toInstall: z.array(installPlanModuleRefSchema),
  alreadySatisfied: z.array(installPlanSatisfiedSchema),
  conflicts: z.array(installPlanConflictSchema),
  unmet: z.array(installPlanUnmetSchema),
  optional: z.array(installPlanOptionalSchema),
});

export type InstallPlanResponse = z.infer<typeof installPlanResponseSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const jobPhaseSchema = z.enum(["queued", "downloading", "verifying", "extracting", "installing", "done", "failed"]);

export type JobPhase = z.infer<typeof jobPhaseSchema>;

export const jobResponseSchema = z.object({
  jobId: z.string().min(1),
  kind: z.literal("install"),
  identifier: z.string().min(1),
  version: z.string().min(1).optional(),
  status: jobStatusSchema,
  phase: jobPhaseSchema,
  message: z.string().optional(),
  bytesReceived: z.number().int().nonnegative().optional(),
  bytesTotal: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export type JobResponse = z.infer<typeof jobResponseSchema>;

export const installAcceptedResponseSchema = z.object({
  job: jobResponseSchema,
});

export type InstallAcceptedResponse = z.infer<typeof installAcceptedResponseSchema>;

export const jobProgressEventSchema = z.object({
  jobId: z.string().min(1),
  phase: jobPhaseSchema,
  status: jobStatusSchema,
  message: z.string().optional(),
  bytesReceived: z.number().int().nonnegative().optional(),
  bytesTotal: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export type JobProgressEvent = z.infer<typeof jobProgressEventSchema>;
