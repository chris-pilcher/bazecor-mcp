import { describe, it, expect, vi, beforeEach } from "vitest";
import { applicationSettings, updateApplicationSetting } from "./appSettings";
import type Device from "../api/comms/Device";

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  invoke: vi.fn(async (channel: string) => (channel === "lens:get-settings" ? { enabled: false } : false)),
}));
vi.mock("electron", () => ({ ipcRenderer: { invoke: mocks.invoke } }));
vi.mock("electron-log/renderer", () => ({ default: { transports: { console: { level: "info" } } } }));
vi.mock("../renderer/utils/Store", () => ({
  default: {
    getStore: () => ({
      get: (key: string) => mocks.values.get(key),
      set: (key: string, value: unknown) => mocks.values.set(key, value),
    }),
  },
}));
vi.mock("../api/keymap", () => ({ default: class {}, languagesDB: { "en-US": {}, "en-GB": {} } }));
const device = { isClosed: false, commands: {}, device: {} } as Device;
beforeEach(() => {
  mocks.values.clear();
  mocks.invoke.mockClear();
});
describe("bounded application settings", () => {
  it("rejects unknown settings, languages and Lens capability/range violations", async () => {
    const theme = vi.fn(async () => {});
    await expect(updateApplicationSetting("backupFolder", "/tmp/arbitrary", device, theme)).rejects.toThrow(
      /not exposed/,
    );
    await expect(updateApplicationSetting("language", "invented", device, theme)).rejects.toThrow(/Unsupported/);
    await expect(updateApplicationSetting("lens.enabled", true, device, theme)).rejects.toThrow(/unavailable/);
    mocks.values.set("capabilities.lens", true);
    await expect(updateApplicationSetting("lens.opacity", 99, device, theme)).rejects.toThrow(/0.1/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("uses only fixed existing app IPC channels and distinguishes app changes from hardware writes", async () => {
    mocks.values.set("capabilities.lens", true);
    await updateApplicationSetting(
      "lens.opacity",
      0.5,
      device,
      vi.fn(async () => {}),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("lens:set-opacity", 0.5);
    await updateApplicationSetting(
      "showDefaults",
      true,
      device,
      vi.fn(async () => {}),
    );
    expect((await applicationSettings(device)).showDefaults).toBe(true);
    expect((await applicationSettings(device)).languages).toEqual(["en-US", "en-GB"]);
  });
});
