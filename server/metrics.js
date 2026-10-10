import fs from "node:fs";
import path from "node:path";

export class EvalMetrics {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      hits: 0,
      misses: 0,
      escalations: 0,
      errors: 0,
      totalMs: 0,
      evaluations: 0,
      evaluationsAvoided: 0,
    };
    this.load();
  }

  load() {
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.filePath, "utf8")) };
    } catch {
      /* fresh */
    }
  }

  persist() {
    const tmp = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  recordHit() {
    this.data.hits += 1;
    this.data.evaluationsAvoided += 1;
    this.persist();
  }

  recordMiss() {
    this.data.misses += 1;
    this.persist();
  }

  recordEscalation() {
    this.data.escalations += 1;
    this.persist();
  }

  recordError() {
    this.data.errors += 1;
    this.persist();
  }

  recordDuration(ms) {
    this.data.totalMs += ms;
    this.data.evaluations += 1;
    this.persist();
  }

  snapshot() {
    const avgMs =
      this.data.evaluations > 0 ? Math.round(this.data.totalMs / this.data.evaluations) : 0;
    return { ...this.data, avgMs };
  }
}
