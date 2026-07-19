/**
 * CKAN metadata parsing and in-memory indexing. I/O is injected via ports.
 */

export interface CkanInstallStanza {
  file?: string;
  find?: string;
  findRegexp?: string;
  installTo?: string;
  as?: string;
}

export interface CkanDownloadHash {
  sha1?: string;
  sha256?: string;
}

export interface CkanRelationship {
  name: string;
  minVersion?: string;
  maxVersion?: string;
}

export interface CkanRelationships {
  depends: CkanRelationship[];
  conflicts: CkanRelationship[];
  recommends: CkanRelationship[];
  suggests: CkanRelationship[];
}

export interface CkanModule {
  identifier: string;
  name: string;
  abstract?: string;
  authors: string[];
  version: string;
  kspVersion?: string;
  kspVersionMin?: string;
  kspVersionMax?: string;
  tags: string[];
  download?: string;
  downloadSize?: number;
  downloadHash?: CkanDownloadHash;
  install?: CkanInstallStanza[];
  relationships?: CkanRelationships;
}

export interface HttpPort {
  get(url: string): Promise<Uint8Array>;
}

export interface ArchiveEntry {
  path: string;
  content: string;
}

export interface ArchivePort {
  extractCkanFiles(archive: Uint8Array): Promise<ArchiveEntry[]>;
}

export interface RegistrySnapshot {
  modules: CkanModule[];
  parseErrors: number;
  sourceUrl: string;
  updatedAt: string;
}

export interface CkanSearchOptions {
  query?: string;
  tag?: string;
  compatibleWith?: string;
  latestOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface CkanSearchResult {
  total: number;
  mods: CkanModule[];
}

export function parseCkanDocument(raw: unknown): CkanModule | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const document = raw as Record<string, unknown>;
  const identifier = asNonEmptyString(document.identifier);
  const name = asNonEmptyString(document.name);
  const version = asNonEmptyString(document.version);
  if (identifier === undefined || name === undefined || version === undefined) {
    return undefined;
  }

  const module: CkanModule = {
    identifier,
    name,
    authors: normalizeAuthors(document.author),
    version,
    tags: normalizeTags(document.tags),
  };

  const abstractText = asOptionalString(document.abstract);
  if (abstractText !== undefined) {
    module.abstract = abstractText;
  }

  const kspVersion = asNonEmptyString(document.ksp_version);
  if (kspVersion !== undefined) {
    module.kspVersion = kspVersion;
  }

  const kspVersionMin = asNonEmptyString(document.ksp_version_min);
  if (kspVersionMin !== undefined) {
    module.kspVersionMin = kspVersionMin;
  }

  const kspVersionMax = asNonEmptyString(document.ksp_version_max);
  if (kspVersionMax !== undefined) {
    module.kspVersionMax = kspVersionMax;
  }

  const download = asNonEmptyString(document.download);
  if (download !== undefined) {
    module.download = download;
  }

  const downloadSize = asNonNegativeInt(document.download_size);
  if (downloadSize !== undefined) {
    module.downloadSize = downloadSize;
  }

  const downloadHash = parseDownloadHash(document.download_hash);
  if (downloadHash !== undefined) {
    module.downloadHash = downloadHash;
  }

  const install = parseInstallStanzas(document.install);
  if (install !== undefined) {
    module.install = install;
  }

  const relationships = parseRelationships(document);
  if (relationships !== undefined) {
    module.relationships = relationships;
  }

  return module;
}

export function parseCkanText(contents: string): CkanModule | undefined {
  try {
    return parseCkanDocument(JSON.parse(contents) as unknown);
  } catch {
    return undefined;
  }
}

export function buildModulesFromEntries(entries: ArchiveEntry[]): {
  modules: CkanModule[];
  parseErrors: number;
} {
  const modules: CkanModule[] = [];
  let parseErrors = 0;

  for (const entry of entries) {
    if (!entry.path.toLowerCase().endsWith(".ckan")) {
      continue;
    }
    const parsed = parseCkanText(entry.content);
    if (parsed === undefined) {
      parseErrors += 1;
      continue;
    }
    modules.push(parsed);
  }

  return { modules, parseErrors };
}

export async function refreshRegistry(
  http: HttpPort,
  archive: ArchivePort,
  sourceUrl: string,
  now: () => Date = () => new Date(),
): Promise<RegistrySnapshot> {
  const bytes = await http.get(sourceUrl);
  const entries = await archive.extractCkanFiles(bytes);
  const { modules, parseErrors } = buildModulesFromEntries(entries);
  return {
    modules,
    parseErrors,
    sourceUrl,
    updatedAt: now().toISOString(),
  };
}

