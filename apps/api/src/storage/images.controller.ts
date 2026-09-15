// T54-C (E24): image serving. GET is public (keys are opaque; the UI
// <img> tags must work without credential plumbing). With nginx
// X-Accel (IMAGE_X_ACCEL_PREFIX set) the API only authorises the key
// and hands the byte path to nginx's internal location.
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ImagesService } from './images.service.js';

@ApiTags('images')
@Controller({ path: 'images' })
export class ImagesController {
  constructor(@Inject(ImagesService) private readonly svc: ImagesService) {}

  @Get('*')
  @ApiOperation({ summary: 'Serve a stored image by opaque key' })
  async get(@Req() req: FastifyRequest, @Res() res: FastifyReply): Promise<void> {
    const params = (req as FastifyRequest & { params?: Record<string, string> }).params ?? {};
    const key = decodeURIComponent(params['*'] ?? '').replace(/^\/+/, '');
    const stored = await this.svc.get(key);
    if (!stored) {
      res
        .status(404)
        .send({ status: 404, error: { code: 'NOT_FOUND', message: 'Image not found' } });
      return;
    }
    const accel = process.env['IMAGE_X_ACCEL_PREFIX'];
    res.header('Cache-Control', 'public, max-age=31536000, immutable');
    if (accel) {
      res.header('X-Accel-Redirect', `${accel}/${key}`);
      res.header('Content-Type', stored.contentType);
      res.status(200).send();
      return;
    }
    res.header('Content-Type', stored.contentType);
    res.status(200).send(stored.data);
  }
}
