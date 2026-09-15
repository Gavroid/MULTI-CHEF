// T54-C (E24): driver selection by env. IMAGE_STORAGE_DRIVER=local
// (default) writes under IMAGE_STORAGE_ROOT; 's3' targets any
// S3-compatible endpoint (AWS / MinIO / Spaces) via IMAGE_S3_*.
// IMAGE_PUBLIC_BASE overrides the client-facing URL base (CDN).
import path from 'node:path';
import { LocalImageStorage } from './local-storage.driver.js';
import { S3ImageStorage } from './s3-storage.driver.js';
import type { ImageStorage } from './storage.js';

export interface StorageEnv {
  IMAGE_STORAGE_DRIVER?: string | undefined;
  IMAGE_STORAGE_ROOT?: string | undefined;
  IMAGE_PUBLIC_BASE?: string | undefined;
  IMAGE_S3_BUCKET?: string | undefined;
  IMAGE_S3_REGION?: string | undefined;
  IMAGE_S3_ENDPOINT?: string | undefined;
  IMAGE_S3_ACCESS_KEY_ID?: string | undefined;
  IMAGE_S3_SECRET_ACCESS_KEY?: string | undefined;
}

let singleton: ImageStorage | null = null;

export function createImageStorage(env: StorageEnv): ImageStorage {
  const publicBase = env.IMAGE_PUBLIC_BASE?.replace(/\/+$/, '');
  if ((env.IMAGE_STORAGE_DRIVER ?? 'local') === 's3') {
    if (!env.IMAGE_S3_BUCKET) {
      throw new Error('IMAGE_STORAGE_DRIVER=s3 requires IMAGE_S3_BUCKET');
    }
    return new S3ImageStorage({
      bucket: env.IMAGE_S3_BUCKET,
      clientFactory: async () => {
        const { S3Client } = await import('@aws-sdk/client-s3');
        return new S3Client({
          region: env.IMAGE_S3_REGION ?? 'us-east-1',
          ...(env.IMAGE_S3_ENDPOINT
            ? { endpoint: env.IMAGE_S3_ENDPOINT, forcePathStyle: true }
            : {}),
          ...(env.IMAGE_S3_ACCESS_KEY_ID
            ? {
                credentials: {
                  accessKeyId: env.IMAGE_S3_ACCESS_KEY_ID,
                  secretAccessKey: env.IMAGE_S3_SECRET_ACCESS_KEY ?? '',
                },
              }
            : {}),
        }) as never;
      },
    });
  }
  const root = env.IMAGE_STORAGE_ROOT ?? path.join(process.cwd(), 'data', 'images');
  return new LocalImageStorage(root, publicBase ?? '');
}

/** App-wide singleton (configured from validated env in main.ts). */
export function getImageStorage(): ImageStorage {
  if (!singleton) throw new Error('image storage not configured');
  return singleton;
}

export function setImageStorage(storage: ImageStorage): void {
  singleton = storage;
}
