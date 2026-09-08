// MC-001 worker scaffold. Real queue + jobs land in MC-050
// (see ADR-0007 / DEVELOPMENT-PLAN §0). Today: just prove the lifecycle
// (start, idle loop, graceful shutdown on SIGTERM/SIGINT).

export interface WorkerLoop {
  tick(): Promise<void>;
  stop(): Promise<void>;
}

// A no-op loop. Kept dependency-free so the scaffold has nothing to configure.
export class IdleLoop implements WorkerLoop {
  #running = false;

  async tick(): Promise<void> {
    // Reserved for future jobs (MC-050).
  }

  async stop(): Promise<void> {
    this.#running = false;
  }

  isRunning(): boolean {
    return this.#running;
  }

  setRunning(value: boolean): void {
    this.#running = value;
  }
}

export async function runWorker(loop: WorkerLoop): Promise<void> {
  const idle = loop instanceof IdleLoop ? loop : null;

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`worker: received ${signal}, shutting down`);
    await loop.stop();
    if (idle) idle.setRunning(false);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  if (idle) idle.setRunning(true);
  console.log('worker ready');

  // Idle loop until signaled. Real cadence + queue polling land in MC-050.
  while (idle?.isRunning() ?? true) {
    await loop.tick();
    await new Promise((r) => setTimeout(r, 1000));
  }
}
