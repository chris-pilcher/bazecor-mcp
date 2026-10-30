import { validateIntegerStream, validSettingNumber } from "./wireValidation";
import { backupSchema } from "./backupSchema";
import type Device from "../api/comms/Device";
import type { Draft } from "./domain";
import Backup from "../api/backup";
import Store from "../renderer/utils/Store";
import { parseKeymapRaw, parseMacrosRaw, parseSuperkeysRaw, parsePaletteRaw, parseColormapRaw } from "../api/parsers";
import { commandsFor } from "./deviceDraft";

export async function readBackup(device: Device, includePrivate: boolean, store = false) {
  if (!device || device.isClosed) throw new Error("Connect a device first");
  let result: unknown;
  let storedPath: string | undefined;
  if (device.type === "virtual") {
    const id = String(device.device.chipId || device.serialNumber).replace(/\s/g, "");
    const neurons = Store.getStore().get("neurons") as Array<{ id: string }>;
    const metadata = neurons.find(neuron => neuron.id === id);
    result = {
      neuronID: id,
      neuron: { layers: [], macros: [], superkeys: [], ...metadata, device: device.device },
      backup: Object.entries(device.fileData.virtual).map(([command, entry]) => ({
        command,
        data: String(entry.data),
      })),
    };
    if (store)
      throw new Error("Use export_backup for a virtual device; save_to_keyboard persists its UI-selected virtual file");
  } else {
    const uncached = Object.create(device) as Device;
    uncached.command = device.noCacheCommand.bind(device);
    const id = String(device.device?.chipId || "").replace(/\s/g, "");
    result = await new Backup().DoBackup(await Backup.Commands(uncached), id, uncached);
    const validated = backupSchema.parse(result);
    if (validated.backup.some(entry => typeof entry.data !== "string")) throw new Error("Backup read failed");
    if (
      store &&
      !Backup.SaveBackup(result as Parameters<typeof Backup.SaveBackup>[0], device, true, filePath => {
        storedPath = filePath;
      })
    )
      throw new Error("Backup storage failed");
  }
  const backup = JSON.parse(JSON.stringify(result));
  if (!includePrivate) {
    backup.backup = backup.backup.filter((entry: { command: string }) => entry.command !== "macros.map");
    backup.neuron.macros = (backup.neuron.macros || []).map(
      (macro: { id: number; name: string; actions?: unknown[] }) => ({
        id: macro.id,
        name: macro.name,
        actionCount: macro.actions?.length,
        privateActionsOmitted: true,
      }),
    );
  }
  return {
    backup,
    privateContentIncluded: includePrivate,
    restorable: includePrivate,
    stored: store,
    ...(store ? { storedPath, storedBackupIncludesPrivate: true, storedBackupRestorable: true } : {}),
    note: store
      ? "Stored in Bazecor's configured backup folder"
      : "Hardware/virtual saved state, not the unsaved UI draft",
  };
}
export function importBackup(device: Device, input: unknown, current: Draft) {
  const source = backupSchema.parse(input);
  if (
    source.neuron.device.info.product !== device.device.info.product ||
    source.neuron.device.info.keyboardType !== device.device.info.keyboardType
  )
    throw new Error("Backup device type differs. Use the UI's explicit conversion workflow for cross-device recovery.");
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
  const next: Draft = JSON.parse(JSON.stringify(current));
  const applied = new Set<string>();
  const take = (command: string) => {
    if (!entries.has(command)) return undefined;
    if (!commandsFor(device).includes(command)) throw new Error(`Firmware does not advertise ${command}`);
    applied.add(command);
    return entries.get(command);
  };
  if (current.editor === "layout") {
    const custom = take("keymap.custom");
    const colors = take("colormap.map");
    const palette = take("palette");
    if (custom !== undefined) {
      next.keys = parseKeymapRaw(custom, current.keys[0].length);
      if (
        next.keys.length !== current.keys.length ||
        next.keys.some((row, index) => row.length !== current.keys[index].length)
      )
        throw new Error("Backup keymap dimensions differ");
    }
    if (colors !== undefined) {
      next.colors = parseColormapRaw(colors, current.colors[0]?.length || 1);
      if (
        next.colors.length !== current.colors.length ||
        next.colors.some((row, index) => row.length !== current.colors[index].length)
      )
        throw new Error("Backup colormap dimensions differ");
    }
    if (palette !== undefined) {
      next.palette = parsePaletteRaw(palette, device.device.RGBWMode).map(color => ({
        r: color.r,
        g: color.g,
        b: color.b,
      }));
      if (next.palette.length !== current.palette.length) throw new Error("Backup palette dimensions differ");
    }
    if (source.neuron.layers && next.layerNames)
      next.layerNames = current.layerNames.map(
        (name, index) =>
          source.neuron.layers[index + (current.onlyCustom ? 0 : current.defaultLayerCount)]?.name || name,
      );
  } else if (current.editor === "macros" || current.editor === "superkeys") {
    const custom = take("keymap.custom");
    if (custom !== undefined) {
      next.keys = parseKeymapRaw(custom, current.keys[0].length);
      if (JSON.stringify(next.keys.map(row => row.length)) !== JSON.stringify(current.keys.map(row => row.length)))
        throw new Error("Backup keymap dimensions differ");
    }
    const macros = take("macros.map");
    const superkeys = take("superkeys.map");
    if (macros !== undefined) next.macros = parseMacrosRaw(macros, source.neuron.macros as Draft["macros"]);
    if (superkeys !== undefined)
      next.superkeys = parseSuperkeysRaw(superkeys, (source.neuron.superkeys || []) as Draft["superkeys"]);
  } else if (current.editor === "preferences") {
    Object.entries(current.settingSpecs || {}).forEach(([name, spec]) => {
      const raw = take(spec.command);
      if (raw === undefined) return;
      let value: string | number | boolean = raw;
      if (spec.type === "boolean") value = raw.trim() === "1";
      else if (spec.type === "number") value = Number(raw);
      if (spec.type === "number" && (!raw.trim() || !validSettingNumber(value, spec)))
        throw new Error(`Backup setting ${name} is outside the current device range`);
      if (spec.type === "boolean" && !["0", "1"].includes(raw.trim())) throw new Error("Invalid backup boolean");
      if (typeof value === "string" && /[\r\n\0]/.test(value)) throw new Error("Invalid backup setting text");
      next.settings[name] = value;
    });
  }
  if (!applied.size) throw new Error("Backup has no supported configuration for this editor");
  next.dirty = true;
  return { draft: next, ignoredCommands: [...entries.keys()].filter(command => !applied.has(command)) };
}

