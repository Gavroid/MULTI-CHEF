// MC-022 — Pantry controller. Authenticated CRUD. Every route is
// guarded by AuthGuard (mc_session cookie) and reads householdId
// from the session — clients cannot supply a different householdId
// via query or body.
//
// Soft-delete semantics (ADR-0021, MC-022):
//   - DELETE sets `archivedAt = now()` (204 No Content).
//   - POST /:id/restore clears `archivedAt` (400 ITEM_NOT_ARCHIVED
//     if the row is already active).
//   - GET ?includeArchived=false (default) hides archived rows.
//   - PATCH on an archived row → 409 PANTRY_ITEM_ARCHIVED (T15-B):
//     restore first.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import { AppHttpException } from '../common/exception-filter.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PantryService, type PantryItemView } from './pantry.service.js';
import {
  CreatePantryItemSchema,
  PatchPantryItemSchema,
  ListPantryQuerySchema,
  PANTRY_SORT_FIELDS,
  PANTRY_SORT_ORDERS,
  PantryItemIdParamsSchema,
  RestorePantryItemParamsSchema,
} from './pantry.dto.js';
import type { CreatePantryItemDto, PatchPantryItemDto } from './pantry.dto-classes.js';

@ApiTags('pantry')
@ApiCookieAuth('mc_session')
// Class-level error contract (E15/T34-B): применяется ко всем маршрутам.
@ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
@ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
@ApiNotFoundResponse({ description: 'Ресурс не найден' })
@ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
@ApiTooManyRequestsResponse({ description: 'Rate limit' })
@ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
@Controller({ path: 'pantry/items' })
@UseGuards(AuthGuard)
export class PantryController {
  constructor(@Inject(PantryService) private readonly svc: PantryService) {}
  @ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
  @ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
  @ApiNotFoundResponse({ description: 'Ресурс не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit' })
  @ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a PantryItem to the authenticated household' })
  @ApiResponse({ status: 201, description: 'Item created' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 404, description: 'INGREDIENT_NOT_FOUND' })
  async create(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(CreatePantryItemSchema)) body: CreatePantryItemDto,
  ): Promise<{ data: PantryItemView }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    // nestjs-zod validates the body against CreatePantryItemSchema;
    // we re-parse here so we own the typed object.
    const parsed = CreatePantryItemSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const data = await this.svc.createItem(user.id, parsed.data);
    return { data };
  }

  @Get()
  @ApiOperation({ summary: 'List PantryItems for the authenticated household' })
  @ApiQuery({ name: 'ingredientId', required: false })
  @ApiQuery({ name: 'includeArchived', required: false, schema: { type: 'boolean' } })
  @ApiQuery({ name: 'sort', required: false, enum: PANTRY_SORT_FIELDS as unknown as string[] })
  @ApiQuery({ name: 'order', required: false, enum: PANTRY_SORT_ORDERS as unknown as string[] })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiQuery({ name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } })
  @ApiResponse({ status: 200, description: 'List of items' })
  @ApiResponse({ status: 401, description: 'No session' })
  async list(
    @Req() req: FastifyRequest,
    @Query() raw: Record<string, string | undefined>,
  ): Promise<{ data: PantryItemView[]; meta: { total: number; limit: number; offset: number } }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = ListPantryQuerySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const { items, total, limit, offset } = await this.svc.listItems(user.id, parsed.data);
    // T42-A: total + limit/offset — клиент знает, есть ли ещё страницы.
    return { data: items, meta: { total, limit, offset } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single PantryItem by id (household-scoped)' })
  @ApiResponse({ status: 200, description: 'Item' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 404, description: 'PANTRY_ITEM_NOT_FOUND' })
  async get(
    @Req() req: FastifyRequest,
    @Param() params: Record<string, string>,
  ): Promise<{ data: PantryItemView }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = PantryItemIdParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const data = await this.svc.getItem(user.id, parsed.data.id);
    return { data };
  }

  @Patch(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a PantryItem (household-scoped)' })
  @ApiResponse({ status: 200, description: 'Updated item' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 404, description: 'PANTRY_ITEM_NOT_FOUND' })
  async patch(
    @Req() req: FastifyRequest,
    @Param() params: Record<string, string>,
    @Body(new ZodValidationPipe(PatchPantryItemSchema)) body: PatchPantryItemDto,
  ): Promise<{ data: PantryItemView }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const paramsParsed = PantryItemIdParamsSchema.safeParse(params);
    if (!paramsParsed.success) {
      throw validationError(paramsParsed.error.issues);
    }
    const data = await this.svc.updateItem(user.id, paramsParsed.data.id, body);
    return { data };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a PantryItem (hard delete — schema has no archivedAt column for soft delete)',
  })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 404, description: 'PANTRY_ITEM_NOT_FOUND' })
  async remove(@Req() req: FastifyRequest, @Param() params: Record<string, string>): Promise<void> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = PantryItemIdParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    await this.svc.deleteItem(user.id, parsed.data.id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Restore an archived PantryItem (always 400 ITEM_NOT_ARCHIVED until archivedAt column is added)',
  })
  @ApiResponse({ status: 200, description: 'Restored item' })
  @ApiResponse({ status: 400, description: 'ITEM_NOT_ARCHIVED' })
  @ApiResponse({ status: 401, description: 'No session' })
  @ApiResponse({ status: 404, description: 'PANTRY_ITEM_NOT_FOUND' })
  async restore(
    @Req() req: FastifyRequest,
    @Param() params: Record<string, string>,
  ): Promise<{ data: PantryItemView }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = RestorePantryItemParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const data = await this.svc.restoreItem(user.id, parsed.data.id);
    return { data };
  }
}

function validationError(
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): AppHttpException {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root';
    (fields[key] ??= []).push(issue.message);
  }
  return new AppHttpException({
    code: 'VALIDATION_ERROR',
    message: 'Invalid request',
    details: { fields },
  });
}
