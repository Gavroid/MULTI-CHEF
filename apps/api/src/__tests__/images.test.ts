// T54-C/T54-D (E24): image storage + upload validation unit tests.
// The S3 driver is exercised through a fake client (no network); the
// local driver uses a temp dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ImagesService,
  isValidImageKey,
  MAX_IMAGE_BYTES,
  sniffImageType,
} from '../storage/images.service.js';
import { LocalImageStorage } from '../storage/local-storage.driver.js';
import { S3ImageStorage } from '../storage/s3-storage.driver.js';
import { createImageStorage } from '../storage/storage.factory.js';
import type { ImageStorage } from '../storage/storage.js';

const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.alloc(16, 7),
]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(12)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)]);

test('sniffImageType detects webp/jpeg/png by magic bytes, rejects others', () => {
  assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('<html>not an image</html>')), null);
  assert.equal(sniffImageType(Buffer.alloc(4)), null);
});

test('isValidImageKey: opaque storage keys only', () => {
  assert.ok(isValidImageKey('recipes/yayca-otvarnye.webp'));
  assert.ok(isValidImageKey('recipes/u/01hfakehousehold0000000000/3b8ad9a0-1.webp'.toLowerCase()));
  // traversal / absolute / data / remote are refused
  assert.ok(!isValidImageKey('../etc/passwd'));
  assert.ok(!isValidImageKey('recipes/../../etc/passwd'));
  assert.ok(!isValidImageKey('/images/recipes/x.webp'));
  assert.ok(!isValidImageKey('data:image/svg+xml;base64,AAAA'));
  assert.ok(!isValidImageKey('https://cdn.example.com/x.webp'));
});

function serviceWith(storage: ImageStorage): ImagesService {
  return new ImagesService(storage);
}

test('local driver: put is atomic, get returns bytes with content type', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mc-img-'));
  try {
    const storage = new LocalImageStorage(dir);
    await storage.put('recipes/test.webp', WEBP, 'image/webp');
    const got = await storage.get('recipes/test.webp');
    assert.ok(got);
    assert.equal(got.contentType, 'image/webp');
    assert.deepEqual(await readFile(path.join(dir, 'recipes', 'test.webp')), WEBP);
    assert.equal(await storage.get('recipes/missing.webp'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local driver refuses path traversal keys', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mc-img-'));
  try {
    const storage = new LocalImageStorage(dir);
    await assert.rejects(() => storage.put('../evil.webp', WEBP, 'image/webp'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload validates magic bytes, size and lying content types', async () => {
  const svc = serviceWith(new LocalImageStorage(await mkdtemp(path.join(tmpdir(), 'mc-img-'))));
  await assert.rejects(
    () => svc.uploadForHousehold('h1', Buffer.from('not an image at all'), 'image/webp'),
    /Unsupported image format/,
  );
  await assert.rejects(
    () => svc.uploadForHousehold('h1', Buffer.alloc(10), 'text/html'),
    /Unsupported image format/,
  );
  await assert.rejects(
    () => svc.uploadForHousehold('h1', Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x89), 'image/png'),
    /exceeds/,
  );
  // PNG bytes with a text/html declared type are rejected up front.
  await assert.rejects(
    () => svc.uploadForHousehold('h1', PNG, 'text/html'),
    /Content-Type must be/,
  );
  // PNG bytes with jpeg declared type: magic bytes win.
  const ok = await svc.uploadForHousehold('h1', PNG, 'image/jpeg');
  assert.match(ok.key, /^recipes\/u\/h1\/[0-9a-f-]+\.png$/);
});

test('s3 driver: put/get round-trip through a fake client', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const objects = new Map<string, Buffer>();
  const fake = {
    async send(command: { input?: Record<string, unknown>; constructor: { name: string } }) {
      sent.push(command.input ?? {});
      if (command.constructor.name === 'GetObjectCommand') {
        const key = String((command.input as { Key?: string }).Key);
        const data = objects.get(key);
        if (!data) {
          const e = new Error('no key') as Error & { name: string };
          e.name = 'NoSuchKey';
          throw e;
        }
        return { Body: { transformToBuffer: async () => data } };
      }
      return {};
    },
  };
  const storage = new S3ImageStorage({
    bucket: 'mc-bucket',
    clientFactory: async () => {
      // wrap to capture commands after the real SDK builds them
      return {
        async send(command: unknown) {
          sent.push((command as { input?: Record<string, unknown> }).input ?? {});
          const name = (command as { constructor: { name: string } }).constructor.name;
          if (name === 'GetObjectCommand') {
            const key = String((command as { input: { Key: string } }).input.Key);
            const data = objects.get(key);
            if (!data) {
              const e = new Error('no key') as Error & { name: string };
              e.name = 'NoSuchKey';
              throw e;
            }
            return { Body: { transformToBuffer: async () => data } };
          }
          return {};
        },
      };
    },
  });
  void fake;
  await storage.put('recipes/u/h1/x.webp', WEBP, 'image/webp');
  objects.set('recipes/u/h1/x.webp', WEBP);
  const got = await storage.get('recipes/u/h1/x.webp');
  assert.ok(got);
  assert.equal(got.contentType, 'image/webp');
  assert.equal(await storage.get('recipes/u/h1/absent.webp'), null);
  assert.ok(sent.length >= 1);
});

test('storage factory: local default, s3 requires bucket', () => {
  const local = createImageStorage({});
  assert.ok(local instanceof LocalImageStorage);
  assert.throws(() => createImageStorage({ IMAGE_STORAGE_DRIVER: 's3' }), /IMAGE_S3_BUCKET/);
});
