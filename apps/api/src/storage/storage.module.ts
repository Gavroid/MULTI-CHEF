// T54-C (E24): storage wiring — the ImageStorage driver comes from the
// factory (env-driven). Tests override the IMAGE_STORAGE provider with
// a fake (see __tests__/images.test.ts).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';
import { RecipeImagesController } from './recipe-images.controller.js';
import { UploadsController } from './uploads.controller.js';
import { createImageStorage } from './storage.factory.js';
import { IMAGE_STORAGE } from './storage.js';

const imageStorage = createImageStorage({
  IMAGE_STORAGE_DRIVER: process.env['IMAGE_STORAGE_DRIVER'],
  IMAGE_STORAGE_ROOT: process.env['IMAGE_STORAGE_ROOT'],
  IMAGE_PUBLIC_BASE: process.env['IMAGE_PUBLIC_BASE'],
  IMAGE_S3_BUCKET: process.env['IMAGE_S3_BUCKET'],
  IMAGE_S3_REGION: process.env['IMAGE_S3_REGION'],
  IMAGE_S3_ENDPOINT: process.env['IMAGE_S3_ENDPOINT'],
  IMAGE_S3_ACCESS_KEY_ID: process.env['IMAGE_S3_ACCESS_KEY_ID'],
  IMAGE_S3_SECRET_ACCESS_KEY: process.env['IMAGE_S3_SECRET_ACCESS_KEY'],
});

@Module({
  // AuthModule: AuthGuard (uploads) needs AuthService.
  imports: [AuthModule],
  controllers: [ImagesController, UploadsController, RecipeImagesController],
  providers: [ImagesService, { provide: IMAGE_STORAGE, useValue: imageStorage }],
  exports: [{ provide: IMAGE_STORAGE, useValue: imageStorage }],
})
export class StorageModule {}
