import fs from "node:fs";
import path from "node:path";

export const DAILY_VERSION = "daily-training-v1";

/** Daily drill state: cards with SRS state, sessions, answer log and post-game reviews. */
export function createDailyStore(root) {
  const file = path.join(root, "state.json");
  const initial = () => ({ version: DAILY_VERSION, cards: {}, sessions: [], log: [], reviews: {}, updatedAt: null });
  let state = null;
  function read() {
    if (!state) {
      try { state = { ...initial(), ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { state = initial(); }
    }
    return state;
  }
  function write(next) {
    fs.mkdirSync(root, { recursive: true });
    next.updatedAt = new Date().toISOString();
    fs.writeFileSync(file + ".tmp", JSON.stringify(next)); fs.renameSync(file + ".tmp", file);
    state = next;
  }
  function mutate(fn) { const s = structuredClone(read()); const out = fn(s); write(s); return out; }
  return { read, mutate };
}
