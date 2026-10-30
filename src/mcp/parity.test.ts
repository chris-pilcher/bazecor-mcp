import { describe, it, expect } from "vitest";
import { Draft, preflight, DraftSession, commandSchema } from "./domain";
import { actionCatalog, assertAction, layerTarget } from "./actions";
import { draftDiff, publicDraft } from "./diff";
import type { KeymapDB } from "../api/keymap";

const initial = (): Draft => ({
  editor: "layout",
  deviceId: "mock",
  deviceName: "Mock",
  virtual: true,
  connected: true,
  selectedLayer: 0,
  selectedKey: -1,
  selectedLed: -1,
  dirty: false,
  onlyCustom: true,
  defaultLayerCount: 0,
  keys: [
    [4, 5],
    [6, 7],
  ],
  colors: [
    [0, 1, 0, 1],
    [1, 0, 1, 0],
  ],
  palette: [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 40, b: 20 },
  ],
  layerNames: ["First", "Second"],
  macros: [],
  superkeys: [],
  leds: { left: [0], right: [2], underglowLeft: [1], underglowRight: [3] },
});
const accepted = (code: number, draft: Draft) =>
  assertAction(code, draft, [{ id: `keycode:${code}`, code, category: "test", label: "test" }]);
describe("practical MCP parity", () => {
  it("keeps layer copy/reset/name and RGB palette/side edits atomic", () => {
    const original = initial();
    const edits = commandSchema.parse({
      operation: "batch",
      expectedRevision: "r",
      edits: [
        { kind: "layer_copy", from: 0, to: 1, colors: true },
        { kind: "layer_name", layer: 1, name: "Work" },
        { kind: "palette", slot: 1, color: { r: 1, g: 2, b: 3 } },
        { kind: "color_side", layer: 0, side: "left", area: "underglow", palette: 0 },
      ],
    });
    if (edits.operation !== "batch") throw Error();
    const next = preflight(original, edits.edits, accepted);
    expect(next.keys[1]).toEqual([4, 5]);
    expect(next.layerNames[1]).toBe("Work");
    expect(next.palette[1]).toEqual({ r: 1, g: 2, b: 3 });
    expect(next.colors[0]).toEqual([0, 0, 0, 1]);
    expect(original).toEqual(initial());
    expect(() =>
      preflight(original, [
        { kind: "palette", slot: 1, color: { r: 1, g: 2, b: 3 } },
        { kind: "layer_copy", from: 99, to: 0 },
      ]),
    ).toThrow();
    expect(original).toEqual(initial());
    expect(() => preflight(original, [{ kind: "layer_reset", layer: 0, source: "firmware_default" }])).toThrow(
      /Explicit/,
    );
  });
  it("uses explicit default layers and custom-to-color offsets rather than numeric inheritance", () => {
    const source = {
      ...initial(),
      onlyCustom: false,
      defaultLayerCount: 1,
      defaultKeys: [[9, 10]],
      colors: [
        [1, 1, 1, 1],
        [0, 1, 0, 1],
        [1, 0, 1, 0],
      ],
    };
    const next = preflight(source, [
      { kind: "layer_copy", from: 0, to: 1, colors: true },
      { kind: "layer_reset", layer: 0, source: "firmware_default", defaultLayer: 0 },
    ]);
    expect(next.keys[0]).toEqual([9, 10]);
    expect(next.colors[0]).toEqual(source.colors[0]);
    expect(next.colors[2]).toEqual(source.colors[1]);
  });
  it("discovers device-gated actions and rejects unavailable routes including dual-use routes", () => {
    const db = {
      allCodes: [
        { groupName: "Letters", keys: [{ code: 4, labels: { primary: "A" } }] },
        { groupName: "Shift to layer", keys: [{ code: 17459, labels: { primary: "L10" } }] },
        { groupName: "Macros", keys: [{ code: 53852, labels: { primary: "M1" } }] },
        { groupName: "Layer #1 /", keys: [{ code: 51222, labels: { primary: "A" } }] },
        { groupName: "Overlay", keys: [{ code: 54112, labels: { primary: "Lens" } }] },
      ],
    } as KeymapDB;
    const minimal = actionCatalog(db, [], false, false);
    expect(minimal.map(a => a.code)).toEqual([4, 17459]);
    expect(() => assertAction(17459, initial(), minimal)).toThrow(/route/);
    const expanded = actionCatalog(db, ["qukeys.holdTimeout", "macros.map"], false, true);
    expect(expanded.some(a => a.code === 51222)).toBe(true);
    expect(expanded.some(a => a.code === 54112)).toBe(true);
    expect(layerTarget(51222)).toBe(0);
    expect(layerTarget(53014)).toBe(7);
  });
  it("rejects referenced deletes and remaps higher references without confusing delay values for key codes", () => {
    const state = {
      ...initial(),
      editor: "macros" as const,
      macros: [
        { id: 0, name: "one", macro: "", actions: [] },
        { id: 1, name: "two", macro: "", actions: [{ type: 2, keyCode: 53852 }] },
      ],
      keys: [[53853, 5]],
    };
    const next = preflight(state, [{ kind: "macro_delete", index: 0 }]);
    expect(next.keys[0][0]).toBe(53852);
    expect(next.macros[0].actions[0].keyCode).toBe(53852);
    expect(() => preflight({ ...state, keys: [[53852, 5]] }, [{ kind: "macro_delete", index: 0 }])).toThrow(
      /referenced/,
    );
    const supers = {
      ...initial(),
      editor: "superkeys" as const,
      superkeys: [{ id: 0, name: "one", actions: [4, 1, 1, 1, 1] }],
      macros: [{ id: 0, name: "uses SK", macro: "", actions: [{ type: 5, keyCode: 53980 }] }],
    };
    expect(() => preflight(supers, [{ kind: "superkey_delete", index: 0 }])).toThrow(/referenced/);
  });
  it("rejects dangling routes/references and recursive macro definitions", () => {
    const state = { ...initial(), editor: "macros" as const };
    expect(() =>
      preflight(
        state,
        [{ kind: "macro_put", index: 0, name: "loop", actions: [{ type: 5, keyCode: 53852 }] }],
        accepted,
      ),
    ).toThrow(/Recursive/);
    expect(() =>
      preflight(
        state,
        [{ kind: "macro_put", index: 0, name: "bad route", actions: [{ type: 5, keyCode: 17459 }] }],
        accepted,
      ),
    ).toThrow(/missing layer/);
    expect(() =>
      preflight(
        { ...state, superkeys: [{ id: 0, name: "indirect", actions: [53852, 1, 1, 1, 1] }] },
        [{ kind: "macro_put", index: 0, name: "indirect loop", actions: [{ type: 5, keyCode: 53980 }] }],
        accepted,
      ),
    ).toThrow(/Recursive/);
    const definitions = preflight(
      state,
      [
        { kind: "macro_put", index: 0, name: "forward", actions: [{ type: 5, keyCode: 53853 }] },
        { kind: "macro_put", index: 1, name: "target", actions: [{ type: 8, keyCode: 4 }] },
      ],
      accepted,
    );
    expect(definitions.macros.length).toBe(2);
  });
  it("redacts private macro actions in reads, creates, deletes and diffs", () => {
    const state = {
      ...initial(),
      macros: [{ id: 0, name: "private", macro: "secret text", actions: [{ type: 8, keyCode: 42 }] }],
    };
    expect(JSON.stringify(publicDraft(state))).not.toContain("keyCode");
    expect(JSON.stringify(publicDraft(state))).not.toContain("secret text");
    expect(JSON.stringify(draftDiff(initial(), state))).not.toContain("keyCode");
    expect(JSON.stringify(draftDiff(state, initial()))).not.toContain("secret text");
    expect(JSON.stringify(publicDraft(state, true))).toContain("keyCode");
  });
  it("discards to the clean baseline and blocks prototype-based fake settings", () => {
    const session = new DraftSession();
    session.observe(initial());
    session.observe(preflight(initial(), [{ kind: "layer_name", layer: 0, name: "Changed" }]));
    expect(session.discard().layerNames[0]).toBe("First");
    expect(() =>
      preflight({ ...initial(), editor: "preferences", settings: {}, settingSpecs: {} }, [
        { kind: "setting", name: "constructor", value: 1 },
      ]),
    ).toThrow(/not available/);
  });
});
