/* eslint-disable class-methods-use-this */
import { describe, it, expect, vi } from "vitest";
import { parseMacrosRaw, serializeMacros } from "../api/parsers/macros";
import { parseSuperkeysRaw, serializeSuperkeys } from "../api/parsers/superkeys";
import { rgb2w } from "../api/color";
import { parsePaletteRaw } from "../api/parsers/palette";

vi.mock("electron-log/renderer", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../api/keymap", () => ({
  KeymapDB: class {
    parse = (code: number) => ({ label: String(code) });
  },
}));
describe("shared firmware serializers", () => {
  it("round trips intervals and delay payloads containing zero bytes without truncation", () => {
    const input = [
      {
        id: 0,
        name: "M",
        macro: "",
        actions: [
          { type: 1, keyCode: [256, 512] },
          { type: 2, keyCode: 256 },
          { type: 5, keyCode: 17451 },
          { type: 8, keyCode: 4 },
        ],
      },
    ];
    const raw = serializeMacros(input, 512);
    const parsed = parseMacrosRaw(raw, input);
    expect(parsed[0].actions).toEqual(input[0].actions);
    expect(parsed[0].name).toBe("M");
    expect(() => parseMacrosRaw("1 0", [])).toThrow(/Truncated/);
    expect(() => parseMacrosRaw("3 0 256 0 0", [])).toThrow(/byte/);
  });
  it("round trips five Superkey gestures with empty slots preserved", () => {
    const input = [{ id: 0, name: "SK", actions: [4, 17451, 1, 5, 1] }];
    const parsed = parseSuperkeysRaw(serializeSuperkeys(input), input);
    expect(parsed[0].actions).toEqual(input[0].actions);
    expect(parsed[0].name).toBe("SK");
  });
  it("reuses RGBW conversion rather than treating the white channel as a palette slot", () => {
    const rgb = { r: 120, g: 140, b: 160 };
    const wire = rgb2w(rgb);
    const parsed = parsePaletteRaw([wire.r, wire.g, wire.b, wire.w].join(" "), true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].r).toBeCloseTo(rgb.r, 0);
    expect(parsed[0].g).toBeCloseTo(rgb.g, 0);
    expect(parsed[0].b).toBeCloseTo(rgb.b, 0);
  });
});
