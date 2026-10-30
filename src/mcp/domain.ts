import { z } from "zod";
import { backupSchema } from "./backupSchema";
import { extraEdits, applyExtended } from "./extendedEdits";
import { validateDefinitions } from "./definitions";
import type { MacrosType } from "../renderer/types/macros";
import type { SuperkeysType } from "../renderer/types/superkeys";

const index = z.number().int().nonnegative();
export const editSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("key"),
      layer: index,
      key: index,
      keyCode: z.number().int().min(0).max(65535),
    })
    .strict(),
  z.object({ kind: z.literal("color"), layer: index, led: index, palette: index }).strict(),
  ...extraEdits,
]);
export const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("devices") }).strict(),
  z.object({ operation: z.literal("telemetry") }).strict(),
  z.object({ operation: z.literal("app_settings") }).strict(),
  z
    .object({
      operation: z.literal("app_setting"),
      name: z.enum([
        "theme",
        "deviceNickname",
        "language",
        "verbose",
        "showDefaults",
        "runInBackground",
        "lens.enabled",
        "lens.opacity",
        "lens.showUnderglow",
        "lens.overlayMode",
        "lens.overlayAutoShow",
        "lens.overlayAutoShowDuration",
        "lens.resizeMode",
      ]),
      value: z.union([z.string().max(128), z.boolean(), z.number()]),
    })
    .strict(),
  z.object({ operation: z.literal("backup_convert"), backup: backupSchema, includePrivate: z.literal(true) }).strict(),
  z.object({ operation: z.literal("backup_compare"), expectedRevision: z.string(), backup: backupSchema }).strict(),
  z
    .object({
      operation: z.literal("restore_backup"),
      expectedRevision: z.string(),
      deviceId: z.string().min(1),
      confirm: z.literal(true),
      backup: backupSchema,
    })
    .strict(),
  z.object({ operation: z.literal("backup_read"), includePrivate: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal("backup_store"), confirm: z.literal(true) }).strict(),
  z.object({ operation: z.literal("backup_import"), expectedRevision: z.string(), backup: backupSchema }).strict(),
  z.object({ operation: z.literal("connect"), deviceId: z.string().min(1), confirm: z.literal(true) }).strict(),
  z.object({ operation: z.literal("disconnect"), confirm: z.literal(true) }).strict(),
  z.object({ operation: z.literal("read"), includePrivate: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal("export"), includePrivate: z.boolean().optional() }).strict(),
  z
    .object({ operation: z.literal("batch"), expectedRevision: z.string(), edits: z.array(editSchema).min(1).max(256) })
    .strict(),
  z
    .object({
      operation: z.literal("catalog"),
      cursor: index.optional(),
      limit: z.number().int().min(1).max(250).optional(),
      query: z.string().max(100).optional(),
    })
    .strict(),
  z.object({ operation: z.literal("decode"), codes: z.array(z.number().int().min(0).max(65535)).max(256) }).strict(),
  z.object({ operation: z.literal("diff"), includePrivate: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal("discard"), expectedRevision: z.string() }).strict(),
  z
    .object({
      operation: z.literal("navigate"),

      editor: z.enum(["layout", "macros", "superkeys", "preferences", "devices"]),
    })
    .strict(),
  z.object({ operation: z.literal("undo"), expectedRevision: z.string() }).strict(),
  z.object({ operation: z.literal("save"), expectedRevision: z.string(), confirm: z.literal(true) }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface Draft {
  editor?: "layout" | "macros" | "superkeys" | "preferences";
  deviceId: string;
  firmware?: string;
  commands?: string[];
  limits?: { macros?: number; superkeys?: number; macroActions?: number; macroBytes?: number };
  macros?: MacrosType[];
  superkeys?: SuperkeysType[];
  selectedDefinition?: number;
  layerNames?: string[];
  defaultKeys?: number[][];
  settings?: Record<string, number | string | boolean>;
  settingSpecs?: Record<
    string,
    { type: "number" | "boolean" | "string"; min?: number; max?: number; command: string; specialValues?: number[] }
  >;
  leds?: { left: number[]; right: number[]; underglowLeft: number[]; underglowRight: number[] };
  deviceName: string;
  virtual: boolean;
  connected: boolean;
  selectedLayer: number;
  selectedKey: number;
  selectedLed: number;
  dirty: boolean;
  onlyCustom: boolean;
  defaultLayerCount: number;
  keys: number[][];
  colors: number[][];
  palette: Array<{ r: number; g: number; b: number }>;
}
export const cloneDraft = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft));
export const content = (draft: Draft) =>
  JSON.stringify([
    draft.deviceId,
    draft.editor,
    draft.onlyCustom,
    draft.keys,
    draft.colors,
    draft.palette,
    draft.layerNames,
    draft.macros,
    draft.superkeys,
    draft.settings,
  ]);
