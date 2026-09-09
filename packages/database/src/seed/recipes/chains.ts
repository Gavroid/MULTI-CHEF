// MC-031 — Prep-cooking chains ("leftover chains").
//
// A chain is an ordered list of recipe titles: the first recipe is
// cooked "fresh", later recipes reuse its leftovers. The runner writes
// Recipe.recipeSource / Recipe.ingredientSourceOf links (schema MC-003
// self-relation on Recipe) so that the whole chain can be walked from
// any recipe.
//
// Every title MUST exist in recipes.ts (unit tests assert this).
// ≥20 chains with ≥2 recipes each (DoD).

export const CHAIN_TAGS: readonly {
  readonly slug: string;
  readonly titles: readonly string[];
}[] = [
  {
    slug: 'ovsanka-blins',
    titles: ['Овсяная каша на молоке', 'Блины с вареньем', 'Оладьи с мёдом'],
  },
  {
    slug: 'tvorog-week',
    titles: [
      'Запеканка творожная',
      'Сырники с вареньем',
      'Сырники из духовки',
      'Кекс творожный',
      'Вареники с творогом',
    ],
  },
  {
    slug: 'syrniki-2-days',
    titles: ['Сырники из духовки', 'Запеканка творожная', 'Творожный десерт с ягодами'],
  },
  {
    slug: 'yaychnitsa-2-days',
    titles: ['Яичница-глазунья с беконом', 'Омлет с сыром и зеленью', 'Фриттата с овощами'],
  },
  {
    slug: 'buterbrody-morning',
    titles: ['Сэндвич с курицей', 'Круассан с ветчиной и сыром', 'Бутерброды с яйцом'],
  },
  {
    slug: 'kurinyy-bulon-week',
    titles: ['Куриный бульон', 'Куриный суп с рисом', 'Уха с пшеном', 'Суп с фрикадельками'],
  },
  {
    slug: 'kuritsa-3-days',
    titles: ['Курица гриль в духовке', 'Салат с курицей и черри', 'Куриный суп с рисом'],
  },
  {
    slug: 'kuritsa-pechen-2',
    titles: ['Куриные котлеты паровые', 'Бефстроганов из курицы', 'Курица терияки'],
  },
  {
    slug: 'myasnoy-bulon-week',
    titles: ['Борщ украинский', 'Щи из свежей капусты', 'Солянка мясная'],
  },
  { slug: 'borsch-2-days', titles: ['Борщ украинский', 'Щи зелёные', 'Грибной крем-суп'] },
  {
    slug: 'greechka-3-days',
    titles: ['Гречка отварная', 'Гречка с мясом', 'Гречка по-купечески', 'Котлеты гречневые'],
  },
  {
    slug: 'ris-3-days',
    titles: [
      'Рис отварной',
      'Плов узбекский',
      'Плов с курицей',
      'Фаршированные перцы с рисом',
      'Ризотто с грибами',
    ],
  },
  { slug: 'plav-2-days', titles: ['Плов узбекский', 'Плов с изюмом', 'Плов с курицей'] },
  {
    slug: 'pure-2-days',
    titles: [
      'Картофельное пюре',
      'Картофельные зразы с грибами',
      'Картофельная запеканка с сыром',
      'Пюре с молоком и чесноком',
    ],
  },
  {
    slug: 'kotlety-2-days',
    titles: ['Котлеты домашние', 'Бургеры домашние', 'Тефтели в томатном соусе', 'Зразы мясные'],
  },
  {
    slug: 'tefteli-2-days',
    titles: [
      'Тефтели в томатном соусе',
      'Ежики под сметаной',
      'Макароны с тефтелями',
      'Тефтели в мультиварке',
    ],
  },
  {
    slug: 'pelmeni-2-days',
    titles: ['Пельмени домашние', 'Пельмени отварные', 'Пельмени запечённые с сыром'],
  },
  { slug: 'farsh-multi', titles: ['Котлеты домашние', 'Макароны по-флотски', 'Голубцы ленивые'] },
  {
    slug: 'pasta-week',
    titles: [
      'Спагетти отварные',
      'Паста карбонара',
      'Паста болоньезе',
      'Макароны по-флотски',
      'Запеканка макаронная',
    ],
  },
  { slug: 'lavash-week', titles: ['Голубцы ленивые', 'Голубцы', 'Голубцы в мультиварке'] },
  { slug: 'syr-sup-2-days', titles: ['Сырный суп с курицей', 'Грибной крем-суп'] },
  {
    slug: 'gribnoy-week',
    titles: ['Грибной крем-суп', 'Ризотто с грибами', 'Картофельные зразы с грибами'],
  },
  { slug: 'salat-cezar', titles: ['Цезарь с курицей', 'Салат с курицей и черри'] },
  {
    slug: 'ovoshch-multi',
    titles: ['Овощи запечённые в духовке', 'Рагу овощное', 'Фриттата с овощами'],
  },
  {
    slug: 'kabachki-week',
    titles: ['Кабачковая икра', 'Кабачки фаршированные', 'Запеканка из кабачков'],
  },
  { slug: 'ryba-2-days', titles: ['Уха из головы', 'Уха с пшеном', 'Селёдка под шубой'] },
  {
    slug: 'kompot-2-days',
    titles: ['Компот из сухофруктов', 'Кисель ягодный', 'Морс клюквенный', 'Компот яблочный'],
  },
  { slug: 'chai-week', titles: ['Чай чёрный с лимоном', 'Чай зелёный с мятой', 'Чай травяной'] },
  { slug: 'yagody-week', titles: ['Желе ягодное', 'Морс клюквенный', 'Смузи ягодный'] },
  {
    slug: 'testo-multi',
    titles: ['Блины на молоке', 'Блины с вареньем', 'Пирог с яблоками', 'Пирог с вишней'],
  },
] as const;
