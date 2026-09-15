// T54-D (E24): user uploads. Raw image bytes in the request body
// (Content-Type: image/webp|jpeg|png; parsed by the image content-type
// parser registered in main.ts) — no multipart dependency.
import { Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import { ImagesService } from './images.service.js';

type ImageRequest = FastifyRequest & { user?: AuthenticatedUser; body?: Buffer };

@ApiTags('uploads')
@UseGuards(AuthGuard)
@Controller({ path: 'uploads' })
export class UploadsController {
  constructor(@Inject(ImagesService) private readonly svc: ImagesService) {}

  @Post('image')
  @ApiOperation({ summary: 'Upload an image for the owned household' })
  @ApiResponse({ status: 201, description: 'Stored; returns the opaque key + url' })
  async upload(@Req() req: FastifyRequest): Promise<{ key: string; url: string }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const householdId = await this.svc.resolveOwnedHouseholdId(user.id);
    const image = (req as ImageRequest).body ?? Buffer.alloc(0);
    const contentType = (req.headers['content-type'] as string | undefined) ?? undefined;
    const result = await this.svc.uploadForHousehold(householdId, image, contentType);
    return { key: result.key, url: result.url };
  }
}
