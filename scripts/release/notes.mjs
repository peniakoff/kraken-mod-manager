// Prints the CHANGELOG.md section for a release tag, failing loudly when the
// section is missing or empty so a release never ships without notes.
import { readFile } from "node:fs/promises";

const tag = process.argv[2];
if (tag === undefined || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Expected a tag like v1.2.3, got ${JSON.stringify(tag)}.`);
}
const version = tag.slice(1);
const lines = (await readFile("CHANGELOG.md", "utf8")).split(/\r?\n/);

const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  throw new Error(`CHANGELOG.md has no "## [${version}]" section.`);
}
const next = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
const section = lines.slice(start + 1, next === -1 ? undefined : next).join("\n").trim();
if (section.length === 0) {
  throw new Error(`CHANGELOG.md section for ${version} is empty.`);
}
process.stdout.write(`${section}\n`);
