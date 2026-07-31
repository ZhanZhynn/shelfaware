export type Known<T> = { known: true; value: T };
export type Unknown = { known: false; reason: string };
export type KnownUnknown<T> = Known<T> | Unknown;

export function known<T>(value: T): Known<T> { return { known: true, value }; }
export function unknown(reason: string): Unknown { return { known: false, reason }; }

/** Integer minor units only; no currency precision policy is implied. */
export function addFixedPoint(values: KnownUnknown<bigint>[]): KnownUnknown<bigint> {
  let sum = 0n;
  for (const value of values) {
    if (!value.known) return value;
    sum += value.value;
  }
  return known(sum);
}
