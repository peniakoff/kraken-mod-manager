import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(backendDirectory, "../frontend/dist");
const destination = resolve(backendDirectory, "dist/frontend");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
