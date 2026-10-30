import { describe, it, expect, vi } from "vitest";
import { preferenceDraft, applyPreferences, preferenceWrites } from "./settings";
import type Device from "../api/comms/Device";
import type { KBDataPref } from "../renderer/types/preferences";
import type { WirelessInterface } from "../renderer/types/wireless";

vi.mock("./deviceDraft", () => ({
  commandsFor: (device: { fileData: { virtual: Record<string, unknown> } }) => Object.keys(device.fileData.virtual),
}));
const device = () =>
  ({
    device: { info: { product: "Raise" }, keyboard: { rows: 1, columns: 2 } },
    fileData: {
      virtual: {
        "mouse.speed": {},
        "mouse.speedDelay": {},
        "led.brightness": {},
        "settings.defaultLayer": {},
        "keymap.onlyCustom": {},
      },
    },
    memoryMap: new Map([["keymap.custom", "4 5 6 7"]]),
    noCacheCommand: vi.fn(async () => ""),
  }) as unknown as Device;
const keyboard = () =>
  ({
    keymap: { custom: [], default: [], onlyCustom: 1 },
    mouseSpeed: 10,
    mouseSpeedDelay: 2,
    ledBrightness: 255,
    defaultLayer: 0,
  }) as KBDataPref;
describe("device-aware preference schemas", () => {
  it("advertises only supported observed settings and actual layer bounds", () => {
    const draft = preferenceDraft(device(), keyboard(), {} as WirelessInterface);
    expect(Object.keys(draft.settings).sort()).toEqual([
      "defaultLayer",
      "keymap.onlyCustom",
      "ledBrightness",
      "mouseSpeed",
    ]);
    expect(draft.settingSpecs.defaultLayer.max).toBe(1);
    expect(draft.settingSpecs.mouseSpeed.max).toBe(127);
    expect(draft.settingSpecs.qukeysHoldTimeout).toBeUndefined();
  });
  it("applies nested fields and the normal mouse-slider companion delay", () => {
    const state = preferenceDraft(device(), keyboard(), {} as WirelessInterface);
    const next = applyPreferences(
      keyboard(),
      {} as WirelessInterface,
      { settings: { ...state.settings, "keymap.onlyCustom": 0, mouseSpeed: 20 } } as never,
    );
    expect(next.kb.keymap.onlyCustom).toBe(0);
    expect(next.kb.mouseSpeedDelay).toBe(10);
    expect(keyboard().mouseSpeedDelay).toBe(2);
  });
  it("uses the existing transport and avoids unsupported commands", async () => {
    const dev = device();
    await Promise.all(preferenceWrites(dev, keyboard(), {} as WirelessInterface).map(write => write()));
    expect(dev.noCacheCommand).toHaveBeenCalledWith("mouse.speed", "10");
    expect(dev.noCacheCommand).toHaveBeenCalledWith("mouse.speedDelay", "2");
    expect(dev.noCacheCommand).not.toHaveBeenCalledWith("wireless.rf.power", expect.anything());
  });
});
