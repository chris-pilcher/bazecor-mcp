import { validateIntegerStream, validSettingNumber } from "./wireValidation";
import type Device from "../api/comms/Device";
import { backupSchema } from "./backupSchema";
import { catalogFor, commandsFor, recoverySave } from "./deviceDraft";
import { KeymapDB } from "../api/keymap";
import {
  parseKeymapRaw,
  parseMacrosRaw,
  parseSuperkeysRaw,
  parsePaletteRaw,
  parseColormapRaw,
  serializeKeymap,
  serializeMacros,
  serializeSuperkeys,
  serializePalette,
  serializeColormap,
} from "../api/parsers";
import { assertAction } from "./actions";
import { validateDraft } from "./domain";
import { validateDefinitions } from "./definitions";
import type { Draft } from "./domain";
import { preferenceDraft } from "./settings";
import type { KBDataPref } from "../renderer/types/preferences";
import type { WirelessInterface } from "../renderer/types/wireless";
import Store from "../renderer/utils/Store";

/** A configuration-only recovery path. Never forwards arbitrary backup commands. */
export async function restoreConfiguration(device: Device, input: unknown) {
  if (!device || device.isClosed) throw new Error("Connect a device first");
  const source = backupSchema.parse(input);
  if (
    source.neuron.device.info.product !== device.device.info.product ||
    source.neuron.device.info.keyboardType !== device.device.info.keyboardType
  )
    throw new Error("Backup model/type differs; use the UI's explicit conversion workflow");
  const advertised = commandsFor(device);
  const entries = new Map<string, string>();
  source.backup.forEach(entry => {
    if (["keymap.custom", "keymap.default", "superkeys.map", "keymap.onlyCustom"].includes(entry.command))
      validateIntegerStream(entry.data, 65535);
    if (["palette", "macros.map"].includes(entry.command)) validateIntegerStream(entry.data, 255);
    if (entry.command === "colormap.map") validateIntegerStream(entry.data, 255);
  });
  source.backup.forEach(entry => {
    if (entries.has(entry.command)) throw new Error("Duplicate backup command");
    entries.set(entry.command, entry.data);
  });
  const fresh = async (command: string) => {
    const result = await device.noCacheCommand(command);
    if (typeof result !== "string") throw new Error(`Could not read ${command}`);
    return result;
  };
  const required = (command: string) => {
    if (!advertised.includes(command) || !entries.has(command))
      throw new Error(`Complete supported backup required: missing ${command}. Export with includePrivate:true.`);
    return entries.get(command);
  };
  const onlyCustom = entries.get("keymap.onlyCustom") ?? (await fresh("keymap.onlyCustom"));
  if (!["0", "1"].includes(onlyCustom.trim())) throw new Error("Invalid layer mode");
  const keySize = device.device.keyboard.rows * device.device.keyboard.columns;
  if (!keySize) throw new Error("Device key geometry unavailable");
  const actualKeys = parseKeymapRaw(await fresh("keymap.custom"), keySize);
  const keys = parseKeymapRaw(required("keymap.custom"), keySize);
  if (JSON.stringify(keys.map(row => row.length)) !== JSON.stringify(actualKeys.map(row => row.length)))
    throw new Error("Backup keymap dimensions differ");
  const defaults = parseKeymapRaw(await fresh("keymap.default"), keySize);
  const { keyboard } = device.device;
  const underglow = device.device.keyboardUnderglow;
  const underCount = (underglow.ledsLeft?.length || 0) + (underglow.ledsRight?.length || 0);
  const ledSize =
    keyboard.ledsLeft.length + keyboard.ledsRight.length + (underCount || underglow.rows * underglow.columns);
  const colors = entries.has("colormap.map") ? parseColormapRaw(required("colormap.map"), ledSize) : [];
  const palette = entries.has("palette") ? parsePaletteRaw(required("palette"), device.device.RGBWMode) : [];
  if (advertised.includes("colormap.map")) {
    const actualColors = parseColormapRaw(await fresh("colormap.map"), ledSize);
    if (JSON.stringify(colors.map(row => row.length)) !== JSON.stringify(actualColors.map(row => row.length)))
      throw new Error("Backup LED dimensions differ");
  }
  if (
    advertised.includes("palette") &&
    palette.length !== parsePaletteRaw(await fresh("palette"), device.device.RGBWMode).length
  )
    throw new Error("Backup palette dimensions differ");
  const metadata = (list: unknown[] = []) =>
    list.map((value, id) => ({
      id,
      name: value && typeof value === "object" && "name" in value && typeof value.name === "string" ? value.name : "",
      macro: "",
      actions: [] as [],
    }));
  const macros = advertised.includes("macros.map")
    ? parseMacrosRaw(required("macros.map"), metadata(source.neuron.macros))
    : [];
  const superkeys = advertised.includes("superkeys.map")
    ? parseSuperkeysRaw(required("superkeys.map"), metadata(source.neuron.superkeys))
    : [];
  const candidate: Draft = {
    deviceId: device.serialNumber,
    deviceName: String(device.device.info.product),
    virtual: device.type === "virtual",
    connected: true,
    editor: "layout",
    dirty: true,
    selectedLayer: 0,
    selectedKey: -1,
    selectedLed: -1,
    onlyCustom: onlyCustom.trim() === "1",
    defaultLayerCount: defaults.length,
    keys,
    defaultKeys: defaults,
    colors,
    palette,
    macros,
    superkeys,
  };
  validateDraft(candidate);
  validateDefinitions(candidate);
  const catalog = catalogFor(device, new KeymapDB());
  keys.forEach(row => row.forEach(code => assertAction(code, candidate, catalog)));
  macros.forEach(m =>
    m.actions.forEach(action => {
      if ([3, 4, 5, 6, 7, 8].includes(action.type)) assertAction(action.keyCode as number, candidate, catalog);
    }),
  );
  superkeys.forEach(sk =>
    sk.actions.forEach(code => {
      if (code !== 1) assertAction(code, candidate, catalog);
    }),
  );
  if (macros.length > 128 || superkeys.length > 70)
    throw new Error("Backup definition count exceeds the UI-supported capacity");
  let macroBytes = 0;
  if (advertised.includes("macros.map")) {
    macroBytes = Number((await fresh("macros.memory")).trim().split(/\s+/)[0]);
    if (
      !Number.isInteger(macroBytes) ||
      macroBytes < 1 ||
      serializeMacros(macros, macroBytes).trim().split(/\s+/).length > macroBytes
    )
      throw new Error("Backup exceeds macro memory");
  }
  // Discover exact supported setting commands from the same registry as Preferences.
  const keyboardValues = {
    keymap: { custom: [], default: [], onlyCustom: Number(onlyCustom) },
    ledBrightness: 0,
    ledBrightnessUG: 0,
    ledIdleTimeLimit: 0,
    defaultLayer: 0,
    qukeysHoldTimeout: 1,
    qukeysOverlapThreshold: 0,
    qukeysMinHold: 1,
    qukeysMinPrior: 1,
    SuperTimeout: 1,
    SuperHoldstart: 120,
    SuperOverlapThreshold: 0,
    mouseSpeed: 0,
    mouseAccelSpeed: 0,
    mouseWheelSpeed: 1,
    mouseSpeedLimit: 0,
  } as KBDataPref;
  const wirelessValues = {
    battery: { savingMode: false },
    bluetooth: { deviceName: "" },
    rf: { channelHop: 0, power: 0 },
    brightness: 0,
    brightnessUG: 0,
    fade: 0,
    idleleds: 0,
    true_sleep: false,
    true_sleep_time: 60,
  } as WirelessInterface;
  const specs = preferenceDraft(device, keyboardValues, wirelessValues).settingSpecs;
  const plan: Array<{ command: string; value: string }> = [];
  const consumed = new Set<string>();
  const add = (command: string, value: string) => {
    if (advertised.includes(command)) {
      plan.push({ command, value });
      consumed.add(command);
    }
  };
  if (advertised.includes("macros.map")) add("macros.map", serializeMacros(macros, macroBytes));
  if (advertised.includes("superkeys.map")) add("superkeys.map", serializeSuperkeys(superkeys));
  add("keymap.custom", serializeKeymap(keys));
  add("keymap.onlyCustom", onlyCustom.trim());
  if (colors.length) add("colormap.map", serializeColormap(colors));
  if (palette.length) add("palette", serializePalette(palette, device.device.RGBWMode));
  Object.values(specs).forEach(spec => {
    if (consumed.has(spec.command) || !entries.has(spec.command)) return;
    const value = entries.get(spec.command);
    if (spec.type === "number" && (!value.trim() || !validSettingNumber(Number(value), spec)))
      throw new Error(`Backup setting ${spec.command} is outside the supported range`);
    if (spec.type === "boolean" && !["0", "1"].includes(value.trim())) throw new Error("Invalid backup boolean");
    if (spec.type === "string" && (value.length > 128 || /[\r\n\0]/.test(value)))
      throw new Error("Invalid backup text");
    add(spec.command, value);
  });
  const id = String(device.device.chipId || device.serialNumber).replace(/\s/g, "");
  let writesStarted = false;
  try {
    await recoverySave(
      device,
      id,
      plan.map(entry => () => {
        writesStarted = true;
        return device.noCacheCommand(entry.command, entry.value);
      }),
    );
    const store = Store.getStore();
    const neurons = store.get("neurons") as Array<{
      id: string;
      macros: unknown[];
      superkeys: unknown[];
      layers: unknown[];
    }>;
    const index = neurons.findIndex(neuron => neuron.id === id);
    if (index >= 0) {
      neurons[index].macros = macros;
      neurons[index].superkeys = superkeys;
      if (source.neuron.layers) neurons[index].layers = source.neuron.layers;
      store.set("neurons", neurons);
    }
    if (device.type === "virtual") {
      const { default: Backup } = await import("../api/backup");
      Backup.SaveBackup(undefined, device);
    }
    device.memoryMap.clear();
  } catch (error) {
    let effect = "Stopped before configuration writes.";
    if (writesStarted) {
      effect = "Hardware may be partially updated; the pre-write recovery backup is retained.";
      if (device.type === "virtual")
        effect = "Virtual state/file may be partially updated; no physical keyboard was written.";
    }
    throw new Error(`${effect} ${String(error)}`);
  }
  return {
    restored: true,
    target: device.type === "virtual" ? "virtual_file" : "keyboard",
    writtenCommands: plan.map(entry => entry.command),
    ignoredCommands: [...entries.keys()].filter(command => !consumed.has(command)),
    note: "Only validated configuration was written. Firmware/reset/pairing commands were not executed.",
  };
}
