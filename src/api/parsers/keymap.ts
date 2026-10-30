import { KeyType } from "@Renderer/types/layout";
import { KeymapDB } from "../keymap";

const keymapDB = new KeymapDB();

export const parseKeymapRaw = (keymap: string, keyLayerSize: number): number[][] =>
  keymap
    .split(" ")
    .filter(v => v.length > 0)
    .map((k: string) => parseInt(k, 10))
    .reduce((resultArray, item, index) => {
      const localResult = resultArray;
      const chunkIndex = Math.floor(index / keyLayerSize);

      if (!localResult[chunkIndex]) {
        localResult[chunkIndex] = []; // start a new chunk
      }
      localResult[chunkIndex].push(item);
      return localResult;
    }, []);

export const serializeKeymap = (keymap: KeyType[][] | number[][]) =>
  keymap
    .flat()
    .map(k => (typeof k === "number" ? String(k) : keymapDB.serialize(k).toString()))
    .join(" ");
