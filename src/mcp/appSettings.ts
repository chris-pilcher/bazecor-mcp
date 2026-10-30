import log from "electron-log/renderer";
import { ipcRenderer } from "electron";
import Store from "../renderer/utils/Store";
import Keymap, { languagesDB } from "../api/keymap";
import type Device from "../api/comms/Device";

const store = Store.getStore();
const lensChannels = {
  enabled: "lens:set-enabled",
  opacity: "lens:set-opacity",
  showUnderglow: "lens:set-show-underglow",
  overlayMode: "lens:set-overlay",
  overlayAutoShow: "lens:set-overlay-auto-show",
  overlayAutoShowDuration: "lens:set-overlay-auto-show-duration",
  resizeMode: "lens:set-resize-mode",
};
export async function applicationSettings(device?: Device) {
  return {
    deviceNickname: ((store.get("neurons") || []) as Array<{ id: string; name: string }>).find(
      neuron => neuron.id === String(device?.device?.chipId || "").replace(/\s/g, ""),
    )?.name,
    theme: store.get("settings.darkMode") || "system",
    language: store.get("settings.language"),
    verbose: !!store.get("settings.verbose"),
    showDefaults: !!store.get("settings.showDefaults"),
    languages: Object.keys(languagesDB),
    lensAvailable:
      !!device &&
      !device.isClosed &&
      [true, 1, "true", "1"].includes(store.get("capabilities.lens") as boolean | number | string),
    lens: await ipcRenderer.invoke("lens:get-settings"),
    runInBackground: await ipcRenderer.invoke("lens:get-run-in-background"),
    note: "Application settings are applied immediately; they do not write keyboard configuration.",
  };
}
export async function updateApplicationSetting(
  name: string,
  value: unknown,
  device: Device,
  setTheme: (value: string) => Promise<void>,
) {
  if (name === "deviceNickname") {
    if (!device || device.isClosed || typeof value !== "string" || value.length > 128)
      throw new Error("A connected device and a name of at most 128 characters are required");
    const neurons = (store.get("neurons") || []) as Array<{ id: string; name: string }>;
    const id = String(device.device.chipId || device.serialNumber).replace(/\s/g, "");
    const index = neurons.findIndex(neuron => neuron.id === id);
    if (index < 0) throw new Error("Device profile is not loaded");
    neurons[index] = { ...neurons[index], name: value };
    store.set("neurons", neurons);
  } else if (name === "theme") {
    if (!["light", "dark", "system"].includes(String(value))) throw new Error("Unknown theme");
    await setTheme(String(value));
  } else if (name === "language") {
    if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(languagesDB, value))
      throw new Error("Unsupported keyboard language");
    store.set("settings.language", value);
    await ipcRenderer.invoke("lens:set-layout", value);
    const activeDevice = device;
    if (activeDevice && !activeDevice.isClosed)
      activeDevice.commands = {
        ...activeDevice.commands,
        keymap: new Keymap({ ...activeDevice.device, language: true }),
      };
  } else if (name === "verbose" || name === "showDefaults") {
    if (typeof value !== "boolean") throw new Error("Setting requires a boolean");
    store.set(`settings.${name}`, value);
    if (name === "verbose") log.transports.console.level = value ? "verbose" : "info";
  } else if (name === "runInBackground") {
    if (typeof value !== "boolean") throw new Error("Setting requires a boolean");
    await ipcRenderer.invoke("lens:set-run-in-background", value);
  } else if (name.startsWith("lens.")) {
    if (!device || device.isClosed) throw new Error("Connect a supported device before changing Layer Lens settings");
    const key = name.slice(5);
    if (!Object.prototype.hasOwnProperty.call(lensChannels, key)) throw new Error("Unknown Lens setting");
    if (![true, 1, "true", "1"].includes(store.get("capabilities.lens") as boolean | number | string))
      throw new Error("Layer Lens is unavailable for the active device/firmware");
    if (key === "opacity") {
      if (typeof value !== "number" || value < 0.1 || value > 1) throw new Error("Opacity must be in 0.1..1");
    } else if (key === "overlayAutoShowDuration") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1000 || value > 10000)
        throw new Error("Duration must be in 1000..10000 ms");
    } else if (typeof value !== "boolean") throw new Error("Lens setting requires a boolean");
    await ipcRenderer.invoke(lensChannels[key as keyof typeof lensChannels], value);
  } else
    throw new Error(
      "Application setting is not exposed. Arbitrary paths, developer tools, update channels and OS access installation remain UI-only.",
    );
  return applicationSettings(device);
}
