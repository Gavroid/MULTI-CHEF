// MC-021 — Catalog controller. Public read-only endpoints. NO
// @UseGuards(AuthGuard) here per the task spec — the catalog is
// publicly browsable like a store. Rate limiting will be added in
// MC-051 (Redis-backed bucket for /ingredients).
//
// Query params are validated inside the handler because NestJS has
// no `@Query()` zod pipe in this setup. We surface validation
// failures as 400 VALIDATION_ERROR through the global exception
// filter, consistent with auth/profile modules.

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
import {
  IngredientsService,
  type IngredientView,
  type CategoryView,
  type NutritionView,
} from './ingredients.service.js';
import {
  IngredientsCategoryQuerySchema,
  IngredientsIdParamsSchema,
  IngredientsNutritionParamsSchema,
  IngredientsQuerySchema,
  IngredientSortField,
  IngredientSortOrder,
} from './ingredients.dto.js';

@ApiTags('ingredients')
@Controller({ path: 'ingredients' })
export class IngredientsController {
  constructor(@Inject(IngredientsService) private readonly svc: IngredientsService) {}
  @ApiUnauthorizedResponse({ description: 'Нет/просрочена сессия' })
  @ApiForbiddenResponse({ description: 'Нет прав на ресурс' })
  @ApiNotFoundResponse({ description: 'Ресурс не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Доменное ограничение' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit' })
  @ApiInternalServerErrorResponse({ description: 'Внутренняя ошибка' })
  @Get()
  @ApiOperation({ summary: 'Search the ingredient catalog (public, fuzzy)' })
  @ApiQuery({ name: 'q', required: false, description: 'Fuzzy match on canonicalName + aliases' })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Filter by IngredientCategory.name (Russian display name)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiQuery({ name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } })
  @ApiQuery({ name: 'sort', required: false, enum: IngredientSortField as unknown as string[] })
  @ApiQuery({ name: 'order', required: false, enum: IngredientSortOrder as unknown as string[] })
  @ApiResponse({ status: 200, description: 'List of ingredients' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async list(
    @Query() rawQuery: Record<string, string | undefined>,
  ): Promise<{ data: IngredientView[]; meta: { total: number; limit: number; offset: number } }> {
    const parsed = IngredientsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    // T42-B: total уже считается сервисом — отдаём клиенту.
    const { items, total } = await this.svc.listIngredients(parsed.data);
    return { data: items, meta: { total, limit: parsed.data.limit, offset: parsed.data.offset } };
  }

  @Get('categories')
  @ApiOperation({ summary: 'List all ingredient categories' })
  @ApiResponse({ status: 200, description: '8 categories' })
  async listCategories(
    @Query() _raw: Record<string, string | undefined>,
  ): Promise<{ data: CategoryView[] }> {
    // Query is optional and not used today — schema validates it
    // anyway so a future `?id=` filter can be wired in without
    // breaking clients.
    IngredientsCategoryQuerySchema.safeParse(_raw ?? {});
    const items = await this.svc.listCategories();
    return { data: items };
  }

  // NOTE: route order matters. `categories` and `nutrition` MUST
  // come BEFORE the `:id` route so the literal segments aren't
  // captured as ids. We rely on NestJS evaluating `@Get('...')`
  // patterns in registration order; we declare them in this order
  // explicitly.

  @Get(':id/nutrition')
  @ApiOperation({
    summary: 'Get nutrition data for an ingredient (200 + null if not yet populated)',
  })
  @ApiResponse({ status: 200, description: 'Nutrition row or null' })
  @ApiResponse({ status: 404, description: 'INGREDIENT_NOT_FOUND' })
  async nutrition(
    @Param() params: Record<string, string>,
  ): Promise<{ data: NutritionView | null }> {
    const parsed = IngredientsNutritionParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const data = await this.svc.getNutrition(parsed.data.id);
    return { data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single ingredient by id' })
  @ApiResponse({ status: 200, description: 'Ingredient with category + aliases' })
  @ApiResponse({ status: 404, description: 'INGREDIENT_NOT_FOUND' })
  async get(@Param() params: Record<string, string>): Promise<{ data: IngredientView }> {
    const parsed = IngredientsIdParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw validationError(parsed.error.issues);
    }
    const data = await this.svc.getIngredient(parsed.data.id);
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
    message: 'Invalid query parameters',
    details: { fields },
  });
}
