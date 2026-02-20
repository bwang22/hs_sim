// src/lib/rng.ts

export type RNG = () => number;

/**
 * Mulberry32 PRNG
 * - Deterministic: same seed -> same sequence
 * - Returns float in [0, 1)
 */
export function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Optional helpers (you'll use these a lot)
export function randInt(rng: RNG, min: number, maxInclusive: number): number {
  return Math.floor(rng() * (maxInclusive - min + 1)) + min;
}

export function choice<T>(rng: RNG, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}
