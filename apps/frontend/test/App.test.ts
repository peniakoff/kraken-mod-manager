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

  it("shows the dashboard when an installation is configured", async () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ updates: [] }), { status: 200 }))
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ mods: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ updates: [] }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(App);

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Dashboard");
      expect(wrapper.text()).toContain("Kraken Mod Manager");
      expect(wrapper.text()).toContain("Active installation");
      expect(wrapper.text()).toContain("/games/KSP");
      expect(wrapper.text()).toContain("Installed mods");
      expect(wrapper.text()).toContain("0");
      expect(wrapper.text()).toContain("All managed mods are up to date.");
      expect(wrapper.text()).toContain("No local metadata cache yet");
    });

    const refreshButton = wrapper.findAll("button").find((button) => button.text().includes("Refresh registry"));
    expect(refreshButton).toBeDefined();
    await refreshButton!.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("1 modules indexed");
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/registry/refresh", expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/v1/updates")).toBe(true);

    const browseButton = wrapper.findAll("button").find((button) => button.text() === "Browse mods");
    expect(browseButton).toBeDefined();
    await browseButton!.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Browse mods");
      expect(wrapper.text()).toContain("Module Manager");
      expect(wrapper.text()).toContain("Install");
    });
  });

  it("lists available updates on the dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", version: "test-version" }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              configured: true,
              installation: { path: "/games/KSP", platform: "linux", source: "steam", version: "1.12.5" },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "ready",
              moduleCount: 2,
              updatedAt: "2026-07-17T12:00:00.000Z",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              mods: [{ identifier: "MechJeb2", name: "MechJeb 2", version: "2.14.0", status: "managed" }],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              updates: [
                {
                  identifier: "MechJeb2",
                  name: "MechJeb 2",
                  installedVersion: "2.14.0",
                  availableVersion: "2.15.0",
                },
              ],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ total: 0, mods: [] }), { status: 200 }),
        ),
    );

    const wrapper = mount(App);

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("1 update available");
      expect(wrapper.text()).toContain("MechJeb 2");
      expect(wrapper.text()).toContain("2.14.0");
      expect(wrapper.text()).toContain("2.15.0");
      expect(wrapper.text()).toContain("Installed mods");
      expect(wrapper.text()).toMatch(/Installed mods\s*1/);
    });
  });

  it("sends tag filter and pagination offsets to the mods endpoint", async () => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const installation = { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" };
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/v1/health") {
        return json({ status: "ok", version: "test-version" });
      }
      if (url === "/api/v1/config") {
        return json({ configured: true, installation });
      }
      if (url === "/api/v1/registry") {
        return json({ status: "ready", moduleCount: 30 });
      }
      if (url === "/api/v1/installed-mods") {
        return json({ mods: [] });
      }
      if (url === "/api/v1/updates") {
        return json({ updates: [] });
      }
      if (url.startsWith("/api/v1/mods")) {
        return json({ total: 30, mods: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(App);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Active installation");
    });

    const browseButton = wrapper.findAll("button").find((button) => button.text() === "Browse mods");
    await browseButton!.trigger("click");
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Category:");
    });

    const modsCalls = () =>
      fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith("/api/v1/mods"));
    await vi.waitFor(() => {
      expect(modsCalls().length).toBeGreaterThan(0);
    });
    const initialUrl = new URL(modsCalls()[0]!, "http://localhost");
    expect(initialUrl.searchParams.get("limit")).toBe("25");
    expect(initialUrl.searchParams.get("offset")).toBe("0");
    expect(initialUrl.searchParams.get("compatibleWith")).toBe("1.12.5");

    await wrapper.find("#mod-tag").setValue("parts");
    await vi.waitFor(() => {
      expect(modsCalls().some((url) => new URL(url, "http://localhost").searchParams.get("tag") === "parts")).toBe(
        true,
      );
    });

    const nextButton = wrapper.findAll("button").find((button) => button.text() === "Next");
    expect(nextButton).toBeDefined();
    await nextButton!.trigger("click");
    await vi.waitFor(() => {
      expect(
        modsCalls().some((url) => {
          const params = new URL(url, "http://localhost").searchParams;
          return params.get("offset") === "25" && params.get("tag") === "parts";
        }),
      ).toBe(true);
    });
  });

  it("omits the compatibility filter when compatible-only is disabled", async () => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const installation = { path: "/games/KSP", platform: "linux", source: "steam", version: "1.12.5" };
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/v1/health") {
        return json({ status: "ok", version: "test-version" });
      }
      if (url === "/api/v1/config") {
        return json({ configured: true, installation });
      }
      if (url === "/api/v1/registry") {
        return json({ status: "ready", moduleCount: 2 });
      }
      if (url === "/api/v1/installed-mods") {
        return json({ mods: [] });
      }
      if (url === "/api/v1/updates") {
        return json({ updates: [] });
      }
      if (url.startsWith("/api/v1/mods")) {
        return json({ total: 0, mods: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(App);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Active installation");
    });

    const browseButton = wrapper.findAll("button").find((button) => button.text() === "Browse mods");
    await browseButton!.trigger("click");
    await vi.waitFor(() => {
      expect(wrapper.find("#compatible-only").exists()).toBe(true);
    });

    await wrapper.find("#compatible-only").setValue(false);
    await vi.waitFor(() => {
      const modsCalls = fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.startsWith("/api/v1/mods"));
      expect(modsCalls.length).toBeGreaterThan(1);
      const latest = new URL(modsCalls[modsCalls.length - 1]!, "http://localhost");
      expect(latest.searchParams.has("compatibleWith")).toBe(false);
    });
  });
});
