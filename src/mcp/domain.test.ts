import { describe, it, expect, vi } from "vitest";
import { Draft, DraftSession, preflight, commandSchema, saveWithRecovery, validateDraft } from "./domain";

export const draft = (): Draft => ({
  deviceId: "mock",
  deviceName: "Mock keyboard",
  virtual: true,
  connected: true,
  selectedLayer: 0,
  selectedKey: 0,
  selectedLed: 1,
  dirty: false,
  onlyCustom: true,
  defaultLayerCount: 0,
  keys: [
    [4, 5],
    [6, 7],
  ],
  colors: [
    [0, 1, 0],
    [1, 0, 1],
  ],
  palette: [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 20, b: 255 },
  ],
});
describe("live editor domain", () => {
  it("validates the full draft before saving, including palette references and color channels", () => {
    expect(() => validateDraft(draft())).not.toThrow();
    expect(() => validateDraft({ ...draft(), colors: [[999]] })).toThrow();
    expect(() => validateDraft({ ...draft(), palette: [{ r: -1, g: 0, b: 0 }] })).toThrow();
  });
  it("preflights a complete batch without mutating the original and distinguishes key and LED indices", () => {
    const original = draft();
    const next = preflight(original, [
      { kind: "key", layer: 1, key: 0, keyCode: 8 },
      { kind: "color", layer: 0, led: 2, palette: 1 },
    ]);
    expect(next.keys[1][0]).toBe(8);
    expect(next.colors[0][2]).toBe(1);
    expect(original).toEqual(draft());
    expect(() =>
      preflight(original, [
        { kind: "key", layer: 0, key: 0, keyCode: 8 },
        { kind: "color", layer: 0, led: 9, palette: 0 },
      ]),
    ).toThrow();
    expect(original).toEqual(draft());
    expect(preflight(original, [{ kind: "key", layer: 0, key: 0, keyCode: 65535 }]).keys[0][0]).toBe(65535);
    expect(() => preflight(original, [{ kind: "key", layer: 0, key: 0, keyCode: 1 }])).toThrow();
  });
  it("rejects invalid palette slots, unsupported routes and disconnected edits", () => {
    expect(() => preflight(draft(), [{ kind: "color", layer: 0, led: 0, palette: 2 }])).toThrow();
    expect(() =>
      commandSchema.parse({
        operation: "batch",
        expectedRevision: "r",
        edits: [{ kind: "key", layer: 0, key: 0, keyCode: 17451 }],
      }),
    ).toThrow();
    expect(() =>
      preflight({ ...draft(), connected: false }, [{ kind: "key", layer: 0, key: 0, keyCode: 5 }]),
    ).toThrow();
    expect(() => commandSchema.parse({ operation: "save", expectedRevision: "r" })).toThrow();
  });
  it("tracks manual edits and selection changes, detects conflicts, and undoes multiple edits", () => {
    const session = new DraftSession();
    session.observe(draft());
    const r = session.revision;
    const first = preflight(draft(), [{ kind: "key", layer: 0, key: 0, keyCode: 8 }]);
    session.observe(first);
    expect(() => session.check(r)).toThrow(/Revision conflict/);
    const second = preflight(first, [{ kind: "key", layer: 0, key: 1, keyCode: 9 }]);
    session.observe(second);
    const restored = session.undo();
    session.observe(restored);
    expect(restored.keys).toEqual(first.keys);
    const original = session.undo();
    session.observe(original);
    expect(original.keys).toEqual(draft().keys);
    expect(() => session.undo()).toThrow(/Nothing to undo/);
    const before = session.revision;
    session.observe({ ...original, selectedKey: 1 });
    expect(session.revision).not.toBe(before);
  });
  it("never reuses a revision across editor sessions or devices", () => {
    const a = new DraftSession();
    const b = new DraftSession();
    a.observe(draft());
    b.observe(draft());
    expect(a.revision).not.toBe(b.revision);
    a.observe(preflight(draft(), [{ kind: "key", layer: 0, key: 0, keyCode: 8 }]));
    a.observe({ ...draft(), deviceId: "different" });
    expect(() => a.undo()).toThrow();
  });
  it("requires durable recovery before writes and stops on protocol/disconnection failure", async () => {
    const events: string[] = [];
    await saveWithRecovery(async () => {
      events.push("backup");
    }, [
      async () => {
        events.push("write");
        return "";
      },
    ]);
    expect(events).toEqual(["backup", "write"]);
    const write = vi.fn();
    await expect(
      saveWithRecovery(async () => {
        throw new Error("disk full");
      }, [write]),
    ).rejects.toThrow("disk full");
    expect(write).not.toHaveBeenCalled();
    await expect(saveWithRecovery(async () => {}, [async () => new Error("transport failed"), write])).rejects.toThrow(
      "transport failed",
    );
    expect(write).not.toHaveBeenCalled();
    await expect(saveWithRecovery(async () => {}, [async () => undefined])).rejects.toThrow("disconnected");
  });
});
