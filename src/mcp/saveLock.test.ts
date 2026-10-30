import { describe, it, expect, vi } from "vitest";
import { recoverySave } from "./deviceDraft";
import type Device from "../api/comms/Device";

vi.mock("../renderer/utils/Store", () => ({ default: { getStore: () => ({ get: vi.fn() }) } }));
vi.mock("../api/backup", () => ({ default: class {} }));
describe("shared device write gate", () => {
  it("rejects overlapping UI/MCP saves, then releases the gate after success and failure", async () => {
    const device = { type: "virtual", isClosed: false, memoryMap: { clear: vi.fn() } } as unknown as Device;
    let release: (value: string) => void = () => {};
    const held = new Promise<string>(resolve => {
      release = resolve;
    });
    const first = recoverySave(device, "mock", [() => held]);
    await expect(recoverySave(device, "mock", [async () => ""])).rejects.toThrow(/in progress/);
    release("");
    await first;
    await expect(recoverySave(device, "mock", [async () => new Error("transport")])).rejects.toThrow(/transport/);
    expect(device.memoryMap.clear).toHaveBeenCalled();
    await expect(recoverySave(device, "mock", [async () => ""])).resolves.toBeUndefined();
  });
});
