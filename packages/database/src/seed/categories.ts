// MC-020 — Ingredient category seed.
//
// 8 categories per PRD §3.2 + §3.3 (IngredientCategory.name + sortOrder).
// The `slug` is a stable key the seed runner uses for upsert; the
// `id` is generated ULID-style on first insert. Each ingredient's
// categoryId is resolved by slug at seed time.

export interface CategorySeed {
  slug: string;
  name: string;
  sortOrder: number;
}

export const CATEGORIES: readonly CategorySeed[] = [
  { slug: 'VEGETABLE', name: 'Овощи', sortOrder: 10 },
  { slug: 'FRUIT', name: 'Фрукты и ягоды', sortOrder: 20 },
  { slug: 'MEAT', name: 'Мясо и птица', sortOrder: 30 },
  { slug: 'DAIRY', name: 'Молочные продукты и яйца', sortOrder: 40 },
  { slug: 'GRAIN', name: 'Крупы, макароны, хлеб', sortOrder: 50 },
  { slug: 'SPICE', name: 'Специи и приправы', sortOrder: 60 },
  { slug: 'BEVERAGE', name: 'Напитки', sortOrder: 70 },
  { slug: 'OTHER', name: 'Прочее', sortOrder: 80 },
] as const;
