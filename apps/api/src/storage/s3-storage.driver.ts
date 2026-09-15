// T54-C (E24): S3-compatible driver (AWS / MinIO / Spaces). The AWS SDK
// is imported lazily so the local-driver deployment does not pay the
// dependency at boot. Tests inject a fake via `clientFactory` — any
// object with a compatible `send` works.
import type { ImageStorage, StoredImage } from './storage.js';

/** Structural subset of S3Client used here (keeps tests fake-friendly). */
export interface S3LikeClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(command: any): Promise<any>;
}

export interface S3DriverOptions {
  bucket: string;
  clientFactory: () => Promise<S3LikeClient>;
}

function contentTypeFromKey(key: string): string {
  const ext = (key.split('.').pop() ?? '').toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'image/webp';
}

function isNoSuchKey(err: unknown): boolean {
  const name = (err as { name?: string; Code?: string } | null)?.name;
  const code = (err as { Code?: string } | null)?.Code;
  return name === 'NoSuchKey' || name === 'NotFound' || code === 'NoSuchKey';
}

export class S3ImageStorage implements ImageStorage {
  private clientPromise?: Promise<S3LikeClient>;
  constructor(private readonly options: S3DriverOptions) {}

  private client(): Promise<S3LikeClient> {
    this.clientPromise ??= this.options.clientFactory();
    return this.clientPromise;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<StoredImage | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      const body = out?.Body;
      if (!body) return null;
      return { data: await body.transformToBuffer(), contentType: contentTypeFromKey(key) };
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  url(key: string): string {
    // Served through the API route (or a CDN base override) — the key
    // stays opaque to clients.
    return `/api/v1/images/${key}`;
  }
}
