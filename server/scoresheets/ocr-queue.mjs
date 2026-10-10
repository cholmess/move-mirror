export class ScoresheetOcrQueue {
  constructor({ maxQueue = Number(process.env.SCORESHEET_OCR_MAX_QUEUE ?? 4), jobTimeoutMs = Number(process.env.SCORESHEET_OCR_TIMEOUT_MS ?? 120_000) } = {}) {
    this.maxQueue = maxQueue;
    this.jobTimeoutMs = jobTimeoutMs;
    this.pending = [];
    this.active = null;
  }

  enqueue(run, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new Error("SCORESHEET_OCR_CANCELLED"));
    return new Promise((resolve, reject) => {
      if (this.pending.length + (this.active ? 1 : 0) >= this.maxQueue) {
        reject(new Error("SCORESHEET_OCR_QUEUE_FULL"));
        return;
      }
      const job = { run, resolve, reject, signal, timedOut: false };
      if (signal) signal.addEventListener("abort", () => this.cancelJob(job), { once: true });
      this.pending.push(job);
      this._drain();
    });
  }

  cancelJob(job) {
    if (this.active === job) {
      job.timedOut = true;
      job.reject(new Error("SCORESHEET_OCR_CANCELLED"));
      this.active = null;
      this._drain();
      return;
    }
    const idx = this.pending.indexOf(job);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      job.reject(new Error("SCORESHEET_OCR_CANCELLED"));
    }
  }

  async _drain() {
    if (this.active || !this.pending.length) return;
    const job = this.pending.shift();
    this.active = job;
    const timer = setTimeout(() => {
      if (this.active === job) {
        job.timedOut = true;
        job.reject(new Error("SCORESHEET_OCR_TIMEOUT"));
        this.active = null;
        this._drain();
      }
    }, this.jobTimeoutMs);
    try {
      const result = await job.run({ signal: job.signal });
      if (!job.timedOut) job.resolve(result);
    } catch (error) {
      if (!job.timedOut) job.reject(error);
    } finally {
      clearTimeout(timer);
      if (this.active === job) {
        this.active = null;
        this._drain();
      }
    }
  }

  size() {
    return this.pending.length + (this.active ? 1 : 0);
  }
}
