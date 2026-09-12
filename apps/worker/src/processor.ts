// MC-050 — BullMQ processor: payload → Job mirror lifecycle.
//
// The domain work between stages is a no-op until MC-051 lands the
// weekly planner (GENERATE_PLAN): it will run the heuristic pipeline
// inside this runner and return the plan id as resultRef.

import type { Job } from 'bullmq';
import { runWithMirror } from './job-runner.js';

export interface ProcessPayload {
  jobId: string;
  userId: string;
  householdId: string;
  type: string;
  params: Record<string, unknown>;
}

export async function processJob(bullJob: Job<ProcessPayload>): Promise<void> {
  const { jobId, type } = bullJob.data;
  await runWithMirror({ jobId, type }, async (report) => {
    switch (type) {
      case 'GENERATE_PLAN':
        // MC-051 replaces this placeholder with the real planner.
        await report('scoring');
        await report('optimizing');
        await report('building-list');
        return undefined;
      default:
        // Unknown types complete immediately (mirror stays consistent).
        return undefined;
    }
  });
}
