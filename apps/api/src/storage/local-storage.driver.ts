// T54-C (E24): filesystem driver — the default deployment target.
// Files live under IMAGE_STORAGE_ROOT (default <repo>/data/images);
// writes are atomic (tmp file + rename) so a crash never leaves a
// truncated image behind a committed key.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { ImageStorage, StoredImage } from './storage.js';

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export function contentTypeForKey(key: string): string {
  const ext = key.split('.').pop() ?? '';
  return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

export class LocalImageStorage implements ImageStorage {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string = '',
  ) {}

  /** Refuse path traversal — keys never leave the storage root. */
  private resolve(key: string): string {
    const path = join(this.root, key);
    if (!path.startsWith(join(this.root) + sep)) {
      throw new Error(`invalid image key: ${key}`);
    }
    return path;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, data, { mode: 0o644 });
    try {
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
    void contentType;
  }

  async get(key: string): Promise<StoredImage | null> {
    try {
      const data = await readFile(this.resolve(key));
      return { data, contentType: contentTypeForKey(key) };
    } catch {
      return null;
    }
  }

  url(key: string): string {
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : `/api/v1/images/${key}`;
  }
}