/** Explicit read-only conversion using upstream's existing conversion functions. */
export function convertBackup(device: Device, input: unknown) {
  if (!device || device.isClosed) throw new Error("Connect the intended target device first");
  const backup = backupSchema.parse(input);
  for (const command of ["keymap.custom", "palette", "colormap.map"])
    if (!backup.backup.some(entry => entry.command === command))
      throw new Error("Complete layout data is required for conversion");
  backup.backup.forEach(entry => {
    if (["keymap.custom", "superkeys.map"].includes(entry.command)) validateIntegerStream(entry.data, 65535);
    if (["palette", "macros.map", "colormap.map"].includes(entry.command)) validateIntegerStream(entry.data, 255);
  });
  const source = backup.neuron.device.info.product;
  const target = device.device.info.product;
  let converted: unknown;
  const typed = backup as unknown as Parameters<typeof Backup.convertRaiseToRaise2>[0];
  if (source === "Raise" && target === "Raise2") converted = Backup.convertRaiseToRaise2(typed, device);
  else if (source === "Raise2" && target === "Raise") converted = Backup.convertRaise2ToRaise(typed, device);
  else if (source === "Defy" && target === "Sonsei") converted = Backup.convertDefyToSonsei(typed, device);
  else throw new Error("No upstream conversion exists for this source/target pair");
  return {
    backup: { ...backup, neuron: { ...backup.neuron, device: device.device }, backup: converted },
    note: "Converted only; no hardware was written. Compare/validate against the target before explicitly restoring.",
  };
}
