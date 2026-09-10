// /plan/setup — placeholder for the weekly-plan wizard (MC-055).
//
// MC-035's «Добавить в план» deep-links here with
// ?recipeId=…&servings=…; until MC-055 builds the real wizard this
// page acknowledges the deep-link instead of 404-ing. The query
// params are parsed and displayed so the future wizard's entry
// contract is already exercised end-to-end.

export default async function PlanSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ recipeId?: string; servings?: string }>;
}): Promise<React.ReactElement> {
  const { recipeId, servings } = await searchParams;

  return (
    <div className="flex flex-col items-center gap-3 py-16" data-testid="plan-setup-placeholder">
      <h1 className="text-lg font-bold text-[var(--color-text)]">Настройка плана</h1>
      <p className="text-sm text-[var(--color-text-muted)]">
        Страница в разработке (MC-055). Рецепт
        {recipeId ? ` «${recipeId}»` : ''}
        {servings ? ` на ${servings} порц.` : ''} будет добавлен в план, когда мастер планов
        появится.
      </p>
    </div>
  );
}
