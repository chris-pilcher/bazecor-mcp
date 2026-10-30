import type { Draft } from "./domain";
import type { KBDataPref } from "../renderer/types/preferences";
import type { WirelessInterface } from "../renderer/types/wireless";
import type Device from "../api/comms/Device";
import { commandsFor } from "./deviceDraft";
import { supportsTrueSleep } from "../renderer/utils/deviceCapabilities";

type Spec = NonNullable<Draft["settingSpecs"]>[string];
const numeric = (command: string, min: number, max: number): Spec => ({ type: "number", command, min, max });
const keyboard: Record<string, Spec> = {
  "keymap.onlyCustom": numeric("keymap.onlyCustom", 0, 1),
  ledBrightness: numeric("led.brightness", 0, 255),
  ledBrightnessUG: numeric("led.brightnessUG", 0, 255),
  ledIdleTimeLimit: numeric("idleleds.time_limit", 0, 3600),
  defaultLayer: numeric("settings.defaultLayer", 0, 126),
  qukeysHoldTimeout: numeric("qukeys.holdTimeout", 1, 255),
  qukeysOverlapThreshold: numeric("qukeys.overlapThreshold", 0, 100),
  qukeysMinHold: { ...numeric("qukeys.minimumHoldTime", 1, 254), specialValues: [0, 255] },
  qukeysMinPrior: { ...numeric("qukeys.minimumPriorInterval", 1, 254), specialValues: [0, 255] },
  SuperTimeout: numeric("superkeys.timeout", 1, 500),
  SuperHoldstart: numeric("superkeys.holdstart", 120, 500),
  SuperOverlapThreshold: numeric("superkeys.overlap", 0, 80),
  mouseSpeed: numeric("mouse.speed", 0, 127),
  mouseAccelSpeed: numeric("mouse.accelSpeed", 0, 254),
  mouseWheelSpeed: numeric("mouse.wheelSpeed", 1, 15),
  mouseSpeedLimit: numeric("mouse.speedLimit", 0, 255),
};
const radio: Record<string, Spec> = {
  "wireless.battery.savingMode": { type: "boolean", command: "wireless.battery.savingMode" },
  "wireless.bluetooth.deviceName": { type: "string", command: "wireless.bluetooth.deviceName" },
  "wireless.rf.channelHop": numeric("wireless.rf.channelHop", 0, 1),
  "wireless.rf.power": numeric("wireless.rf.power", 0, 2),
  "wireless.brightness": numeric("led.brightness.wireless", 0, 255),
  "wireless.brightnessUG": numeric("led.brightnessUG.wireless", 0, 255),
  "wireless.fade": numeric("led.fade", 0, 1),
  "wireless.idleleds": numeric("idleleds.wireless", 0, 3600),
  "wireless.true_sleep": { type: "boolean", command: "idleleds.true_sleep" },
  "wireless.true_sleep_time": numeric("idleleds.true_sleep_time", 60, 3600),
};
export function preferenceDraft(device: Device, kb: KBDataPref, wireless: WirelessInterface) {
  const available = commandsFor(device);
  const specs: Record<string, Spec> = {};
  const settings: NonNullable<Draft["settings"]> = {};
  const get = (name: string): unknown =>
    name
      .split(".")
      .reduce(
        (value: unknown, key) =>
          value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined,
        { ...kb, wireless },
      );
  const isWireless = !!device?.device?.wireless || device?.device?.info?.keyboardType === "wireless";
  Object.entries({ ...keyboard, ...(isWireless ? radio : {}) }).forEach(([name, spec]) => {
    if (!available.includes(spec.command)) return;
    if (name.includes("true_sleep") && !supportsTrueSleep(String(device?.device?.info?.product))) return;
    const value = get(name);
    if (typeof value !== spec.type || (typeof value === "number" && (!Number.isFinite(value) || value < 0))) return;
    if (name === "defaultLayer") {
      const size = (device.device?.keyboard?.rows || 0) * (device.device?.keyboard?.columns || 0);
      const raw = device.memoryMap.get("keymap.custom");
      const defaults = device.memoryMap.get("keymap.default");
      if (!size || typeof raw !== "string") return;
      const count =
        raw.trim().split(/\s+/).length / size +
        (kb.keymap.onlyCustom || typeof defaults !== "string" ? 0 : defaults.trim().split(/\s+/).length / size);
      if (!Number.isInteger(count) || count < 1) return;
      specs[name] = { ...spec, max: count - 1 };
      settings[name] = value as number;
      return;
    }
    specs[name] = spec;
    settings[name] = value as number | string | boolean;
  });
  return { settings, settingSpecs: specs };
}
export function applyPreferences(kb: KBDataPref, wireless: WirelessInterface, draft: Draft) {
  const nextKb = { ...kb, keymap: { ...kb.keymap } };
  const nextWireless = JSON.parse(JSON.stringify(wireless)) as WirelessInterface;
  Object.entries(draft.settings || {}).forEach(([name, value]) => {
    if (name === "keymap.onlyCustom") nextKb.keymap.onlyCustom = Number(value);
    else if (!name.startsWith("wireless.")) (nextKb as unknown as Record<string, unknown>)[name] = value;
    else {
      const segments = name.split(".").slice(1);
      let target: Record<string, unknown> = nextWireless as unknown as Record<string, unknown>;
      segments.slice(0, -1).forEach(key => {
        target = target[key] as Record<string, unknown>;
      });
      target[segments[segments.length - 1]] = value;
    }
  });
  // Preserve the same companion settings as the normal sliders.
  if (nextKb.mouseSpeed !== kb.mouseSpeed) nextKb.mouseSpeedDelay = 10;
  if (nextKb.mouseAccelSpeed !== kb.mouseAccelSpeed) nextKb.mouseAccelDelay = 600;
  if (nextKb.mouseWheelSpeed !== kb.mouseWheelSpeed) nextKb.mouseWheelDelay = 100;
  return { kb: nextKb, wireless: nextWireless };
}
export function preferenceWrites(device: Device, kb: KBDataPref, wireless: WirelessInterface) {
  const draft = preferenceDraft(device, kb, wireless);
  const writes = Object.entries(draft.settings).map(
    ([name, value]) =>
      () =>
        device.noCacheCommand(
          draft.settingSpecs[name].command,
          String(typeof value === "boolean" ? Number(value) : value),
        ),
  );
  const commands = commandsFor(device);
  [
    ["mouse.speedDelay", kb.mouseSpeedDelay],
    ["mouse.accelDelay", kb.mouseAccelDelay],
    ["mouse.wheelDelay", kb.mouseWheelDelay],
  ].forEach(([command, value]) => {
    if (commands.includes(String(command))) writes.push(() => device.noCacheCommand(String(command), String(value)));
  });
  return writes;
}
