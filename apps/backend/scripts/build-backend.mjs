import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(backendDirectory, "package.json"), "utf8"));

await build({
  entryPoints: [resolve(backendDirectory, "src/server.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: resolve(backendDirectory, "dist/server.cjs"),
  external: ["node:sea"],
  define: {
    "process.env.KMM_BUILD_VERSION": JSON.stringify(packageJson.version),
  },
});
