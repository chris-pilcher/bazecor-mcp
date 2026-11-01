/* eslint-disable no-bitwise */
import { MacroActionsType, MacrosType } from "@Renderer/types/macros";
import { KeymapDB } from "../keymap";

const macrosEraser = (tMem: number) => Array(tMem).fill("255").join(" ");

export const parseMacrosRaw = (raw: string, storedMacros?: MacrosType[]) => {
  const keymapDB = new KeymapDB();
  const macrosArray = raw.trim().split(/\s+/).filter(Boolean).map(Number);
  if (macrosArray.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))
    throw new Error("Invalid macro byte stream");
  const macros: MacrosType[] = [];
  let iter = 0;
  while (iter < macrosArray.length && macrosArray[iter] !== 255) {
    const actions: MacroActionsType[] = [];
    while (iter < macrosArray.length && macrosArray[iter] !== 0) {
      const type = macrosArray[iter];
      iter += 1;
      let width = -1;
      if (type === 1) width = 4;
      else if (type >= 2 && type <= 5) width = 2;
      else if (type >= 6 && type <= 8) width = 1;
      if (width < 0) throw new Error(`Unsupported macro opcode ${type}`);
      if (iter + width > macrosArray.length) throw new Error("Truncated macro action");
      let keyCode: number | number[];
      if (type === 1)
        keyCode = [
          (macrosArray[iter] << 8) + macrosArray[iter + 1],
          (macrosArray[iter + 2] << 8) + macrosArray[iter + 3],
        ];
      else keyCode = width === 2 ? (macrosArray[iter] << 8) + macrosArray[iter + 1] : macrosArray[iter];
      iter += width;
      actions.push({ type, keyCode });
    }
    if (iter >= macrosArray.length) throw new Error("Missing macro terminator");
    iter += 1;
    macros.push({ actions, name: "", macro: "" });
    if (macrosArray[iter] === 0) break;
  }
  macros.forEach((m, idx) => {
    const aux = m;
    aux.id = idx;
    macros[idx] = aux;
  });

  // TODO: Check if stored macros match the received ones, if they match, retrieve name and apply it to current macros
  const stored = storedMacros;
  if (stored === undefined || stored.length === 0) {
    return macros;
  }
  return macros.map((macro, i) => {
    if (stored.length < i) {
      return macro;
    }

    return {
      ...macro,
      name: stored[i]?.name,
      macro: macro.actions.map(k => keymapDB.parse(k.keyCode as number).label).join(" "),
    };
  });
};

export const serializeMacros = (macros: MacrosType[], tMem: number) => {
  // log.info(
  //   "Macros map function",
  //   macros,
  //   macrosEraser,
  //   macros.length === 0,
  //   macros.length === 1 && Array.isArray(macros[0].actions),
  // );
  if (macros.length === 0 || (macros.length === 1 && !Array.isArray(macros[0].actions))) {
    return macrosEraser(tMem);
  }
  const mapAction = (action: MacroActionsType): number[] => {
    if (
      Array.isArray(action.keyCode)
        ? Number.isNaN(action.keyCode[0]) || Number.isNaN(action.keyCode[1])
        : Number.isNaN(action.keyCode)
    )
      return [];
    switch (action.type) {
      case 1:
        return [
          action.type,
          (action.keyCode as number[])[0] >> 8,
          (action.keyCode as number[])[0] & 255,
          (action.keyCode as number[])[1] >> 8,
          (action.keyCode as number[])[1] & 255,
        ];
      case 2:
      case 3:
      case 4:
      case 5:
        return [action.type, (action.keyCode as number) >> 8, (action.keyCode as number) & 255];
      default:
        return [action.type, action.keyCode as number];
    }
  };
  const result: string = macros
    .map(macro => macro.actions.map((action: MacroActionsType) => mapAction(action)).concat([0]))
    .flat()
    .concat([0])
    .join(" ")
    .split(",")
    .join(" ");
  // log.info("MACROS GOING TO BE SAVED", result);
  return result;
};
