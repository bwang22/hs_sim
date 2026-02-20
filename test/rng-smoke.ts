import assert from "node:assert/strict";
import { mulberry32 } from "../src/lib/rng"; // adjust path if needed

const toU32 = (x: number) => ((x * 4294967296) >>> 0); // exact for mulberry32 output

// Seed 42 expected first 10 uint32 outputs (authoritative check)
const expectedU32 = [
  2581720956, 1925393290, 3661312704, 2876485805,  750819978,
  2261697747, 1173505300, 2683257857, 3717185310, 2028586305,
];

{
  const rng = mulberry32(42);
  const got = expectedU32.map(() => toU32(rng()));
  assert.deepEqual(got, expectedU32);
}

// Same seed, two instances should match step-for-step
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b());
  }
}

// Different seed should diverge quickly
{
  const a = mulberry32(42);
  const b = mulberry32(43);
  assert.notEqual(a(), b());
}

console.log("✅ mulberry32 looks deterministic and correct");
