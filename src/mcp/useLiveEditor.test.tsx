import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act, cleanup } from "@testing-library/react";
import { useLiveEditor } from "./useLiveEditor";
import { Draft, saveWithRecovery } from "./domain";

const ipc = vi.hoisted(() => ({ listeners: new Map<string, (...args: unknown[]) => void>(), send: vi.fn() }));
vi.mock("electron", () => ({
  ipcRenderer: {
    on: (name: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(name, fn),
    removeListener: (name: string) => ipc.listeners.delete(name),
    send: (...args: unknown[]) => ipc.send(...args),
  },
}));
const initial: Draft = {
  deviceId: "test",
  deviceName: "mock",
  virtual: true,
  connected: true,
  selectedLayer: 0,
  selectedKey: 0,
  selectedLed: 0,
  dirty: false,
  onlyCustom: true,
  defaultLayerCount: 0,
  keys: [[4, 5]],
  colors: [[0, 1]],
  palette: [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 0, b: 255 },
  ],
};
const transport = { backup: vi.fn(async () => {}), write: vi.fn(async (): Promise<unknown> => "") };
function Harness({ hardware = false }: { hardware?: boolean }) {
  const [draft, setDraft] = useState({ ...initial, virtual: !hardware, dirty: hardware });
  const live = useLiveEditor({
    draft,
    ready: true,
    saving: false,
    apply: setDraft,
    save: async assertUnchanged => {
      try {
        await saveWithRecovery(async () => {
          await transport.backup();
          assertUnchanged();
        }, [transport.write]);
        setDraft({ ...draft, dirty: false });
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
  });
  return (
    <>
      <pre data-testid="draft">{JSON.stringify(draft)}</pre>
      <button type="button" onClick={() => setDraft({ ...draft, keys: [[9, 5]], dirty: true })}>
        Manual
      </button>
      <button type="button" onClick={() => live.editKey(0, 1, 10)}>
        Picker
      </button>
    </>
  );
}
async function request(command: unknown) {
  ipc.send.mockClear();
  await act(async () => {
    await ipc.listeners.get("mcp:command")?.({}, { id: 1, command });
  });
  await waitFor(() => expect(ipc.send).toHaveBeenCalled());
  return ipc.send.mock.calls[0][1] as { result?: Draft & { revision: string }; error?: string };
}
beforeEach(() => {
  cleanup();
  ipc.listeners.clear();
  ipc.send.mockClear();
});
describe("MCP and React share one draft", () => {
  it("runs explicit save through a mock device, retaining dirty state on a transport failure", async () => {
    transport.backup.mockClear();
    transport.write.mockClear();
    transport.write.mockResolvedValueOnce(new Error("Mock transport disconnected"));
    render(<Harness hardware />);
    let current = await request({ operation: "read" });
    const failed = await request({ operation: "save", expectedRevision: current.result.revision, confirm: true });
    expect(failed.error).toMatch(/disconnected/);
    expect((await request({ operation: "read" })).result.dirty).toBe(true);
    expect(transport.backup).toHaveBeenCalledOnce();
    current = await request({ operation: "read" });
    ipc.send.mockClear();
    await act(async () => {
      ipc.listeners.get("mcp:command")?.(
        {},
        { id: 3, command: { operation: "save", expectedRevision: current.result.revision, confirm: true } },
      );
    });
    await waitFor(() => expect(ipc.send).toHaveBeenCalled());
    expect(ipc.send.mock.calls[0][1].result.dirty).toBe(false);
    expect(transport.write).toHaveBeenCalledTimes(2);
  });
  it("reflects manual edits, rejects stale writes, stages visible batches, and undoes", async () => {
    render(<Harness />);
    const original = await request({ operation: "read" });
    fireEvent.click(screen.getByText("Manual"));
    const manual = await request({ operation: "read" });
    expect(manual.result.keys[0][0]).toBe(9);
    const stale = await request({
      operation: "batch",
      expectedRevision: original.result.revision,
      edits: [{ kind: "key", layer: 0, key: 0, keyCode: 8 }],
    });
    expect(stale.error).toMatch(/Revision conflict/);
    // Dispatch without awaiting inside act: completion resolves after React commits.
    ipc.send.mockClear();
    await act(async () => {
      ipc.listeners.get("mcp:command")?.(
        {},
        {
          id: 2,
          command: {
            operation: "batch",
            expectedRevision: manual.result.revision,
            edits: [{ kind: "color", layer: 0, led: 1, palette: 0 }],
          },
        },
      );
    });
    await waitFor(() => expect(ipc.send).toHaveBeenCalled());
    expect(JSON.parse(screen.getByTestId("draft").textContent).colors[0][1]).toBe(0);
    const staged = await request({ operation: "read" });
    ipc.send.mockClear();
    await act(async () => {
      ipc.listeners.get("mcp:command")?.(
        {},
        { id: 3, command: { operation: "undo", expectedRevision: staged.result.revision } },
      );
    });
    await waitFor(() => expect(ipc.send).toHaveBeenCalled());
    expect(JSON.parse(screen.getByTestId("draft").textContent).colors[0][1]).toBe(1);
    fireEvent.click(screen.getByText("Picker"));
    expect((await request({ operation: "read" })).result.keys[0][1]).toBe(10);
  });
});
