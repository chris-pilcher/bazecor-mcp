import type { Draft } from "./domain";

export function publicDraft(draft: Draft, includePrivate = false) {
  const result = JSON.parse(JSON.stringify(draft));
  if (!includePrivate && result.macros)
    result.macros = (draft.macros || []).map(m => ({
      id: m.id,
      name: m.name,
      actionCount: m.actions.length,
      privateActionsOmitted: true,
    }));
  return result;
}
export function draftDiff(before: Draft, after: Draft, includePrivate = false) {
  const changes: Array<{ path: string; before: unknown; after: unknown }> = [];
  let total = 0;
  const compare = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (path === "macros" && !includePrivate) {
      const summarize = (value: unknown) =>
        Array.isArray(value) ? value.map(m => ({ id: m.id, name: m.name, actionCount: m.actions?.length })) : value;
      compare(summarize(a), summarize(b), "macroSummaries");
      total += 1;
      if (changes.length < 256)
        changes.push({ path: "macros.actions", before: "[private]", after: "[private sequence changed]" });
      return;
    }
    if (path.match(/^macros\.\d+\.(actions|macro)/) && !includePrivate) {
      total += 1;
      if (changes.length < 256) changes.push({ path, before: "[private]", after: "[private sequence changed]" });
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach(key =>
        compare(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        ),
      );
      return;
    }
    total += 1;
    if (changes.length < 256) changes.push({ path, before: a, after: b });
  };
  ["keys", "colors", "palette", "layerNames", "macros", "superkeys", "settings", "onlyCustom"].forEach(key =>
    compare(before[key as keyof Draft], after[key as keyof Draft], key),
  );
  return { changes, totalChanges: total, truncated: total > changes.length };
}
