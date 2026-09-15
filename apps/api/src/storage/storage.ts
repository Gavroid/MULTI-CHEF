// T54-C (E24): the storage abstraction. `imageKey` in the DB is an
// OPAQUE key (`recipes/<slug>.webp`, `recipes/u/<household>/<ulid>.webp`)
// — never a URL. Drivers translate keys to bytes (get) or persist bytes
// (put); the CDN/CDN-base decision lives in urlFor(). Swapping local →
// S3-compatible storage is an env change, not a DB migration.

export interface StoredImage {
  readonly data: Buffer;
  readonly contentType: string;
}

export interface ImageStorage {
  /** Persist bytes under an opaque key (overwrites atomically). */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Read bytes back; null when the key is absent. */
  get(key: string): Promise<StoredImage | null>;
  /** Public URL for clients (CDN base or API route). */
  url(key: string): string;
}

/** DI token for the configured driver (kept here to avoid import cycles). */
export const IMAGE_STORAGE = 'IMAGE_STORAGE';
