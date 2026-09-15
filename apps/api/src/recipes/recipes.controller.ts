// MC-033 — Public recipes catalog controller (NO AuthGuard by decision:
// CURATED + PUBLISHED is public reference data, same as /ingredients).

import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
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
import { AppHttpException } from '../common/exception-filter.js';
import { RecipesService } from './recipes.service.js';
import {
  ListRecipesQuerySchema,
  RecipeIdParamsSchema,
  type PaginatedRecipes,
  type RecipeDetailDto,
} from './recipes.dto.js';

@ApiTags('recipes')
@Controller({ path: 'recipes' })
export class RecipesController {
  constructor(@Inject(RecipesService) private readonly svc: RecipesService) {}
  @ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
  @ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
  @ApiNotFoundResponse({ description: 'Ресурс не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit' })
  @ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
  @Get()
  @ApiOperation({ summary: 'Public recipe catalog (CURATED + PUBLISHED, cursor-paginated)' })
  @ApiQuery({ name: 'mealType', required: false, enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] })
  @ApiQuery({
    name: 'maxMinutes',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 360 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque base64url cursor (createdAt+id)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 50 },
  })
  @ApiResponse({ status: 200, description: 'Paginated recipes' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  // TODO(MC-XXX): when the schema gains array fields (tags, antiFilters),
  // switch to the Fastify-native parser `req.query as Record<string, string | string[]>` —
  // the current Record<string, string | undefined> type drops repeated keys.
  async list(@Query() rawQuery: Record<string, string | undefined>): Promise<PaginatedRecipes> {
    const parsed = ListRecipesQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw validationError(parsed.error.issues, 'Invalid query parameters');
    }
    return this.svc.list(parsed.data);
  }

  // NOTE: `:id` route is declared AFTER any literal sub-routes.
  @Get(':id')
  @ApiOperation({ summary: 'Public recipe detail (404 unless CURATED + PUBLISHED)' })
  @ApiResponse({
    status: 200,
    description: 'Recipe with instructions, ingredients, nutrition, storage rules',
  })
  @ApiResponse({ status: 404, description: 'RECIPE_NOT_FOUND' })
  async get(@Param() params: Record<string, string>): Promise<RecipeDetailDto> {
    const parsed = RecipeIdParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw validationError(parsed.error.issues, 'Invalid recipe id');
    }
    return this.svc.getById(parsed.data.id);
  }
}

function validationError(
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
  message: string,
): AppHttpException {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_root';
    (fields[key] ??= []).push(issue.message);
  }
  return new AppHttpException({
    code: 'VALIDATION_ERROR',
    message,
    details: { fields },
  });
}
