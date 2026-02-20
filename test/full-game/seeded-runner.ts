import { mulberry32 } from "../../src/lib/rng";

const rng = mulberry32(42);

// Patch Math.random globally for this process
const originalRandom = Math.random;
(Math as any).random = rng;

async function main() {
  try {
    // Import AFTER patch so everything uses seeded Math.random
    await import("./full-test");
  } finally {
    // Optional: restore
    (Math as any).random = originalRandom;
  }
}
main();
