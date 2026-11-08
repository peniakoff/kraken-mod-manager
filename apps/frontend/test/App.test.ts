import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  close(): void {
    this.closed = true;
  }
}

describe("App", () => {
  afterEach(() => {
    MockEventSource.instances = [];
    vi.unstubAllGlobals();
  });

  it("keeps an install visible through navigation and handles its terminal SSE event", async () => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const mod = {
      identifier: "ModuleManager",
      name: "Module Manager",
      authors: ["sarbian"],
      version: "4.2.3",
      tags: ["plugin"],
      download: "https://example.test/mm.zip",
    };
    let installedLoads = 0;
    let updateLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "ready", moduleCount: 1 });
      if (url === "/api/v1/installed-mods") {
        installedLoads += 1;
        return json({
          mods: installedLoads > 1
            ? [{ identifier: mod.identifier, name: mod.name, version: mod.version, status: "managed" }]
            : [],
        });
      }
      if (url === "/api/v1/updates") {
        updateLoads += 1;
        return json({ updates: [] });
      }
      if (url === "/api/v1/mods/ModuleManager/plan") {
        return json({
          status: "ok",
          target: { identifier: mod.identifier, name: mod.name, version: mod.version },
          toInstall: [{ identifier: mod.identifier, name: mod.name, version: mod.version }],
          alreadySatisfied: [],
          conflicts: [],
          unmet: [],
          optional: [],
        });
      }
      if (url === "/api/v1/mods/ModuleManager/install" && init?.method === "POST") {
        return json({
          job: {
            jobId: "job-1",
            kind: "install",
            identifier: mod.identifier,
            version: mod.version,
            status: "queued",
            phase: "queued",
            message: "Install queued.",
          },
        }, 202);
      }
      if (url.startsWith("/api/v1/mods")) return json({ total: 1, mods: [mod] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);

    const wrapper = mount(App);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));

    await wrapper.findAll("button").find((button) => button.text() === "Browse mods")!.trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("Module Manager"));
    await wrapper.findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
      expect(wrapper.find('[data-testid="install-queue"]').exists()).toBe(true);
    });
    expect(MockEventSource.instances[0]?.url).toBe("/api/v1/jobs/job-1/events");

    await wrapper.findAll("button").find((button) => button.text() === "Overview")!.trigger("click");
    expect(wrapper.text()).toContain("Active installation");
    expect(wrapper.find('[data-job-id="job-1"]').exists()).toBe(true);

    MockEventSource.instances[0]!.emit({
      jobId: "job-1",
      status: "succeeded",
      phase: "done",
      message: "Install complete.",
      bytesReceived: 200,
      bytesTotal: 200,
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-job-id="job-1"]').text()).toContain("Installed");
      expect(installedLoads).toBe(2);
      expect(updateLoads).toBe(2);
    });
    expect(MockEventSource.instances[0]?.closed).toBe(true);

    await wrapper.find('button[aria-label="Dismiss ModuleManager install"]').trigger("click");
    expect(wrapper.find('[data-testid="install-queue"]').exists()).toBe(false);
  });

  it("re-plans with choices and installs with them", async () => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const mod = {
      identifier: "RealSolarSystem",
      name: "Real Solar System",
      authors: ["NathanKell"],
      version: "1.0.0",
      tags: ["planet-pack"],
      download: "https://example.test/rss.zip",
    };
    const target = { identifier: mod.identifier, name: mod.name, version: mod.version };
    const chosen = { identifier: "RSSTextures8192", name: "RSS Textures 8192", version: "1.0.0" };
    const basePlan = { target, alreadySatisfied: [], conflicts: [], unmet: [], optional: [] };
    const planBodies: unknown[] = [];
    let installBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "ready", moduleCount: 3 });
      if (url === "/api/v1/installed-mods") return json({ mods: [] });
      if (url === "/api/v1/updates") return json({ updates: [] });
      if (url === "/api/v1/mods/RealSolarSystem/plan") {
        const body: unknown = JSON.parse(String(init?.body));
        planBodies.push(body);
        if (planBodies.length === 1) {
          return json({
            ...basePlan,
            status: "choice-required",
            toInstall: [target],
            choices: [
              {
                key: "RSSTextures",
                label: "RSSTextures",
                requiredBy: ["RealSolarSystem"],
                candidates: [
                  { identifier: "RSSTextures4096", name: "RSS Textures 4096", version: "1.0.0", via: "provides" },
                  { ...chosen, via: "provides" },
                ],
              },
            ],
          });
        }
        return json({ ...basePlan, status: "ok", toInstall: [chosen, target], choices: [] });
      }
      if (url === "/api/v1/mods/RealSolarSystem/install" && init?.method === "POST") {
        installBody = JSON.parse(String(init.body));
        return json({
          job: {
            jobId: "job-rss",
            kind: "install",
            identifier: mod.identifier,
            version: mod.version,
            status: "queued",
            phase: "queued",
          },
        }, 202);
      }
      if (url.startsWith("/api/v1/mods")) return json({ total: 1, mods: [mod] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);

    const wrapper = mount(App);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));
    await wrapper.findAll("button").find((button) => button.text() === "Browse mods")!.trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("Real Solar System"));
    await wrapper.findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => expect(wrapper.find('input[value="RSSTextures8192"]').exists()).toBe(true));
    await wrapper.find('input[value="RSSTextures8192"]').setValue(true);
    await wrapper.findAll("button").find((button) => button.text() === "Continue")!.trigger("click");

    await vi.waitFor(() => expect(wrapper.text()).toContain("Install required dependencies?"));
    await wrapper.findAll("button").find((button) => button.text() === "Install automatically")!.trigger("click");

    await vi.waitFor(() => expect(installBody).toBeDefined());
    expect(planBodies[1]).toEqual({ version: "1.0.0", choices: { RSSTextures: "RSSTextures8192" } });
    expect(installBody).toEqual({
      version: "1.0.0",
      installDependencies: true,
      choices: { RSSTextures: "RSSTextures8192" },
    });
  });

  it("previews and confirms an uninstall with dependents", async () => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const managed = [
      { identifier: "DependentMod", name: "Dependent Mod", version: "1.0.0", status: "managed" },
      { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3", status: "managed" },
    ];
    let installed = managed;
    let installedLoads = 0;
    let planLoads = 0;
    const uninstallBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "ready", moduleCount: 2 });
      if (url === "/api/v1/installed-mods") {
        installedLoads += 1;
        return json({ mods: installed });
      }
      if (url === "/api/v1/updates") return json({ updates: [] });
      if (url === "/api/v1/mods/ModuleManager/uninstall-plan" && init?.method === "POST") {
        planLoads += 1;
        return json({
          target: { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" },
          dependents: [{ identifier: "DependentMod", name: "Dependent Mod", version: "1.0.0" }],
          orphans: [],
          brokenUnmanaged: [],
          warnings: [],
        });
      }
      if (url === "/api/v1/mods/ModuleManager/uninstall" && init?.method === "POST") {
        uninstallBodies.push(JSON.parse(String(init.body)));
        if (uninstallBodies.length === 1) {
          return json({ code: "UNINSTALL_PLAN_MISMATCH", message: "Another mod changed. Review the plan again." }, 409);
        }
        installed = [];
        return json(
          {
            job: {
              jobId: "job-uninstall",
              kind: "uninstall",
              identifier: "ModuleManager",
              status: "queued",
              phase: "queued",
              alsoRemove: ["DependentMod"],
            },
          },
          202,
        );
      }
      if (url.startsWith("/api/v1/mods")) return json({ total: 0, mods: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);

    const wrapper = mount(App);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));
    await wrapper.findAll("button").find((button) => button.text().startsWith("Installed"))!.trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("Module Manager"));
    await wrapper.findAll('[data-testid="installed-uninstall-btn"]')[1]!.trigger("click");

    await vi.waitFor(() => expect(wrapper.text()).toContain("Uninstall Module Manager?"));
    expect(wrapper.text()).toContain("This will also remove:");
    expect(uninstallBodies).toEqual([]);

    const confirm = () => wrapper.find('[role="dialog"]').findAll("button").find((button) => button.text() === "Uninstall")!;
    const loadsBeforeConfirm = installedLoads;
    await confirm().trigger("click");
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').text()).toContain("Review the plan again."));
    expect(uninstallBodies).toEqual([{ alsoRemove: ["DependentMod"] }]);
    expect(wrapper.text()).toContain("Uninstall Module Manager?");
    // A rejected selection means the server state moved: refresh the plan and the inventory.
    await vi.waitFor(() => expect(planLoads).toBe(2));
    expect(installedLoads).toBeGreaterThan(loadsBeforeConfirm);

    await confirm().trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).not.toContain("Uninstall Module Manager?"));
    expect(uninstallBodies).toHaveLength(2);
    expect(wrapper.text()).toContain("No managed or detected mods yet.");
  });

  it("updates one mod from the dashboard and reports updates that need attention", async () => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const module = (identifier: string, version: string) => ({
      identifier,
      name: identifier,
      authors: ["Tester"],
      version,
      tags: [],
      download: `https://example.test/${identifier}-${version}.zip`,
    });
    const ref = (identifier: string, version: string) => ({ identifier, name: identifier, version });
    const okPlan = (identifier: string, version: string, extra: Array<{ identifier: string; version: string }> = []) => ({
      status: "ok",
      target: ref(identifier, version),
      toInstall: [...extra.map((entry) => ref(entry.identifier, entry.version)), ref(identifier, version)],
      alreadySatisfied: [],
      conflicts: [],
      unmet: [],
      optional: [],
      choices: [],
    });
    const installBodies: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "ready", moduleCount: 3 });
      if (url === "/api/v1/installed-mods") return json({ mods: [] });
      if (url === "/api/v1/updates") {
        return json({
          updates: [
            { identifier: "Alpha", name: "Alpha", installedVersion: "1.0.0", availableVersion: "1.1.0" },
            { identifier: "Beta", name: "Beta", installedVersion: "1.0.0", availableVersion: "2.0.0" },
            { identifier: "Gamma", name: "Gamma", installedVersion: "1.0.0", availableVersion: "1.2.0" },
          ],
        });
      }
      const versions = /^\/api\/v1\/mods\/(\w+)\/versions$/.exec(url);
      if (versions !== null) {
        const identifier = versions[1]!;
        const latest = { Alpha: "1.1.0", Beta: "2.0.0", Gamma: "1.2.0" }[identifier]!;
        return json({ identifier, versions: [module(identifier, latest), module(identifier, "1.0.0")] });
      }
      if (url === "/api/v1/mods/Alpha/plan") return json(okPlan("Alpha", "1.1.0", [{ identifier: "NewLib", version: "1.0.0" }]));
      if (url === "/api/v1/mods/Beta/plan") {
        return json({
          ...okPlan("Beta", "2.0.0"),
          status: "blocked",
          conflicts: [{ identifier: "Pinned", conflictingWith: "Beta", message: "Installed Pinned needs Beta <= 1.9." }],
        });
      }
      if (url === "/api/v1/mods/Gamma/plan") return json(okPlan("Gamma", "1.2.0"));
      const install = /^\/api\/v1\/mods\/(\w+)\/install$/.exec(url);
      if (install !== null && init?.method === "POST") {
        const identifier = install[1]!;
        installBodies[identifier] = JSON.parse(String(init.body));
        return json(
          { job: { jobId: `job-${identifier}`, kind: "install", identifier, status: "queued", phase: "queued" } },
          202,
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);

    const wrapper = mount(App);
    await vi.waitFor(() => expect(wrapper.text()).toContain("3 updates available."));

    await wrapper.find('[data-testid="update-btn-Gamma"]').trigger("click");
    await vi.waitFor(() => expect(installBodies.Gamma).toEqual({ version: "1.2.0", installDependencies: false }));

    await wrapper.findAll("button").find((button) => button.text() === "Update all")!.trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toContain("Some updates were skipped"));
    expect(installBodies.Alpha).toEqual({ version: "1.1.0", installDependencies: true });
    expect(installBodies.Beta).toBeUndefined();
    expect(wrapper.text()).toContain("Beta (Installed Pinned needs Beta <= 1.9.)");
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ rolledBack: [], failed: [] }), { status: 200 }))
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
      expect(wrapper.text()).toContain("Overview");
      expect(wrapper.text()).toContain("Kraken");
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
      expect(wrapper.text()).toContain("1 module indexed");
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
        .mockResolvedValueOnce(new Response(JSON.stringify({ rolledBack: [], failed: [] }), { status: 200 }))
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
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
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
      expect(wrapper.text()).toContain("Category");
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
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
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

  it("opens and closes mod details panel from browse view", async () => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    const modItem = {
      identifier: "ModuleManager",
      name: "Module Manager",
      authors: ["sarbian"],
      version: "4.2.3",
      tags: ["plugin"],
      abstract: "Patching plugin",
      description: "Full description of Module Manager",
      download: "https://example.test/mm.zip",
      resources: {
        homepage: "https://example.test/mm-home",
      },
    };

    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/v1/health") {
        return json({ status: "ok", version: "test-version" });
      }
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") {
        return json({ status: "ready", moduleCount: 1, updatedAt: "2026-07-17T12:00:00.000Z" });
      }
      if (url === "/api/v1/installed-mods") {
        return json({ mods: [] });
      }
      if (url === "/api/v1/updates") {
        return json({ updates: [] });
      }
      if (url.startsWith("/api/v1/mods/ModuleManager/versions")) {
        return json({ identifier: "ModuleManager", versions: [modItem] });
      }
      if (url.startsWith("/api/v1/mods/ModuleManager")) {
        return json({ mod: modItem });
      }
      if (url.startsWith("/api/v1/mods")) {
        return json({ total: 1, mods: [modItem] });
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
      expect(wrapper.text()).toContain("Module Manager");
    });

    const detailsBtn = wrapper.find('[data-testid="mod-details-btn"]');
    expect(detailsBtn.exists()).toBe(true);
    await detailsBtn.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mod-details-panel"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Full description of Module Manager");
      expect(wrapper.find('[data-testid="resource-link-homepage"]').exists()).toBe(true);
    });

    const closeBtn = wrapper.find('[data-testid="close-details-btn"]');
    await closeBtn.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mod-details-panel"]').exists()).toBe(false);
    });
  });
});

