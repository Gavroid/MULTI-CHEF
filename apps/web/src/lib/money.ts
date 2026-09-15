// T52 (audit round 52): единые деньги-утилиты. Деньги хранятся в
// копейках (int); форматирование и обратный парсинг — только здесь.
export function formatRub(kopecks: number): string {
  // T52-D: целочисленное деление безопасно — формат отображения всегда
  // целые рубли, копейки хранятся и считаются отдельно.
  return `₽${Math.round(kopecks / 100)}`;
}

/** Парсит пользовательский ввод в целые копейки (округление вниз). */
export function parseRubToKopecks(input: string): number {
  const normalized = input.replace(/\s|\u00A0/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return 0;
  return Math.floor(value * 100);
}
