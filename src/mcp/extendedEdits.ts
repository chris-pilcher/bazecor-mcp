/* eslint-disable no-param-reassign */
// Mutations below apply only to preflight's transient candidate copy.
import { z } from "zod";
import { validSettingNumber } from "./wireValidation";
import type { Draft } from "./domain";
import { definitionReference } from "./actions";

const index = z.number().int().nonnegative();
const code = z.number().int().min(0).max(65535);
const rgb = z
  .object({
    r: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    b: z.number().int().min(0).max(255),
  })
  .strict();
export const macroAction = z.union([
  z.object({ type: z.literal(1), keyCode: z.tuple([code, code]) }).strict(),
  z.object({ type: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), keyCode: code }).strict(),
  z
    .object({ type: z.union([z.literal(6), z.literal(7), z.literal(8)]), keyCode: z.number().int().min(0).max(255) })
    .strict(),
]);
export const extraEdits = [
  z
    .object({
      kind: z.literal("color_side"),
      layer: index,
      side: z.enum(["left", "right", "both"]),
      area: z.enum(["keys", "underglow", "all"]),
      palette: index,
    })
    .strict(),
  z
    .object({ kind: z.literal("action"), layer: index, key: index, actionId: z.string().regex(/^keycode:\d+$/) })
    .strict(),
  z.object({ kind: z.literal("palette"), slot: index, color: rgb }).strict(),
  z
    .object({ kind: z.literal("color_bulk"), layer: index, leds: z.array(index).min(1).max(1024), palette: index })
    .strict(),
  z.object({ kind: z.literal("layer_name"), layer: index, name: z.string().max(128) }).strict(),
  z.object({ kind: z.literal("layer_copy"), from: index, to: index, colors: z.boolean().optional() }).strict(),
  z
    .object({
      kind: z.literal("layer_reset"),
      layer: index,
      source: z.enum(["transparent", "disabled", "firmware_default"]),
      defaultLayer: index.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("macro_put"),
      index,
      name: z.string().max(128),
      actions: z.array(macroAction).max(4096),
    })
    .strict(),
  z.object({ kind: z.literal("macro_delete"), index }).strict(),
  z
    .object({
      kind: z.literal("superkey_put"),
      index,
      name: z.string().max(128),
      actions: z.array(code).length(5),
    })
    .strict(),
  z.object({ kind: z.literal("superkey_delete"), index }).strict(),
  z
    .object({
      kind: z.literal("setting"),
      name: z.string().max(100),
      value: z.union([z.number(), z.boolean(), z.string().max(128)]),
    })
    .strict(),
  z.object({ kind: z.literal("selection"), layer: index, key: index.optional(), led: index.optional() }).strict(),
] as const;
export type ExtendedEdit = z.infer<(typeof extraEdits)[number]>;
export function applyExtended(input: Draft, edit: ExtendedEdit, validateCode: (code: number, draft: Draft) => void) {
  // Mutate only the transient copy owned by preflight, never React state.
  const draft = input;
  const layer = (id: number) => {
    if (!draft.keys[id]) throw new Error("Custom layer does not exist");
    return draft.keys[id];
  };
  switch (edit.kind) {
    case "action": {
      const value = Number(edit.actionId.slice(8));
      validateCode(value, draft);
      if (edit.key >= layer(edit.layer).length) throw new Error("Physical key does not exist");
      draft.keys[edit.layer][edit.key] = value;
      break;
    }
    case "palette":
      if (!draft.palette[edit.slot]) throw new Error("Palette slot does not exist");
      draft.palette[edit.slot] = { r: edit.color.r, g: edit.color.g, b: edit.color.b };
      break;
    case "color_side": {
      if (!draft.leds) throw new Error("Device LED geometry unavailable");
      const regions = {
        keys: ["left", "right"],
        underglow: ["underglowLeft", "underglowRight"],
        all: ["left", "right", "underglowLeft", "underglowRight"],
      };
      const groups = regions[edit.area];
      const indices = groups
        .filter(group => edit.side === "both" || group.toLowerCase().includes(edit.side))
        .flatMap(group => draft.leds[group as keyof typeof draft.leds]);
      if (!indices.length) throw new Error("No LEDs in that device region");
      applyExtended(
        draft,
        { kind: "color_bulk", layer: edit.layer, leds: indices, palette: edit.palette },
        validateCode,
      );
      break;
    }
    case "color_bulk":
      edit.leds.forEach(led => {
        if (!draft.colors[edit.layer] || led >= draft.colors[edit.layer].length || !draft.palette[edit.palette])
          throw new Error("Invalid LED or palette index");
        draft.colors[edit.layer][led] = edit.palette;
      });
      break;
    case "layer_name":
      layer(edit.layer);
      if (!draft.layerNames) throw new Error("Layer naming is unavailable in this editor");
      draft.layerNames[edit.layer] = edit.name;
      break;
    case "layer_copy":
      layer(edit.to);
      draft.keys[edit.to] = layer(edit.from).slice();
      if (edit.colors) {
        const offset = draft.onlyCustom ? 0 : draft.defaultLayerCount;
        if (!draft.colors[edit.from + offset] || !draft.colors[edit.to + offset])
          throw new Error("Color layer unavailable");
        draft.colors[edit.to + offset] = draft.colors[edit.from + offset].slice();
      }
      break;
    case "layer_reset": {
      const existing = layer(edit.layer);
      if (edit.source === "firmware_default") {
        if (
          edit.defaultLayer === undefined ||
          !draft.defaultKeys?.[edit.defaultLayer] ||
          draft.defaultKeys[edit.defaultLayer].length !== existing.length
        )
          throw new Error("Explicit compatible firmware default layer is required; inheritance is never inferred");
        draft.keys[edit.layer] = draft.defaultKeys[edit.defaultLayer].slice();
      } else draft.keys[edit.layer] = existing.map(() => (edit.source === "disabled" ? 0 : 65535));
      break;
    }
    case "macro_put":
      if (
        draft.editor !== "macros" ||
        !draft.macros ||
        edit.index > draft.macros.length ||
        edit.index >= (draft.limits?.macros || 128)
      )
        throw new Error("Open Macro Editor; use an existing index or append at the next index");
      if (edit.actions.length > (draft.limits?.macroActions || 4096))
        throw new Error("Macro action count exceeds the device UI limit");
      draft.macros[edit.index] = {
        id: edit.index,
        name: edit.name,
        macro: "",
        actions: edit.actions.map(action => ({
          type: action.type,
          keyCode: Array.isArray(action.keyCode) ? action.keyCode.map(Number) : Number(action.keyCode),
        })),
      };
      break;
    case "superkey_put":
      if (
        draft.editor !== "superkeys" ||
        !draft.superkeys ||
        edit.index > draft.superkeys.length ||
        edit.index >= (draft.limits?.superkeys || 70)
      )
        throw new Error("Open Superkeys Editor; use an existing index or append at the next index");
      if (edit.actions.some(value => value === 0))
        throw new Error("Use 1 for an empty Superkey gesture; 0 is the wire terminator");
      draft.superkeys[edit.index] = {
        id: edit.index,
        name: edit.name,
        actions: edit.actions,
      };
      break;
    case "macro_delete":
    case "superkey_delete": {
      const kind = edit.kind === "macro_delete" ? "macro" : "superkey";
      if (draft.editor !== (kind === "macro" ? "macros" : "superkeys"))
        throw new Error("Open the matching definition editor");
      const list = kind === "macro" ? draft.macros : draft.superkeys;
      if (!list?.[edit.index]) throw new Error("Definition does not exist");
      const used = (value: number) => {
        const ref = definitionReference(value);
        return ref?.kind === kind && ref.index === edit.index;
      };
      if (
        draft.keys.some(row => row.some(used)) ||
        draft.superkeys?.some(sk => sk.actions.some(used)) ||
        draft.macros?.some(m => m.actions.some(a => [3, 4, 5].includes(a.type) && used(a.keyCode as number)))
      )
        throw new Error("Definition is referenced. Remove its references explicitly before deleting.");
      const remap = (value: number) => {
        const ref = definitionReference(value);
        return ref?.kind === kind && ref.index > edit.index ? value - 1 : value;
      };
      list.splice(edit.index, 1);
      list.forEach((entry, id) => {
        entry.id = id;
      });
      draft.keys = draft.keys.map(row => row.map(remap));
      draft.superkeys?.forEach(sk => {
        sk.actions = sk.actions.map(remap);
      });
      draft.macros?.forEach(m =>
        m.actions.forEach(a => {
          if ([3, 4, 5].includes(a.type)) a.keyCode = remap(a.keyCode as number);
        }),
      );
      break;
    }
    case "setting": {
      const spec = draft.settingSpecs?.[edit.name];
      if (!Object.prototype.hasOwnProperty.call(draft.settingSpecs || {}, edit.name) || !spec || !draft.settings)
        throw new Error("Setting is not available for this editor/device. Read settingSpecs.");
      if (spec.type === "number" && !validSettingNumber(edit.value, spec))
        throw new Error(
          `Setting ${edit.name} requires an integer in ${spec.min}..${spec.max}, or a listed special value`,
        );
      if (spec.type === "boolean" && typeof edit.value !== "boolean") throw new Error("Setting requires a boolean");
      if (spec.type === "string" && (typeof edit.value !== "string" || /[\r\n\0]/.test(edit.value)))
        throw new Error("Setting requires single-line text");
      draft.settings[edit.name] = edit.value;
      break;
    }
    case "selection":
      layer(edit.layer);
      draft.selectedLayer = edit.layer + (draft.onlyCustom ? 0 : draft.defaultLayerCount);
      if (edit.key !== undefined) {
        if (edit.key >= draft.keys[edit.layer].length) throw new Error("Invalid physical key index");
        draft.selectedKey = edit.key;
      }
      if (edit.led !== undefined) {
        if (!draft.colors[edit.layer] || edit.led >= draft.colors[edit.layer].length)
          throw new Error("Invalid LED index");
        draft.selectedLed = edit.led;
      }
      break;
    default:
      throw new Error("Unsupported edit");
  }
}
