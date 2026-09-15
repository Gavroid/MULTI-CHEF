// T65-D (audit round 65, E21): loading.tsx boundary для /today — chunk
// подгружается с skeleton-заглушкой вместо пустого экрана.
export default function TodayLoading(): React.ReactElement {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid="today-route-loading">
      <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-surface-2)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
    </div>
  );
}
