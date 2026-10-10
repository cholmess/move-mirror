/**
 * Cola FIFO — un análisis activo; evita mezcla de comandos UCI.
 */
export class EvaluationQueue {
  constructor({ maxQueue = 32, jobTimeoutMs = 120_000 } = {}) {
    this.maxQueue = maxQueue;
    this.jobTimeoutMs = jobTimeoutMs;
    this.pending = [];
    this.active = null;
  }

  enqueue(run, { signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(new Error("aborted"));
    }

    return new Promise((resolve, reject) => {
      if (this.pending.length >= this.maxQueue) {
        reject(new Error("queue_full"));
        return;
      }

      const job = {
        run,
        resolve,
        reject,
        signal,
        onAbort: () => {
          if (this.active === job) {
            job.timedOut = true;
            job.reject(new Error("aborted"));
            this.active = null;
            this._drain();
          } else {
            const idx = this.pending.indexOf(job);
            if (idx >= 0) this.pending.splice(idx, 1);
            job.reject(new Error("aborted"));
          }
        },
      };

      if (signal) {
        signal.addEventListener("abort", job.onAbort, { once: true });
      }

      this.pending.push(job);
      this._drain();
    });
  }

  async _drain() {
    if (this.active || this.pending.length === 0) return;

    const job = this.pending.shift();
    this.active = job;

    const timer = setTimeout(() => {
      if (this.active === job) {
        job.timedOut = true;
        job.reject(new Error("evaluation_timeout"));
        this.active = null;
        this._drain();
      }
    }, this.jobTimeoutMs);

    try {
      const result = await job.run({ signal: job.signal });
      if (!job.timedOut) job.resolve(result);
    } catch (err) {
      if (!job.timedOut) job.reject(err);
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
