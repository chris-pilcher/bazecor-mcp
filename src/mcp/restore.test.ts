/* eslint-disable class-methods-use-this */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { restoreConfiguration } from "./restore";
import type Device from "../api/comms/Device";

const state = vi.hoisted(() => ({
  events: [] as string[],
  failRecovery: false,
  neurons: [{ id: "mock", macros: [] as unknown[], superkeys: [] as unknown[], layers: [] as unknown[] }],
}));
vi.mock("electron-log/renderer", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../renderer/utils/Store", () => ({
  default: { getStore: () => ({ get: () => state.neurons, set: vi.fn() }) },
}));
vi.mock("../api/keymap", () => ({
  KeymapDB: class {
    parse = (code: number) => ({ keyCode: code, label: String(code) });
    serialize = (value: { keyCode: number }) => value.keyCode;
  },
}));
vi.mock("./deviceDraft", async () => {
  const { saveWithRecovery } = await import("./domain");
  return {
    commandsFor: (device: { commands: { help: string[] } }) => device.commands.help,
    catalogFor: () =>
      [0, 4, 5, 6, 7, 65535].map(code => ({ code, id: `keycode:${code}`, category: "test", label: String(code) })),
    recoverySave: (_device: unknown, _id: string, writes: Array<() => Promise<unknown>>) =>
      saveWithRecovery(async () => {
        state.events.push("recovery");
        if (state.failRecovery) throw Error("disk full");
      }, writes),
  };
});
const values = {
  "keymap.custom": "4 5 6 7",
  "keymap.default": "4 5",
  "keymap.onlyCustom": "1",
  palette: "0 0 0 255 0 0",
  "colormap.map": "0 1 1 0",
  "macros.map": "8 4 0 0",
  "macros.memory": "128",
  "superkeys.map": "4 1 1 1 1 0 0",
  "settings.defaultLayer": "0",
};
function fixture(failure = "") {
  const cache = new Map(Object.entries(values));
  return {
    type: "serial",
    serialNumber: "mock",
    isClosed: false,
    device: {
      chipId: "mock",
      info: { product: "Raise", keyboardType: "ANSI" },
      keyboard: { rows: 1, columns: 2, ledsLeft: [0], ledsRight: [1] },
      keyboardUnderglow: { rows: 0, columns: 0, ledsLeft: [], ledsRight: [] },
      RGBWMode: false,
    },
    commands: { help: Object.keys(values) },
    memoryMap: cache,
    noCacheCommand: vi.fn(async (command: string, ...args: string[]) => {
      if (args.length) {
        state.events.push(`write:${command}`);
        if (command === failure) return new Error("transport disconnected");
        cache.set(command, args.join(" "));
        return "";
      }
      return cache.get(command);
    }),
  } as unknown as Device;
}
const backup = () => ({
  neuron: {
    device: { info: { product: "Raise", keyboardType: "ANSI" } },
    layers: [
      { id: 0, name: "One" },
      { id: 1, name: "Two" },
    ],
    macros: [{ id: 0, name: "M" }],
    superkeys: [{ id: 0, name: "SK" }],
  },
  backup: [
    ...Object.entries(values)
      .filter(([command]) => !["keymap.default", "macros.memory"].includes(command))
      .map(([command, data]) => ({ command, data })),
    { command: "firmware.flash", data: "never execute" },
    { command: "wireless.rf.syncPairing", data: "never execute" },
  ],
});
beforeEach(() => {
  state.events.length = 0;
  state.failRecovery = false;
});
describe("configuration-only full backup restore", () => {
  it("validates a complete plan, backs up first, and never writes unknown or dangerous commands", async () => {
    const result = await restoreConfiguration(fixture(), backup());
    expect(result.restored).toBe(true);
    expect(state.events[0]).toBe("recovery");
    expect(result.ignoredCommands).toContain("firmware.flash");
    expect(result.ignoredCommands).toContain("wireless.rf.syncPairing");
    expect(state.events).not.toContain("write:firmware.flash");
    expect(state.events).not.toContain("write:wireless.rf.syncPairing");
    expect(state.events).toContain("write:keymap.custom");
    expect(state.events).toContain("write:palette");
  });
  it("rejects incompatible devices, noninteger wire data and missing private macro data before writes", async () => {
    const wrong = backup();
    wrong.neuron.device.info.product = "Defy";
    await expect(restoreConfiguration(fixture(), wrong)).rejects.toThrow(/differs/);
    const malformed = backup();
    malformed.backup.find(e => e.command === "palette").data = "0.5 0 0 255 0 0";
    await expect(restoreConfiguration(fixture(), malformed)).rejects.toThrow(/integer/);
    const partial = backup();
    partial.backup = partial.backup.filter(e => e.command !== "macros.map");
    await expect(restoreConfiguration(fixture(), partial)).rejects.toThrow(/Complete/);
    expect(state.events).toEqual([]);
  });
  it("preserves recovery-before-write ordering and stops after a protocol error", async () => {
    state.failRecovery = true;
    await expect(restoreConfiguration(fixture(), backup())).rejects.toThrow(/disk full/);
    expect(state.events).toEqual(["recovery"]);
    state.events.length = 0;
    state.failRecovery = false;
    await expect(restoreConfiguration(fixture("keymap.custom"), backup())).rejects.toThrow(/transport/);
    expect(state.events).toEqual(["recovery", "write:macros.map", "write:superkeys.map", "write:keymap.custom"]);
  });
});
