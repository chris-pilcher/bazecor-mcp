import type { Draft } from "./domain";
import { definitionReference, layerTarget } from "./actions";

export function validateDefinitions(draft: Draft, validateCode?: (code: number, draft: Draft) => void) {
  const routes = (value: number) => {
    const layer = layerTarget(value);
    if (layer !== undefined && layer >= draft.keys.length + (draft.onlyCustom ? 0 : draft.defaultLayerCount))
      throw new Error("A key, macro or Superkey routes to a missing layer");
    const ref = definitionReference(value);
    if (ref && ref.index >= (ref.kind === "macro" ? draft.macros?.length || 0 : draft.superkeys?.length || 0))
      throw new Error(`Missing ${ref.kind} reference ${ref.index}`);
  };
  draft.keys.forEach(row => row.forEach(routes));
  draft.macros?.forEach(m =>
    m.actions.forEach(a => {
      if ([3, 4, 5].includes(a.type)) routes(a.keyCode as number);
    }),
  );
  draft.superkeys?.forEach(sk =>
    sk.actions.forEach(value => {
      if (value !== 1) routes(value);
    }),
  );
  // Match the UI: Superkeys cannot contain another Superkey. Macro recursion is unsafe.
  if (draft.superkeys?.some(sk => sk.actions.some(value => definitionReference(value)?.kind === "superkey")))
    throw new Error("Nested Superkeys are not supported by this editor");
  const graph = new Map<string, string[]>();
  const edge = (value: number) => {
    const ref = definitionReference(value);
    return ref ? `${ref.kind}:${ref.index}` : undefined;
  };
  draft.macros?.forEach((macro, id) =>
    graph.set(
      `macro:${id}`,
      macro.actions
        .filter(action => [3, 4, 5].includes(action.type))
        .map(action => edge(action.keyCode as number))
        .filter(Boolean),
    ),
  );
  draft.superkeys?.forEach((superkey, id) => graph.set(`superkey:${id}`, superkey.actions.map(edge).filter(Boolean)));
  const visited = new Set<string>();
  const visit = (id: string, active: Set<string>) => {
    if (active.has(id)) throw new Error("Recursive macro/Superkey reference");
    if (visited.has(id)) return;
    const next = new Set(active).add(id);
    (graph.get(id) || []).forEach(target => visit(target, next));
    visited.add(id);
  };
  graph.forEach((_, id) => visit(id, new Set()));
  if (validateCode && draft.editor === "macros")
    draft.macros?.forEach(m =>
      m.actions.forEach(action => {
        if ([3, 4, 5, 6, 7, 8].includes(action.type)) validateCode(action.keyCode as number, draft);
      }),
    );
  // Validate new definitions through the device-aware catalog; existing legacy
  // codes remain readable and are preserved unless an operation changes them.
  if (validateCode && draft.editor === "superkeys")
    draft.superkeys?.forEach(sk =>
      sk.actions.forEach(value => {
        if (value !== 1) validateCode(value, draft);
      }),
    );
}
