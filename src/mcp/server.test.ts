/* eslint-disable no-bitwise */
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import companion from "../../mcp/companion.cjs";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  web: { id: 42, send: vi.fn() },
}));
vi.mock("electron", () => ({
  app: { on: vi.fn() },
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
    on: (name: string, fn: (...args: unknown[]) => unknown) => mocks.listeners.set(name, fn),
  },
}));
vi.mock("../main/managers/Window", () => ({
  default: { getWindow: () => ({ webContents: mocks.web, isDestroyed: () => false }) },
}));
describe("authenticated local IPC", () => {
  it("uses private socket/credentials, forwards only validated commands, and disconnects clients", async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ipc-"));
    vi.spyOn(os, "homedir").mockReturnValue(temporary);
    const { configureMcp } = await import("./server");
    configureMcp();
    mocks.listeners.get("mcp:editor")?.({ sender: mocks.web }, true);
    const control = mocks.handlers.get("mcp:control");
    if (!control) throw new Error("Missing MCP control handler");
    expect(() => control({ sender: {} }, true)).toThrow(/Untrusted/);
    control({ sender: mocks.web }, true);
    const location = path.join(temporary, ".bazecor-mcp", "connection.json");
    await vi.waitFor(() => expect(fs.existsSync(location)).toBe(true));
    const credentials = JSON.parse(fs.readFileSync(location, "utf8"));
    expect(fs.statSync(location).mode & 0o777).toBe(0o600);
    expect(fs.statSync(credentials.socket).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(location)).mode & 0o777).toBe(0o700);
    const rejected = net.createConnection(credentials.socket);
    rejected.on("connect", () => rejected.write('{"token":"wrong"}\n'));
    await new Promise<void>(resolve => {
      rejected.on("close", () => resolve());
    });
    expect(mocks.web.send).not.toHaveBeenCalled();
    mocks.web.send.mockImplementation((_name, message) => {
      mocks.listeners.get("mcp:result")?.(
        { sender: mocks.web },
        { id: message.id, result: { deviceId: "mock", revision: "r1" } },
      );
    });
    const read = await companion.attach({ operation: "read" });
    expect(read).toMatchObject({ deviceId: "mock" });
    await expect(companion.attach({ operation: "shell", command: "whoami" })).rejects.toThrow();
    control({ sender: mocks.web }, false);
    expect(fs.existsSync(location)).toBe(false);
    await expect(companion.attach({ operation: "read" })).rejects.toThrow(/Enable local MCP/);
    vi.restoreAllMocks();
    fs.rmSync(temporary, { recursive: true, force: true });
  });
});
