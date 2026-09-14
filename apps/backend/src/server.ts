import { createApp, createDefaultDependencies } from "./app.js";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { createSeaFrontendAssets } from "./frontend-assets.js";

const defaultPort = 31415;
const host = "127.0.0.1";

function getPort(rawPort: string | undefined): number {
  const port = Number(rawPort ?? defaultPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("KMM_PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function openBrowser(url: string): void {
  const [command, ...arguments_] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const browser = spawn(command, arguments_, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  browser.once("error", (error) => {
    console.warn(`Could not open the default browser: ${error.message}`);
  });
  browser.unref();
}

async function start(): Promise<void> {
  const port = getPort(process.env.KMM_PORT);
  const frontendAssets = process.env.KMM_FRONTEND_DIR === undefined ? createSeaFrontendAssets() : undefined;
  const frontendDirectory =
    frontendAssets === undefined
      ? (process.env.KMM_FRONTEND_DIR ?? join(dirname(resolve(process.argv[1] ?? process.cwd())), "frontend"))
      : undefined;
  const dependencies = createDefaultDependencies(frontendDirectory);
  if (frontendAssets !== undefined) {
    dependencies.frontendAssets = frontendAssets;
  }
  const server = createServer(
    createApp(
      process.env.KMM_VERSION ?? process.env.KMM_BUILD_VERSION ?? process.env.npm_package_version,
      dependencies,
    ),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}`;
  console.info(`Kraken Mod Manager is available at ${url}`);

  if (process.env.KMM_OPEN_BROWSER !== "false") {
    openBrowser(url);
  }
}

start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
