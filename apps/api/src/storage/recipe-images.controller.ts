// T54-D (E24): attach an uploaded image to a recipe the caller's
// household OWNS. Global catalog recipes (ownerHouseholdId = null) are
// read-only — the attempt answers 403 FORBIDDEN.
import { Controller, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import { ImagesService } from './images.service.js';

type ImageRequest = FastifyRequest & { user?: AuthenticatedUser; body?: Buffer };

@ApiTags('recipes')
@UseGuards(AuthGuard)
@Controller({ path: 'recipes' })
export class RecipeImagesController {
  constructor(@Inject(ImagesService) private readonly svc: ImagesService) {}

  @Post(':id/image')
  @ApiOperation({ summary: 'Attach an uploaded image to an owned recipe' })
  @ApiResponse({ status: 201, description: 'Attached; returns the opaque key + url' })
  @ApiResponse({ status: 403, description: 'Not the owning household' })
  async attach(
    @Req() req: FastifyRequest,
    @Param('id') recipeId: string,
  ): Promise<{ key: string; url: string }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const householdId = await this.svc.resolveOwnedHouseholdId(user.id);
    const image = (req as ImageRequest).body ?? Buffer.alloc(0);
    const contentType = (req.headers['content-type'] as string | undefined) ?? undefined;
    const result = await this.svc.attachToRecipe(recipeId, householdId, image, contentType);
    return { key: result.key, url: result.url };
  }
}
