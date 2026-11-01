// Fails unless the release tag is v<version> and every workspace package
// carries that same version, so a binary never reports the wrong version.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const tag = process.argv[2];
if (tag === undefined || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Expected a tag like v1.2.3, got ${JSON.stringify(tag)}.`);
}
const expected = tag.slice(1);

const manifests = ["package.json"];
for (const group of ["apps", "packages"]) {
  for (const entry of await readdir(group, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      manifests.push(join(group, entry.name, "package.json"));
    }
  }
}

const mismatches = [];
for (const manifest of manifests) {
  const { version } = JSON.parse(await readFile(manifest, "utf8"));
  if (version !== expected) {
    mismatches.push(`${manifest} has ${version}`);
  }
}
if (mismatches.length > 0) {
  throw new Error(`Tag ${tag} does not match: ${mismatches.join(", ")}.`);
}
console.info(`All ${manifests.length} package versions match ${tag}.`);
