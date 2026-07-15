import { healthResponseSchema } from "@kraken/contracts";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";

const defaultFrontendDirectory = join(process.cwd(), "apps", "frontend", "dist");

export function createApp(version = "0.0.0"): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health", (_request, response) => {
    response.json(healthResponseSchema.parse({ status: "ok", version }));
  });

  const frontendDirectory = process.env.KMM_FRONTEND_DIR ?? defaultFrontendDirectory;

  if (existsSync(frontendDirectory)) {
    app.use(express.static(frontendDirectory));
    app.get("/{*path}", (_request, response) => {
      response.sendFile(join(frontendDirectory, "index.html"));
    });
  }

  return app;
}
