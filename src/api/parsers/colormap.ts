export const parseColormapRaw = (colormap: string, ColorLayerSize: number): number[][] =>
  colormap
    .split(" ")
    .filter(v => v.length > 0)
    .map((k: string) => parseInt(k, 10))
    .reduce((resultArray, item, index) => {
      const localResult: number[][] = resultArray;
      const chunkIndex = Math.floor(index / ColorLayerSize);

      if (!localResult[chunkIndex]) {
        localResult[chunkIndex] = []; // start a new chunk
      }
      localResult[chunkIndex].push(item);
      return localResult;
    }, []);

export const serializeColormap = (colormap: number[][]): string => colormap.flat().join(" ");
