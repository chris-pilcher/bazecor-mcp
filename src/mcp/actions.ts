import type { Draft } from "./domain";
import type { KeymapDB } from "../api/keymap";

export interface ActionDescriptor {
  id: string;
  code: number;
  category: string;
  label: string;
  layer?: number;
  reference?: { kind: "macro" | "superkey"; index: number };
}
const text = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const { props } = value as { props: { children?: unknown; layerNumber?: number; modifier?: string } };
    return text(props.children) || (props.layerNumber ? `Layer ${props.layerNumber}` : props.modifier || "");
  }
  return "";
};
/** Decode only firmware encodings represented in Bazecor's active picker tables. */
export function layerTarget(code: number) {
  if (code >= 17408 && code <= 17417) return code - 17408;
  if (code >= 17450 && code <= 17459) return code - 17450;
  if (code >= 17492 && code <= 17501) return code - 17492;
  if (code >= 49161 && code <= 49168) return code - 49161;
  if (code >= 51218 && code < 53266) return Math.floor((code - 51218) / 256);
  return undefined;
}
export function definitionReference(code: number): ActionDescriptor["reference"] {
  if (code >= 53852 && code < 53980) return { kind: "macro", index: code - 53852 };
  if (code >= 53980 && code < 54108) return { kind: "superkey", index: code - 53980 };
  return undefined;
}
export function actionCatalog(db: KeymapDB, commands: string[], wireless: boolean, lens: boolean): ActionDescriptor[] {
  const catalog = new Map<number, ActionDescriptor>();
  const exposed = new Set([
    "Lock layer to",
    "Shift to layer",
    "Move to layer",
    "OneShot modifiers",
    "OneShot layers",
    "LED Effect",
    "Macros",
    "SuperKeys",
    "Media",
    "Mouse movement",
    "Mouse wheel",
    "Mouse button",
    "Blank",
  ]);
  db.allCodes.forEach(group =>
    group.keys.forEach(key => {
      const { code } = key;
      const ordinary = code < 8192;
      const dual = code >= 49169 && code < 53266 && commands.includes("qukeys.holdTimeout");
      const radio = wireless && ["Battery", "Bluetooth", "Energy", "RF"].includes(group.groupName);
      // Pairing/reset commands and unused leader/steno/tapdance tables are not exposed as live tools.
      if (!ordinary && !dual && !radio && !(lens && group.groupName === "Overlay") && !exposed.has(group.groupName))
        return;
      if (group.groupName === "Macros" && !commands.includes("macros.map")) return;
      if (group.groupName === "SuperKeys" && !commands.includes("superkeys.map")) return;
      catalog.set(code, {
        id: `keycode:${code}`,
        code,
        category: group.groupName,
        label:
          [text(key.labels?.top), text(key.labels?.primary), text(key.labels?.verbose)].filter(Boolean).join(" ") ||
          `${group.groupName} ${code}`,
        layer: layerTarget(code),
        reference: definitionReference(code),
      });
    }),
  );
  return [...catalog.values()];
}
export function assertAction(code: number, draft: Draft, catalog: ActionDescriptor[]) {
  if (!catalog.some(action => action.code === code))
    throw new Error(`Action ${code} is not exposed for this device/firmware. Use list_actions.`);
  const layer = layerTarget(code);
  if (layer !== undefined && layer >= draft.keys.length + (draft.onlyCustom ? 0 : draft.defaultLayerCount))
    throw new Error(`Layer route ${layer} does not exist`);
}
