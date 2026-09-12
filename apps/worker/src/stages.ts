// MC-050 — canonical stage pipeline for long-running jobs.
//
// Progress jumps to each stage's fixed percentage; the planner (MC-051)
// fills the scoring/optimizing stages with real work.

export const STAGES = [
  'queued',
  'filtering',
  'scoring',
  'optimizing',
  'building-list',
  'done',
] as const;

export type Stage = (typeof STAGES)[number];

const PROGRESS: Record<Stage, number> = {
  queued: 0,
  filtering: 20,
  scoring: 40,
  optimizing: 60,
  'building-list': 80,
  done: 100,
};

export function progressFor(stage: Stage): number {
  return PROGRESS[stage];
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
