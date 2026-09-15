// T65-D (E21): loading boundary для /plan.
export default function PlanLoading(): React.ReactElement {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid="plan-route-loading">
      <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-surface-2)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
    </div>
  );
}
