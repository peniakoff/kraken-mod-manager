import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a connected local service", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "ok", version: "test-version" }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ configured: false }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ installations: [] }), { status: 200 })),
    );

    const wrapper = mount(App);

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Service connected (test-version)");
      expect(wrapper.text()).toContain("No supported installation was found automatically.");
    });
  });

  it("shows registry controls when an installation is configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", version: "test-version" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configured: true,
            installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "missing", moduleCount: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mods: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "ready",
            moduleCount: 1,
            updatedAt: "2026-07-17T12:00:00.000Z",
            sourceUrl: "https://example.test/meta.tar.gz",
            parseErrors: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            mods: [
              {
                identifier: "ModuleManager",
                name: "Module Manager",
                authors: ["sarbian"],
                version: "4.2.3",
                tags: ["plugin"],
                abstract: "Patching plugin",
                download: "https://example.test/mm.zip",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ mods: [] }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(App);

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Active installation");
      expect(wrapper.text()).toContain("No local metadata cache yet");
      expect(wrapper.text()).toContain("Installed mods");
    });

    const refreshButton = wrapper.findAll("button").find((button) => button.text().includes("Refresh registry"));
    expect(refreshButton).toBeDefined();
    await refreshButton!.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("1 modules indexed");
      expect(wrapper.text()).toContain("Module Manager");
      expect(wrapper.text()).toContain("Install");
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/registry/refresh", expect.objectContaining({ method: "POST" }));
  });
});
