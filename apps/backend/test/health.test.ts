import { createApp } from "../src/app.js";
import { healthResponseSchema } from "@kraken/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/health", () => {
  it("returns the shared health response contract", async () => {
    const response = await request(createApp("test-version")).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(response.body)).toEqual({
      status: "ok",
      version: "test-version",
    });
  });
});