export class CkanIndex {
  private readonly modules: readonly CkanModule[];

  constructor(modules: readonly CkanModule[]) {
    this.modules = [...modules];
  }

  get size(): number {
    return this.modules.length;
  }

  allModules(): readonly CkanModule[] {
    return this.modules;
  }

  findByIdentifier(identifier: string): CkanModule[] {
    return this.modules.filter((module) => module.identifier === identifier);
  }

  search(options: CkanSearchOptions = {}): CkanSearchResult {
    const latestOnly = options.latestOnly !== false;
    let candidates = latestOnly ? selectLatestPerIdentifier(this.modules) : [...this.modules];

    const query = options.query?.trim().toLowerCase();
    if (query !== undefined && query.length > 0) {
      candidates = candidates.filter((module) => matchesQuery(module, query));
    }

    const tag = options.tag?.trim().toLowerCase();
    if (tag !== undefined && tag.length > 0) {
      candidates = candidates.filter((module) => module.tags.some((value) => value.toLowerCase() === tag));
    }

    const compatibleWith = options.compatibleWith?.trim();
    if (compatibleWith !== undefined && compatibleWith.length > 0) {
      candidates = candidates.filter((module) => isCompatibleWithKsp(module, compatibleWith));
    }

    candidates.sort((left, right) => left.name.localeCompare(right.name) || left.identifier.localeCompare(right.identifier));

    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(0, options.limit ?? 50);
    return {
      total: candidates.length,
      mods: candidates.slice(offset, offset + limit),
    };
  }
}

export function compareCkanVersions(left: string, right: string): number {
  const leftParts = splitVersion(left);
  const rightParts = splitVersion(right);
  if (leftParts.epoch !== rightParts.epoch) {
    return leftParts.epoch - rightParts.epoch;
  }

  const length = Math.max(leftParts.parts.length, rightParts.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts.parts[index] ?? { numeric: 0, text: "" };
    const rightPart = rightParts.parts[index] ?? { numeric: 0, text: "" };
    if (leftPart.numeric !== rightPart.numeric) {
      return leftPart.numeric - rightPart.numeric;
    }
    const textOrder = leftPart.text.localeCompare(rightPart.text);
    if (textOrder !== 0) {
      return textOrder;
    }
  }
  return 0;
}

export function isCompatibleWithKsp(module: CkanModule, kspVersion: string): boolean {
  const target = normalizeVersionComponents(kspVersion);
  if (target === undefined) {
    return false;
  }

  if (module.kspVersion !== undefined) {
    const exact = normalizeVersionComponents(module.kspVersion);
    if (exact === undefined) {
      return false;
    }
    return versionsEqual(target, exact, Math.min(target.length, exact.length));
  }

  if (module.kspVersionMin !== undefined) {
    const min = normalizeVersionComponents(module.kspVersionMin);
    if (min === undefined || compareVersionComponents(target, min) < 0) {
      return false;
    }
  }

  if (module.kspVersionMax !== undefined) {
    const max = normalizeVersionComponents(module.kspVersionMax);
    if (max === undefined || compareVersionComponents(target, max) > 0) {
      return false;
    }
  }

  // Modules without KSP constraints are treated as compatible.
  return true;
}

function selectLatestPerIdentifier(modules: readonly CkanModule[]): CkanModule[] {
  const latest = new Map<string, CkanModule>();
  for (const module of modules) {
    const current = latest.get(module.identifier);
    if (current === undefined || compareCkanVersions(module.version, current.version) > 0) {
      latest.set(module.identifier, module);
    }
  }
  return [...latest.values()];
}