export function preflight(
  draft: Draft,
  edits: z.infer<typeof editSchema>[],
  validateCode?: (code: number, draft: Draft) => void,
): Draft {
  if (!draft.connected) throw new Error("Device disconnected. Reconnect in Bazecor.");
  const next = cloneDraft(draft);
  edits.forEach(edit => {
    if (
      draft.editor &&
      draft.editor !== "layout" &&
      [
        "key",
        "action",
        "color",
        "palette",
        "color_bulk",
        "color_side",
        "layer_name",
        "layer_copy",
        "layer_reset",
        "selection",
      ].includes(edit.kind)
    )
      throw new Error("Open Layout Editor for layout changes");
    if (edit.kind === "key") {
      if (!next.keys[edit.layer] || edit.key >= next.keys[edit.layer].length)
        throw new Error("Invalid custom layer or physical key index");
      // First slice intentionally permits standard HID keyboard usage IDs only.
      if (validateCode) validateCode(edit.keyCode, next);
      else if (![0, 65535].includes(edit.keyCode) && (edit.keyCode < 4 || edit.keyCode > 231))
        throw new Error("Unsupported keyboard usage ID");
      next.keys[edit.layer][edit.key] = edit.keyCode;
    } else if (edit.kind === "color") {
      if (!next.colors[edit.layer] || edit.led >= next.colors[edit.layer].length)
        throw new Error("Invalid color layer or LED index");
      if (edit.palette >= next.palette.length) throw new Error("Palette slot does not exist");
      next.colors[edit.layer][edit.led] = edit.palette;
    } else
      applyExtended(
        next,
        edit,
        validateCode ||
          (() => {
            throw new Error("Action catalog unavailable");
          }),
      );
  });
  validateDefinitions(next, validateCode);
  next.dirty = edits.every(edit => edit.kind === "selection") ? draft.dirty : true;
  return next;
}

export function validateDraft(draft: Draft) {
  if (!draft.connected) throw new Error("Device disconnected");
  if (
    (draft.editor !== "preferences" && !draft.keys.length) ||
    draft.keys.some(row => !row.length || row.some(code => !Number.isInteger(code) || code < 0 || code > 65535))
  )
    throw new Error("Invalid keymap draft");
  if (
    draft.palette.some(color =>
      [color.r, color.g, color.b].some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255),
    )
  )
    throw new Error("Invalid RGB palette");
  if (draft.colors.some(row => row.some(slot => !Number.isInteger(slot) || slot < 0 || slot >= draft.palette.length)))
    throw new Error("Invalid colormap palette reference");
}

/** Observes the UI draft. Historical copies are only for undo, never a second editable store. */
export class DraftSession {
  private serial = 0;
  private readonly epoch = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private observed: Draft | undefined;
  private history: Draft[] = [];
  private baseline: Draft | undefined;
  private restoring = false;
  get revision() {
    return `${this.epoch}:${this.serial}`;
  }
  observe(draft: Draft) {
    if (this.observed && JSON.stringify(draft) === JSON.stringify(this.observed)) return;
    if (
      !this.restoring &&
      this.observed &&
      this.observed.deviceId === draft.deviceId &&
      content(this.observed) !== content(draft)
    ) {
      this.history.push(cloneDraft(this.observed));
      if (this.history.length > 32) this.history.shift();
    }
    if (this.observed?.deviceId !== draft.deviceId || this.observed?.editor !== draft.editor || !draft.dirty)
      this.history = [];
    if (
      !this.baseline ||
      this.baseline.deviceId !== draft.deviceId ||
      this.baseline.editor !== draft.editor ||
      !draft.dirty
    )
      this.baseline = cloneDraft(draft);
    this.restoring = false;
    this.observed = cloneDraft(draft);
    this.serial += 1;
  }
  read() {
    if (!this.observed) throw new Error("Open the Layout Editor and wait for it to load.");
    return { ...cloneDraft(this.observed), revision: this.revision };
  }
  check(revision: string) {
    if (revision !== this.revision)
      throw new Error(`Revision conflict. Read the current draft (${this.revision}) and retry.`);
  }
  discard() {
    if (!this.baseline) throw new Error("No baseline in this editor session");
    this.restoring = true;
    return cloneDraft(this.baseline);
  }
  baselineDraft() {
    return this.baseline && cloneDraft(this.baseline);
  }
  undo() {
    const previous = this.history.pop();
    if (!previous) throw new Error("Nothing to undo in this editor session.");
    this.restoring = true;
    return cloneDraft(previous);
  }
}

/** No writes before a stored recovery backup. Never convert protocol failures into success. */
export async function saveWithRecovery(backup: () => Promise<void>, writes: Array<() => Promise<unknown>>) {
  await backup();
  for (const write of writes) {
    // Device.command currently returns Error objects instead of rejecting them.
    // eslint-disable-next-line no-await-in-loop
    const result = await write();
    if (typeof result !== "string")
      throw result instanceof Error
        ? result
        : new Error("Device disconnected or returned an invalid acknowledgement during save");
  }
}
