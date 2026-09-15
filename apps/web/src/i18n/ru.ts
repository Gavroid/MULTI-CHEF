// T46-B (E23): the ru dictionary — single source of UI strings for the
// next-intl foundation. Keys live in namespaces (nav.*, profile.*).
// New screens migrate their strings here; scripts/check-i18n-coverage.mjs
// fails the build when a dictionary key is unused or a t() call is
// missing from the dictionary (100% coverage both ways).

const ru = {
  nav: {
    today: 'Сегодня',
    fridge: 'Холодильник',
    plan: 'План',
    shopping: 'Покупки',
    profile: 'Профиль',
    ariaLabel: 'Основная навигация',
  },
  profile: {
    title: 'Профиль',
    subtitle: 'Аккаунт и настройки',
    loginCtaTitle: 'Войдите, чтобы увидеть профиль',
    loginCtaText:
      'Здесь будут аллергии, члены семьи, бюджет и настройки дисклеймера КБЖУ. Войдите или создайте аккаунт.',
    login: 'Войти',
    theme: 'Тема оформления',
    logout: 'Выйти',
    loggingOut: 'Выходим...',
    language: 'Язык интерфейса (язык ошибок API)',
    timezone: 'Часовой пояс',
    localeRu: 'Русский',
    localeEn: 'English',
    peopleShort: '{count} чел.',
    budgetPerWeek: 'бюджет {amount} ₽/нед',
  },
} as const;

export default ru;
export type Messages = typeof ru;
