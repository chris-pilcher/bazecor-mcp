import type { Draft } from "./domain";
import { actionCatalog, ActionDescriptor } from "./actions";
import { KeymapDB } from "../api/keymap";
import type Device from "../api/comms/Device";
import Store from "../renderer/utils/Store";
import Backup from "../api/backup";
import { saveWithRecovery } from "./domain";

const store = Store.getStore();
export function commandsFor(device: Device): string[] {
  if (!device) return [];
  if (device.type === "virtual") return Object.keys(device.fileData?.virtual || {});
  // Older editor sessions discarded commands.help while replacing the language
  // keymap. A cached help response is still firmware-advertised capability data.
  const raw = device.commands?.help ?? device.memoryMap?.get("help");
  return (Array.isArray(raw) ? raw : String(raw || "").split(/\r?\n/))
    .map(command => String(command).trim().split(/\s+/)[0])
    .filter(Boolean);
}
const catalogs = new WeakMap<Device, { signature: string; actions: ActionDescriptor[] }>();
export function catalogFor(device: Device, db: KeymapDB) {
  if (!device) return [];
  const commands = commandsFor(device);
  const wireless = !!device.device?.wireless || device.device?.info?.keyboardType === "wireless";
  const lens = [true, 1, "true", "1"].includes(store.get("capabilities.lens") as boolean | number | string);
  const signature = JSON.stringify([commands, db.language, wireless, lens]);
  const existing = catalogs.get(device);
  if (existing?.signature === signature) return existing.actions;
  const actions = actionCatalog(db, commands, wireless, lens);
  catalogs.set(device, { signature, actions });
  return actions;
}
export function baseDraft(device: Device, id: string, editor: Draft["editor"]): Draft {
  return {
    editor,
    deviceId: id,
    deviceName: String(device?.device?.info?.product || ""),
    virtual: device?.type === "virtual",
    connected: !!device && !device.isClosed,
    firmware: device?.memoryMap.get("version"),
    commands: commandsFor(device),
    selectedLayer: 0,
    selectedKey: -1,
    selectedLed: -1,
    dirty: false,
    onlyCustom: true,
    defaultLayerCount: 0,
    keys: [],
    colors: [],
    palette: [],
  };
}
const writingDevices = new WeakSet<Device>();
export async function recoverySave(
  device: Device,
  id: string,
  writes: Array<() => Promise<unknown>>,
  assertUnchanged: () => void = () => {},
) {
  if (!device || device.isClosed) throw new Error("Device disconnected");
  if (writingDevices.has(device)) throw new Error("Another hardware save is in progress for this device");
  writingDevices.add(device);
  try {
    await saveWithRecovery(async () => {
      if (!device || device.isClosed) throw new Error("Device disconnected");
      if (device.type !== "virtual") {
        const uncached = Object.create(device) as Device;
        uncached.command = device.noCacheCommand.bind(device);
        const backup = await new Backup().DoBackup(await Backup.Commands(uncached), id, uncached);
        if (!backup || backup.backup.some(entry => typeof entry.data !== "string"))
          throw new Error("Recovery backup failed");
        if (!Backup.SaveBackup(backup, device, true)) throw new Error("Could not store recovery backup");
      }
      assertUnchanged();
    }, writes);
  } catch (error) {
    device?.memoryMap.clear();
    throw error;
  } finally {
    writingDevices.delete(device);
  }
}
