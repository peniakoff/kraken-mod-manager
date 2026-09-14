import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(backendDirectory, "package.json"), "utf8"));
const platformName = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : process.platform;
const executableFile =
  process.env.KMM_SEA_EXECUTABLE ??
  resolve(
    backendDirectory,
    `dist/kraken-mod-manager-${platformName}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
  );

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve a smoke-test port.");
  }
  return address.port;
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function waitForHealth(url, child, getSpawnError) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError !== undefined) {
      throw new Error(`Could not start SEA: ${spawnError.message}`, { cause: spawnError });
    }
    if (child.exitCode !== null) {
      throw new Error(`SEA exited before becoming healthy with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${url}/api/v1/health`);
      if (response.ok) {
        return response;
      }
    } catch {
      // The listener may not be ready yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("SEA did not become healthy within 20 seconds.");
}

async function stopChild(child) {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolvePromise) => child.once("exit", resolvePromise));
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 5_000)),
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  }
}

async function expectResponse(url, expectedContentType, expectedText) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}.`);
  }
  if (!response.headers.get("content-type")?.startsWith(expectedContentType)) {
    throw new Error(`${url} returned an unexpected Content-Type.`);
  }
  if (expectedText !== undefined && !(await response.text()).includes(expectedText)) {
    throw new Error(`${url} did not contain the expected content.`);
  }
}

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
let output = "";
let spawnError;
const child = spawn(executableFile, [], {
  env: { ...process.env, KMM_OPEN_BROWSER: "false", KMM_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
child.once("error", (error) => {
  spawnError = error;
});

try {
  const healthResponse = await waitForHealth(baseUrl, child, () => spawnError);
  const health = await healthResponse.json();
  if (health.status !== "ok" || health.version !== packageJson.version) {
    throw new Error(`Unexpected health response: ${JSON.stringify(health)}.`);
  }

  await expectResponse(`${baseUrl}/`, "text/html", '<div id="app"></div>');
  await expectResponse(`${baseUrl}/mods`, "text/html", '<div id="app"></div>');

  const frontendDirectory = resolve(backendDirectory, "dist/frontend");
  const javascriptFile = (await collectFiles(frontendDirectory)).find((path) => path.endsWith(".js"));
  if (javascriptFile === undefined) {
    throw new Error("Frontend build contains no JavaScript asset.");
  }
  const javascriptAsset = relative(frontendDirectory, javascriptFile).split(sep).join("/");
  await expectResponse(`${baseUrl}/${javascriptAsset}`, "text/javascript");

  const missingAsset = await fetch(`${baseUrl}/assets/missing.js`);
  if (missingAsset.status !== 404) {
    throw new Error(`Missing asset returned ${missingAsset.status} instead of 404.`);
  }

  const traversalAttempt = await fetch(`${baseUrl}/%2e%2e/package.json`);
  if (traversalAttempt.status !== 404) {
    throw new Error(`Traversal attempt returned ${traversalAttempt.status} instead of 404.`);
  }

  console.info(`SEA smoke test passed for ${executableFile}.`);
} catch (error) {
  if (output !== "") {
    console.error(output);
  }
  throw error;
} finally {
  await stopChild(child);
}
