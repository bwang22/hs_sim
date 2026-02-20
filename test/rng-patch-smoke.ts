import assert from "node:assert/strict";
import { mulberry32 } from "../src/lib/rng";

const seed = 42;

const original = Math.random;
try {
  const rng = mulberry32(seed);
  (Math as any).random = rng;

  // Math.random should now produce the seeded sequence
  const check = mulberry32(seed);
  for (let i = 0; i < 20; i++) {
    assert.equal(Math.random(), check());
  }

  console.log("✅ Math.random successfully patched to seeded RNG");
} finally {
  (Math as any).random = original;
}
