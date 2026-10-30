import { z } from "zod";

const index = z.number().int().nonnegative();
export const editSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("key"),
      layer: index,
      key: index,
      keyCode: z.union([z.literal(0), z.literal(65535), z.number().int().min(4).max(231)]),
    })
    .strict(),
  z.object({ kind: z.literal("color"), layer: index, led: index, palette: index }).strict(),
]);
export const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read") }).strict(),
  z.object({ operation: z.literal("export") }).strict(),
  z
    .object({ operation: z.literal("batch"), expectedRevision: z.string(), edits: z.array(editSchema).min(1).max(256) })
    .strict(),
  z.object({ operation: z.literal("undo"), expectedRevision: z.string() }).strict(),
  z.object({ operation: z.literal("save"), expectedRevision: z.string(), confirm: z.literal(true) }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface Draft {
  deviceId: string;
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
  JSON.stringify([draft.deviceId, draft.onlyCustom, draft.keys, draft.colors, draft.palette]);
export function preflight(draft: Draft, edits: z.infer<typeof editSchema>[]): Draft {
  if (!draft.connected) throw new Error("Device disconnected. Reconnect in Bazecor.");
  const next = cloneDraft(draft);
  edits.forEach(edit => {
    if (edit.kind === "key") {
      if (!next.keys[edit.layer] || edit.key >= next.keys[edit.layer].length)
        throw new Error("Invalid custom layer or physical key index");
      // First slice intentionally permits standard HID keyboard usage IDs only.
      if (![0, 65535].includes(edit.keyCode) && (edit.keyCode < 4 || edit.keyCode > 231))
        throw new Error("Unsupported keyboard usage ID");
      next.keys[edit.layer][edit.key] = edit.keyCode;
    } else {
      if (!next.colors[edit.layer] || edit.led >= next.colors[edit.layer].length)
        throw new Error("Invalid color layer or LED index");
      if (edit.palette >= next.palette.length) throw new Error("Palette slot does not exist");
      next.colors[edit.layer][edit.led] = edit.palette;
    }
  });
  next.dirty = true;
  return next;
}

export function validateDraft(draft: Draft) {
  if (!draft.connected) throw new Error("Device disconnected");
  if (
    !draft.keys.length ||
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
    if (this.observed?.deviceId !== draft.deviceId || !draft.dirty) this.history = [];
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
  undo() {
    const previous = this.history.pop();
    if (!previous) throw new Error("Nothing to undo in this editor session.");
    this.restoring = true;
    return cloneDraft(previous);
  }
}

/** No writes before a durable recovery backup. Never convert protocol failures into success. */
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
