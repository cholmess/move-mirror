import { createHash } from "node:crypto";

/** Mulberry32 — reproducible PRNG from 32-bit seed. */
export function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedToInt(seed) {
  const hex = createHash("sha256").update(String(seed)).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16);
}

export function deterministicShuffle(items, seed, salt = "") {
  const rng = mulberry32(seedToInt(`${seed}|${salt}`));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickDeterministicTie(candidates, seed, turnKey) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.uci.localeCompare(b.uci);
  });
  const top = sorted[0].finalScore;
  const tied = sorted.filter((c) => c.finalScore === top);
  const rng = mulberry32(seedToInt(`${seed}|${turnKey}|tie`));
  const idx = Math.floor(rng() * tied.length);
  return tied[idx];
}
