import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RecoveryNotice from "../src/components/RecoveryNotice.vue";

const empty = { rolledBack: [], failed: [] };

describe("RecoveryNotice", () => {
  it("renders nothing when no install was interrupted", () => {
    const wrapper = mount(RecoveryNotice, { props: { report: empty } });

    expect(wrapper.find('[data-testid="recovery-notice"]').exists()).toBe(false);
  });

  it("lists what an undone install removed or put back", () => {
    const wrapper = mount(RecoveryNotice, {
      props: {
        report: {
          ...empty,
          rolledBack: [
            {
              jobId: "job-1",
              installationPath: "/games/KSP",
              modules: [
                { identifier: "ModuleManager", name: "Module Manager" },
                { identifier: "MechJeb2", name: "MechJeb 2", restoredVersion: "2.15.4.0" },
              ],
            },
          ],
        },
      },
    });

    const notice = wrapper.get('[data-testid="recovery-notice"] [role="status"]');
    expect(notice.text()).toContain("An interrupted install was undone");
    expect(notice.text()).toContain("Module Manager: removed");
    expect(notice.text()).toContain("MechJeb 2: restored 2.15.4.0");
  });

  it("raises an alert when an interrupted install could not be undone", () => {
    const wrapper = mount(RecoveryNotice, {
      props: { report: { ...empty, failed: [{ jobId: "job-2", installationPath: "/games/KSP", message: "Install journal is malformed." }] } },
    });

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain("could not be undone");
    expect(alert.text()).toContain("Install journal is malformed.");
  });

  it("points to backups Kraken cannot restore", () => {
    const wrapper = mount(RecoveryNotice, {
      props: { report: { ...empty, untrackedBackups: [{ installationPath: "/games/KSP", count: 2, directory: "/games/KSP/.kraken-backup" }] } },
    });

    expect(wrapper.text()).toContain("Backups Kraken cannot restore");
    expect(wrapper.text()).toContain("2 backup folders");
    expect(wrapper.text()).toContain("check them before deleting anything");
    expect(wrapper.text()).toContain("/games/KSP/.kraken-backup");
    expect(wrapper.text()).not.toContain("restore or delete them by hand");
  });

  it("names an installation only when it is not the active one", () => {
    const wrapper = mount(RecoveryNotice, {
      props: {
        report: {
          rolledBack: [
            {
              jobId: "job-1",
              installationPath: "/games/KSP",
              modules: [{ identifier: "MechJeb2", name: "MechJeb 2" }],
            },
            {
              jobId: "job-2",
              installationPath: "/games/KSP-other",
              modules: [{ identifier: "Kopernicus", name: "Kopernicus" }],
            },
          ],
          failed: [
            { installationPath: "/games/KSP", message: "Active failure." },
            { installationPath: "/games/KSP-failed", message: "Other failure." },
          ],
          untrackedBackups: [
            { installationPath: "/games/KSP", count: 1, directory: "/games/KSP/.kraken-backup" },
            { installationPath: "/games/KSP-backups", count: 2, directory: "/games/KSP-backups/.kraken-backup" },
          ],
          activeInstallationPath: "/games/KSP",
        },
      },
    });

    const text = wrapper.text();
    expect(text).toContain("in /games/KSP-other");
    expect(text).toContain("in /games/KSP-failed");
    expect(text).toContain("in /games/KSP-backups");
    expect(text).not.toMatch(/in \/games\/KSP(?![-\w])/);
    expect(text).toContain("Active failure.");
  });

  it("emits dismiss from the close button", async () => {
    const wrapper = mount(RecoveryNotice, {
      props: { report: { ...empty, failed: [{ jobId: "job-2", installationPath: "/games/KSP", message: "Broken." }] } },
    });

    await wrapper.get('button[aria-label="Dismiss notice"]').trigger("click");

    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });
});