function matchesQuery(module: CkanModule, query: string): boolean {
  if (module.name.toLowerCase().includes(query) || module.identifier.toLowerCase().includes(query)) {
    return true;
  }
  if (module.authors.some((author) => author.toLowerCase().includes(query))) {
    return true;
  }
  if (module.tags.some((tag) => tag.toLowerCase().includes(query))) {
    return true;
  }
  return module.abstract?.toLowerCase().includes(query) === true;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function asNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function normalizeAuthors(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseDownloadHash(value: unknown): CkanDownloadHash | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const hash: CkanDownloadHash = {};
  const sha1 = asNonEmptyString(raw.sha1);
  if (sha1 !== undefined) {
    hash.sha1 = sha1.toLowerCase();
  }
  const sha256 = asNonEmptyString(raw.sha256);
  if (sha256 !== undefined) {
    hash.sha256 = sha256.toLowerCase();
  }
  return hash.sha1 !== undefined || hash.sha256 !== undefined ? hash : undefined;
}

function parseInstallStanzas(value: unknown): CkanInstallStanza[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const stanzas: CkanInstallStanza[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const stanza: CkanInstallStanza = {};
    const file = asNonEmptyString(raw.file);
    if (file !== undefined) {
      stanza.file = normalizeArchivePath(file);
    }
    const find = asNonEmptyString(raw.find);
    if (find !== undefined) {
      stanza.find = find;
    }
    const findRegexp = asNonEmptyString(raw.find_regexp);
    if (findRegexp !== undefined) {
      stanza.findRegexp = findRegexp;
    }
    const installTo = asNonEmptyString(raw.install_to);
    if (installTo !== undefined) {
      stanza.installTo = normalizeArchivePath(installTo);
    }
    const asName = asNonEmptyString(raw.as);
    if (asName !== undefined) {
      stanza.as = asName;
    }
    if (
      stanza.file !== undefined ||
      stanza.find !== undefined ||
      stanza.findRegexp !== undefined ||
      stanza.installTo !== undefined ||
      stanza.as !== undefined
    ) {
      stanzas.push(stanza);
    }
  }
  return stanzas.length > 0 ? stanzas : undefined;
}

function parseRelationships(document: Record<string, unknown>): CkanRelationships | undefined {
  const hasDepends = Object.hasOwn(document, "depends");
  const hasConflicts = Object.hasOwn(document, "conflicts");
  const hasRecommends = Object.hasOwn(document, "recommends");
  const hasSuggests = Object.hasOwn(document, "suggests");
  if (!hasDepends && !hasConflicts && !hasRecommends && !hasSuggests) {
    return undefined;
  }
  return {
    depends: parseRelationshipList(document.depends),
    conflicts: parseRelationshipList(document.conflicts),
    recommends: parseRelationshipList(document.recommends),
    suggests: parseRelationshipList(document.suggests),
  };
}

function parseRelationshipList(value: unknown): CkanRelationship[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const relationships: CkanRelationship[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const name = asNonEmptyString(entry);
      if (name !== undefined) {
        relationships.push({ name });
      }
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const name = asNonEmptyString(raw.name);
    if (name === undefined) {
      continue;
    }
    const relationship: CkanRelationship = { name };
    const minVersion = asNonEmptyString(raw.min_version);
    if (minVersion !== undefined) {
      relationship.minVersion = minVersion;
    }
    const maxVersion = asNonEmptyString(raw.max_version);
    if (maxVersion !== undefined) {
      relationship.maxVersion = maxVersion;
    }
    relationships.push(relationship);
  }
  return relationships;
}

function normalizeArchivePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function splitVersion(version: string): { epoch: number; parts: Array<{ numeric: number; text: string }> } {
  const trimmed = version.trim().replace(/^v/i, "");
  const epochMatch = /^(\d+):(.*)$/.exec(trimmed);
  const epoch = epochMatch === null ? 0 : Number(epochMatch[1]);
  const remainder = epochMatch === null ? trimmed : epochMatch[2]!;
  const parts = remainder.split(/[.+_-]/).filter((part) => part.length > 0).map((part) => {
    // Linear scan avoids `/^(\d*)(.*)$/` (CodeQL js/polynomial-redos).
    const digitEnd = countLeadingDigits(part);
    return {
      numeric: digitEnd > 0 ? Number(part.slice(0, digitEnd)) : 0,
      text: part.slice(digitEnd),
    };
  });
  return { epoch, parts };
}

function countLeadingDigits(value: string): number {
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      break;
    }
    index += 1;
  }
  return index;
}

function normalizeVersionComponents(version: string): number[] | undefined {
  const trimmed = version.trim().replace(/^v/i, "");
  if (trimmed.length === 0) {
    return undefined;
  }
  const parts = trimmed.split(".").map((part) => {
    const match = /^(\d+)/.exec(part);
    return match === null ? Number.NaN : Number(match[1]);
  });
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  return parts;
}

function compareVersionComponents(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

function versionsEqual(left: number[], right: number[], significant: number): boolean {
  for (let index = 0; index < significant; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) {
      return false;
    }
  }
  return true;
}
