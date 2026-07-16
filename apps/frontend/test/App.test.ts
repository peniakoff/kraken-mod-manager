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
});
