import { execFileSync } from "node:child_process";
import { chmod, copyFile, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postject from "postject";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distributionDirectory = resolve(backendDirectory, "dist");
const frontendDirectory = resolve(distributionDirectory, "frontend");
const entryFile = resolve(distributionDirectory, "server.cjs");
const blobFile = resolve(distributionDirectory, "sea-prep.blob");
const configFile = resolve(distributionDirectory, "sea-config.json");
const platformName = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : process.platform;
const executableFile = resolve(
  distributionDirectory,
  `kraken-mod-manager-${platformName}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
);

async function collectAssets(directory) {
  const assets = {};
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(assets, await collectAssets(path));
    } else if (entry.isFile()) {
      assets[relative(frontendDirectory, path).split(sep).join("/")] = path;
    }
  }

  return assets;
}

const entryStatus = await stat(entryFile).catch((error) => {
  throw new Error("Backend bundle not found. Run `pnpm build` before packaging the SEA.", { cause: error });
});
if (!entryStatus.isFile()) {
  throw new Error("Backend bundle is not a file. Run `pnpm build` before packaging the SEA.");
}

const assets = await collectAssets(frontendDirectory).catch((error) => {
  throw new Error("Frontend build not found. Run `pnpm build` before packaging the SEA.", { cause: error });
});

if (!("index.html" in assets)) {
  throw new Error("Frontend build is incomplete: index.html is missing.");
}

await rm(blobFile, { force: true });
await rm(executableFile, { force: true });
await writeFile(
  configFile,
  `${JSON.stringify(
    {
      main: entryFile,
      output: blobFile,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    undefined,
    2,
  )}\n`,
);

execFileSync(process.execPath, ["--experimental-sea-config", configFile], { stdio: "inherit" });
await copyFile(process.execPath, executableFile);

if (process.platform === "darwin") {
  execFileSync("codesign", ["--remove-signature", executableFile], { stdio: "inherit" });
}

console.info(`Injecting SEA blob into ${executableFile}...`);
await postject.inject(executableFile, "NODE_SEA_BLOB", await readFile(blobFile), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});

if (process.platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", executableFile], { stdio: "inherit" });
} else if (process.platform !== "win32") {
  await chmod(executableFile, 0o755);
}

console.info(`Created ${executableFile} with ${Object.keys(assets).length} embedded frontend assets.`);