describe("App service status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

  function serviceFetch(refresh: () => Promise<Response>) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "missing", moduleCount: 0 });
      if (url === "/api/v1/installed-mods") return json({ mods: [] });
      if (url === "/api/v1/updates") return json({ updates: [] });
      if (url === "/api/v1/registry/refresh") return refresh();
      throw new Error(`unexpected request ${url}`);
    });
  }

  function systems(wrapper: ReturnType<typeof mount>) {
    return wrapper.find('[aria-label="Systems"]').text();
  }

  async function clickRefresh(wrapper: ReturnType<typeof mount>) {
    await wrapper.findAll("button").find((button) => button.text().includes("Refresh registry"))!.trigger("click");
  }

  it("reports a failed operation without marking the service as down", async () => {
    vi.stubGlobal(
      "fetch",
      serviceFetch(async () => json({ code: "REGISTRY_DOWNLOAD_FAILED", message: "CKAN-meta download failed." }, 502)),
    );
    const wrapper = mount(App);
    await vi.waitFor(() => expect(systems(wrapper)).toContain("Service connected (test-version)"));

    await clickRefresh(wrapper);

    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').text()).toContain("CKAN-meta download failed."));
    expect(systems(wrapper)).toContain("Service connected (test-version)");
  });

  it("keeps the service light green when the registry cache cannot be read at startup", async () => {
    let cacheBroken = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
        if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
        if (url === "/api/v1/config") {
          return json({
            configured: true,
            installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
          });
        }
        if (url === "/api/v1/registry" && cacheBroken) {
          return json({ code: "REGISTRY_CACHE_ERROR", message: "Registry cache is malformed." }, 500);
        }
        if (url === "/api/v1/registry/refresh") {
          cacheBroken = false;
          return json({ status: "ready", moduleCount: 1 });
        }
        if (url === "/api/v1/installed-mods") return json({ mods: [] });
        if (url === "/api/v1/updates") return json({ updates: [] });
        if (url.startsWith("/api/v1/mods")) return json({ total: 0, mods: [] });
        throw new Error(`unexpected request ${url}`);
      }),
    );
    const wrapper = mount(App);

    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').text()).toContain("Registry cache is malformed."));
    expect(systems(wrapper)).toContain("Service connected (test-version)");

    await clickRefresh(wrapper);
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(false));
    expect(systems(wrapper)).toContain("Service connected (test-version)");
  });

  it("does not offer the installation picker when the config cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
        if (url === "/api/v1/config") return json({ code: "CONFIG_ERROR", message: "Config file is malformed." }, 500);
        if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
        throw new Error(`unexpected request ${url}`);
      }),
    );
    const wrapper = mount(App);

    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').text()).toContain("Config file is malformed."));
    expect(wrapper.text()).toContain("Local service is unavailable.");
    expect(wrapper.text()).not.toContain("Detected installations");
  });

  it("marks the service as down when it stops answering, and up again when it answers", async () => {
    let reachable = false;
    vi.stubGlobal(
      "fetch",
      serviceFetch(async () => {
        if (!reachable) {
          throw new TypeError("Failed to fetch");
        }
        return json({ status: "ready", moduleCount: 1 });
      }),
    );
    const wrapper = mount(App);
    await vi.waitFor(() => expect(systems(wrapper)).toContain("Service connected (test-version)"));

    await clickRefresh(wrapper);
    await vi.waitFor(() => {
      expect(systems(wrapper)).toContain("Local service is unavailable.");
      expect(wrapper.find('[role="alert"]').text()).toContain("The local service is not responding.");
    });

    reachable = true;
    await clickRefresh(wrapper);
    await vi.waitFor(() => expect(systems(wrapper)).toContain("Service connected (test-version)"));
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});

