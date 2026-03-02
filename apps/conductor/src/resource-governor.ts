/**
 * Resource Governor
 *
 * Limits concurrent agent count on Mac Mini.
 * Simple semaphore with queue for excess work.
 */

import * as os from "node:os";

export class ResourceGovernor {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  /** Acquire a slot. Resolves when a slot is available. */
  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  /** Release a slot, allowing queued work to proceed. */
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Run a function with a governed slot */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Current utilization stats */
  stats(): { active: number; queued: number; max: number; systemLoad: SystemLoad } {
    return {
      active: this.active,
      queued: this.queue.length,
      max: this.maxConcurrent,
      systemLoad: getSystemLoad(),
    };
  }
}

interface SystemLoad {
  cpuCount: number;
  loadAvg1m: number;
  freeMemMb: number;
  totalMemMb: number;
}

function getSystemLoad(): SystemLoad {
  return {
    cpuCount: os.cpus().length,
    loadAvg1m: os.loadavg()[0],
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
  };
}
