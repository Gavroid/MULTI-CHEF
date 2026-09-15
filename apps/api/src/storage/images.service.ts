// T54-C/T54-D (E24): image domain service. Magic-byte sniffing is the
// source of truth for the image type — a lying Content-Type header never
// reaches storage. Keys are opaque: `recipes/<slug>.webp` (catalog) and
// `recipes/u/<householdId>/<ulid>.<ext>` (user uploads).
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '@multichef/database';
import { AppHttpException } from '../common/exception-filter.js';
import { IMAGE_STORAGE, type ImageStorage } from './storage.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXT_BY_TYPE: Record<AllowedImageType, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Magic bytes beat headers: webp = RIFF....WEBP, jpeg = FF D8 FF, png. */
export function sniffImageType(data: Buffer): AllowedImageType | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png';
  }
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Strict key shape — the ONLY strings that may hit storage or <img src>. */
export function isValidImageKey(key: string): boolean {
  return /^recipes\/[a-z0-9][a-z0-9-/]*\.(webp|jpg|jpeg|png)$/.test(key);
}

export interface UploadResult {
  key: string;
  url: string;
  bytes: number;
  contentType: AllowedImageType;
}

@Injectable()
export class ImagesService {
  constructor(@Inject(IMAGE_STORAGE) private readonly storage: ImageStorage) {}

  async uploadForHousehold(
    householdId: string,
    data: Buffer,
    declaredType: string | undefined,
  ): Promise<UploadResult> {
    const type = this.validate(data, declaredType);
    const key = `recipes/u/${householdId.toLowerCase()}/${randomUUID().toLowerCase()}.${EXT_BY_TYPE[type]}`;
    await this.storage.put(key, data, type);
    return { key, url: this.storage.url(key), bytes: data.length, contentType: type };
  }

  /**
   * Attach an uploaded image to a recipe. `owner` semantics: the recipe
   * row must belong to the caller's household (ownerHouseholdId) —
   * global catalog recipes (null owner) are read-only by design.
   */
  async attachToRecipe(
    recipeId: string,
    householdId: string,
    data: Buffer,
    declaredType: string | undefined,
  ): Promise<UploadResult> {
    const prisma = getPrisma();
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
      select: { id: true, ownerHouseholdId: true },
    });
    if (!recipe) {
      throw new AppHttpException({ code: 'RECIPE_NOT_FOUND', message: 'Recipe not found' });
    }
    if (recipe.ownerHouseholdId !== householdId) {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'Only the owning household can attach images to this recipe',
      });
    }
    const result = await this.uploadForHousehold(householdId, data, declaredType);
    await prisma.recipe.update({ where: { id: recipeId }, data: { imageKey: result.key } });
    return result;
  }

  /** Mirror of the other services' requireOwnedHouseholdId. */
  async resolveOwnedHouseholdId(userId: string): Promise<string> {
    const membership = await getPrisma().householdMember.findFirst({
      where: { userId, role: 'OWNER' },
      select: { householdId: true },
    });
    if (!membership) {
      throw new AppHttpException({
        code: 'FORBIDDEN',
        message: 'No owned household for this user',
      });
    }
    return membership.householdId;
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (!isValidImageKey(key)) return null;
    return this.storage.get(key);
  }

  private validate(data: Buffer, declaredType: string | undefined): AllowedImageType {
    if (data.length === 0) {
      throw new AppHttpException({ code: 'VALIDATION_ERROR', message: 'Empty image body' });
    }
    if (data.length > MAX_IMAGE_BYTES) {
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: `Image exceeds ${MAX_IMAGE_BYTES} bytes`,
      });
    }
    const sniffed = sniffImageType(data);
    if (!sniffed) {
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: 'Unsupported image format (webp/jpeg/png only)',
      });
    }
    // A lying Content-Type is tolerated only when it still names an
    // allowed image type; anything else (e.g. text/html) is rejected.
    if (declaredType && declaredType !== sniffed) {
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declaredType)) {
        throw new AppHttpException({
          code: 'VALIDATION_ERROR',
          message: 'Content-Type must be an allowed image type',
        });
      }
    }
    return sniffed;
  }
}
