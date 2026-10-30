/** Validate integer wire data before passing it to upstream parsers which may truncate floats. */
export function validateIntegerStream(raw: string, maximum: number) {
  const tokens = raw.trim().split(/\s+/);
  if (
    !raw.trim() ||
    tokens.some(token => !/^\d+$/.test(token) || !Number.isSafeInteger(Number(token)) || Number(token) > maximum)
  )
    throw new Error("Backup contains invalid integer wire data");
}

export function validSettingNumber(value: unknown, spec: { min?: number; max?: number; specialValues?: number[] }) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    ((value >= (spec.min ?? -Infinity) && value <= (spec.max ?? Infinity)) ||
      spec.specialValues?.includes(value) === true)
  );
}
