// T29 (audit round 29): cross-tab синхронизация кэшей и auth-состояния.
// Logout в одной вкладке мгновенно инвалидирует кэши (usePantry,
// usePreferences) во всех остальных — иначе соседняя вкладка до 30
// секунд показывает чужие данные (privacy).
type InvalidationReason = 'logout' | 'mutation';

const CHANNEL = 'mc-cache-sync';

export type CacheInvalidationEvent = {
  reason: InvalidationReason;
  originTs: number;
};

const handlers = new Set<(event: CacheInvalidationEvent) => void>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL);
  // Не удерживаем процесс открытым (тесты и SSR-прогоны).
  channel.unref?.();
  return channel;
}

/** Подписка на invalidation из других вкладок. Возвращает отписку. */
export function onCacheInvalidation(handler: (event: CacheInvalidationEvent) => void): () => void {
  handlers.add(handler);
  const bc = getChannel();
  const onMessage = (ev: MessageEvent): void => {
    if (ev.data && (ev.data as CacheInvalidationEvent).reason) handler(ev.data);
  };
  bc?.addEventListener('message', onMessage);
  return () => {
    handlers.delete(handler);
    bc?.removeEventListener('message', onMessage);
  };
}

/** Сообщить всем вкладкам (и текущей) о необходимости сбросить кэши. */
export function broadcastCacheInvalidation(reason: InvalidationReason): void {
  const event: CacheInvalidationEvent = { reason, originTs: Date.now() };
  getChannel()?.postMessage(event);
  for (const handler of handlers) handler(event);
}