describe("App install recovery notice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

  it("shows what the service undid at startup until it is dismissed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
        if (url === "/api/v1/install-recovery") {
          return json({
            rolledBack: [
              {
                jobId: "job-1",
                installationPath: "/games/KSP",
                modules: [{ identifier: "MechJeb2", name: "MechJeb 2", restoredVersion: "2.14.0" }],
              },
            ],
            failed: [],
            activeInstallationPath: "/games/KSP",
          });
        }
        if (url === "/api/v1/config") {
          return json({
            configured: true,
            installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
          });
        }
        if (url === "/api/v1/registry") return json({ status: "missing", moduleCount: 0 });
        if (url === "/api/v1/installed-mods") return json({ mods: [] });
        if (url === "/api/v1/updates") return json({ updates: [] });
        throw new Error(`unexpected request ${url}`);
      }),
    );
    const wrapper = mount(App);

    await vi.waitFor(() => expect(wrapper.text()).toContain("MechJeb 2: restored 2.14.0"));
    expect(wrapper.text()).toContain("Active installation");

    await wrapper.get('button[aria-label="Dismiss notice"]').trigger("click");
    expect(wrapper.find('[data-testid="recovery-notice"]').exists()).toBe(false);
  });
});

describe("App optional mods at install", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const mod = {
    identifier: "Scansat",
    name: "SCANsat",
    authors: ["DMagic"],
    version: "20.4",
    tags: ["plugin"],
    download: "https://example.test/scansat.zip",
  };
  const target = { identifier: mod.identifier, name: mod.name, version: mod.version };
  const moduleManager = { identifier: "ModuleManager", name: "Module Manager", version: "4.2.3" };
  const basePlan = { status: "ok", target, alreadySatisfied: [], conflicts: [], unmet: [], choices: [] };

  const moduleManagerLib = { identifier: "ModuleManagerLib", name: "Module Manager Lib", version: "1.0.0" };

  function optionalFetch(installed: boolean, pickedBringsLib = false) {
    const planBodies: unknown[] = [];
    const installBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "ready", moduleCount: 3 });
      if (url === "/api/v1/installed-mods") {
        return json({ mods: installed ? [{ ...target, version: "20.3", status: "managed" }] : [] });
      }
      if (url === "/api/v1/updates") return json({ updates: [] });
      if (url === "/api/v1/mods/Scansat/plan") {
        const body = JSON.parse(String(init?.body)) as { optional?: string[] };
        planBodies.push(body);
        const picked = body.optional ?? [];
        return json({
          ...basePlan,
          toInstall: picked.includes("ModuleManager")
            ? [...(pickedBringsLib ? [moduleManagerLib] : []), moduleManager, target]
            : [target],
          optional: picked.includes("ModuleManager")
            ? []
            : [{ kind: "recommends", name: "ModuleManager", requiredBy: "Scansat", module: moduleManager }],
        });
      }
      if (url === "/api/v1/mods/Scansat/install" && init?.method === "POST") {
        installBodies.push(JSON.parse(String(init.body)));
        return json(
          { job: { jobId: "job-scansat", kind: "install", identifier: mod.identifier, version: mod.version, status: "queued", phase: "queued" } },
          202,
        );
      }
      if (url.startsWith("/api/v1/mods")) return json({ total: 1, mods: [mod] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    return { fetchMock, planBodies, installBodies };
  }

  async function clickInstall(wrapper: ReturnType<typeof mount>) {
    await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));
    await wrapper.findAll("button").find((button) => button.text() === "Browse mods")!.trigger("click");
    await vi.waitFor(() => expect(wrapper.find('[data-testid="mod-row"]').exists()).toBe(true));
    await wrapper.get('[data-testid="mod-row"]').findAll("button").find((button) => button.text().endsWith("Install") || button.text() === "Reinstall")!.trigger("click");
  }

  it("offers recommendations for a new mod and installs the picked ones with it", async () => {
    const { fetchMock, planBodies, installBodies } = optionalFetch(false);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    const wrapper = mount(App);

    await clickInstall(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Install SCANsat?"));
    expect(wrapper.get<HTMLInputElement>('input[value="ModuleManager"]').element.checked).toBe(true);
    await wrapper.get('[role="dialog"]').findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => expect(installBodies).toHaveLength(1));
    expect(planBodies).toEqual([{ version: "20.4" }, { version: "20.4", optional: ["ModuleManager"] }]);
    expect(installBodies[0]).toEqual({ version: "20.4", installDependencies: true, optional: ["ModuleManager"] });
  });

  it("opens the dialog for a metapackage with nothing missing and installs it with dependencies", async () => {
    const bundle = { identifier: "Bundle", name: "Bundle", authors: ["someone"], version: "1.0.0", tags: [], kind: "metapackage" };
    const bundleTarget = { identifier: "Bundle", name: "Bundle", version: "1.0.0" };
    const installBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/health") return json({ status: "ok", version: "test-version" });
      if (url === "/api/v1/install-recovery") return json({ rolledBack: [], failed: [] });
      if (url === "/api/v1/config") {
        return json({
          configured: true,
          installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
        });
      }
      if (url === "/api/v1/registry") return json({ status: "ready", moduleCount: 1 });
      if (url === "/api/v1/installed-mods") return json({ mods: [] });
      if (url === "/api/v1/updates") return json({ updates: [] });
      if (url === "/api/v1/mods/Bundle/plan") {
        return json({ ...basePlan, target: bundleTarget, toInstall: [bundleTarget], optional: [] });
      }
      if (url === "/api/v1/mods/Bundle/install" && init?.method === "POST") {
        installBodies.push(JSON.parse(String(init.body)));
        return json(
          { job: { jobId: "job-bundle", kind: "install", identifier: "Bundle", version: "1.0.0", status: "queued", phase: "queued" } },
          202,
        );
      }
      if (url.startsWith("/api/v1/mods")) return json({ total: 1, mods: [bundle] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    const wrapper = mount(App);

    await clickInstall(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Kraken will only record Bundle."));
    expect(installBodies).toHaveLength(0);
    await wrapper.get('[role="dialog"]').findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => expect(installBodies).toHaveLength(1));
    expect(installBodies[0]).toEqual({ version: "1.0.0", installDependencies: true });
  });

  describe("modpack import", () => {
    const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const pack = {
      identifier: "MyPack",
      name: "My Pack",
      authors: ["someone"],
      version: "1.0.0",
      tags: [],
      kind: "metapackage",
      source: "imported",
    };
    const packTarget = { identifier: "MyPack", name: "My Pack", version: "1.0.0" };

    function importFetch(modpackResponse: () => Response) {
      const modpackBodies: unknown[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/health") return jsonResponse({ status: "ok", version: "test-version" });
        if (url === "/api/v1/install-recovery") return jsonResponse({ rolledBack: [], failed: [] });
        if (url === "/api/v1/config") {
          return jsonResponse({
            configured: true,
            installation: { path: "/games/KSP", platform: "linux", source: "manual", version: "1.12.5" },
          });
        }
        if (url === "/api/v1/registry") return jsonResponse({ status: "ready", moduleCount: 1 });
        if (url === "/api/v1/installed-mods") return jsonResponse({ mods: [] });
        if (url === "/api/v1/updates") return jsonResponse({ updates: [] });
        if (url === "/api/v1/modpacks" && init?.method === "POST") {
          modpackBodies.push(JSON.parse(String(init.body)));
          return modpackResponse();
        }
        if (url === "/api/v1/mods/MyPack/plan") {
          return jsonResponse({
            status: "ok",
            target: packTarget,
            toInstall: [packTarget],
            alreadySatisfied: [],
            conflicts: [],
            unmet: [],
            optional: [],
          });
        }
        if (url.startsWith("/api/v1/mods")) return jsonResponse({ total: 0, mods: [] });
        throw new Error(`Unexpected fetch: ${url}`);
      });
      return { fetchMock, modpackBodies };
    }

    async function pickFile(wrapper: ReturnType<typeof mount>, file: File): Promise<void> {
      await wrapper.findAll("button").find((button) => button.text().startsWith("Installed"))!.trigger("click");
      await vi.waitFor(() => expect(wrapper.find('input[type="file"]').exists()).toBe(true));
      const input = wrapper.get('input[type="file"]');
      Object.defineProperty(input.element, "files", { value: [file], configurable: true });
      await input.trigger("change");
    }

    it("rejects a modpack file over 1 MB without sending it", async () => {
      const { fetchMock, modpackBodies } = importFetch(() => jsonResponse({ mod: pack }));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("EventSource", MockEventSource);
      const wrapper = mount(App);
      await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));

      await pickFile(wrapper, new File(["x".repeat(2 * 1024 * 1024)], "big.ckan"));

      await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain("The modpack file is larger than 1 MB."));
      expect(modpackBodies).toEqual([]);
    });

    it("posts the file contents, then plans the module and opens the dependency dialog", async () => {
      const contents = '{"identifier":"MyPack"}';
      const { fetchMock, modpackBodies } = importFetch(() => jsonResponse({ mod: pack }));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("EventSource", MockEventSource);
      const wrapper = mount(App);
      await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));

      await pickFile(wrapper, new File([contents], "pack.ckan"));

      await vi.waitFor(() => expect(wrapper.find('[role="dialog"]').exists()).toBe(true));
      expect(modpackBodies).toEqual([{ contents }]);
      expect(wrapper.get('[role="dialog"]').text()).toContain("My Pack");
    });

    it("shows the server message when the modpack is rejected", async () => {
      const { fetchMock } = importFetch(() =>
        jsonResponse({ code: "INVALID_MODPACK", message: "The file is not a CKAN modpack." }, 400),
      );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("EventSource", MockEventSource);
      const wrapper = mount(App);
      await vi.waitFor(() => expect(wrapper.text()).toContain("Active installation"));

      await pickFile(wrapper, new File(["nope"], "bad.ckan"));

      await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain("The file is not a CKAN modpack."));
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });
  });

  it("installs directly when every optional mod is unpicked", async () => {
    const { fetchMock, installBodies } = optionalFetch(false);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    const wrapper = mount(App);

    await clickInstall(wrapper);
    await vi.waitFor(() => expect(wrapper.find('input[value="ModuleManager"]').exists()).toBe(true));
    await wrapper.get('input[value="ModuleManager"]').setValue(false);
    await wrapper.get('[role="dialog"]').findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => expect(installBodies).toHaveLength(1));
    expect(installBodies[0]).toEqual({ version: "20.4", installDependencies: false });
  });

  it("does not offer optional mods again for a mod that is already installed", async () => {
    const { fetchMock, installBodies } = optionalFetch(true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    const wrapper = mount(App);

    await clickInstall(wrapper);

    await vi.waitFor(() => expect(installBodies).toHaveLength(1));
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(installBodies[0]).toEqual({ version: "20.4", installDependencies: false });
  });

  it("shows dependencies of picked optional mods before installing them", async () => {
    const { fetchMock, planBodies, installBodies } = optionalFetch(false, true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    const wrapper = mount(App);

    await clickInstall(wrapper);
    await vi.waitFor(() => expect(wrapper.text()).toContain("Install SCANsat?"));
    await wrapper.get('[role="dialog"]').findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => expect(wrapper.text()).toContain("Install these mods too?"));
    expect(wrapper.get('[role="dialog"]').text()).toContain("Module Manager Lib");
    expect(installBodies).toEqual([]);
    await wrapper.get('[role="dialog"]').findAll("button").find((button) => button.text() === "Install")!.trigger("click");

    await vi.waitFor(() => expect(installBodies).toHaveLength(1));
    expect(installBodies[0]).toEqual({ version: "20.4", installDependencies: true, optional: ["ModuleManager"] });
    expect(planBodies).toHaveLength(2);
  });
});
