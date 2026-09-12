// MC-050/MC-051 — BullMQ processor: payload → Job mirror lifecycle.
//
// GENERATE_PLAN runs the weekly heuristic planner (MC-051); other job
// types complete immediately until their milestones land.

import type { Job } from 'bullmq';
import { runWithMirror } from './job-runner.js';
import { runPlanWeek } from './plan-week.js';

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
        return runPlanWeek(bullJob.data, report, new Date());
      default:
        // Unknown types complete immediately (mirror stays consistent).
        return undefined;
    }
  });
}
