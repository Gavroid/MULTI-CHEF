// MC-054 — ShoppingLists controller: active list + budget-fit endpoints.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { FitBudgetResponseDto } from '@multichef/contracts';
import { AppHttpException } from '../common/exception-filter.js';
import { AuthGuard, currentUser } from '../common/auth-guard.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { ApplyBudgetProposalDtoSchema, FitBudgetRequestDtoSchema } from './shopping-lists.dto.js';
import { ShoppingListsService } from './shopping-lists.service.js';

@ApiTags('shopping-lists')
@UseGuards(AuthGuard)
@Controller({ path: 'shopping-lists' })
export class ShoppingListsController {
  constructor(@Inject(ShoppingListsService) private readonly svc: ShoppingListsService) {}

  @Get('active')
  @ApiOperation({ summary: 'The household’s ACTIVE shopping list with items' })
  @ApiResponse({ status: 200, description: 'List or null' })
  async active(@Req() req: FastifyRequest): Promise<unknown> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.getActiveForUser(user.id);
  }

  @Post(':id/fit-budget')
  @ApiOperation({ summary: 'Budget-fit proposals (SUBSTITUTE → DROP_OPTIONAL)' })
  @ApiResponse({ status: 200, description: 'Ranked proposals + achievability' })
  async fitBudget(
    @Req() req: FastifyRequest,
    @Param('id') listId: string,
    @Body() body: unknown,
  ): Promise<FitBudgetResponseDto> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = FitBudgetRequestDtoSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: { fields: { targetBudgetKopecks: ['required integer'] } },
      });
    }
    return this.svc.fitBudget(user.id, listId, parsed.data.targetBudgetKopecks);
  }

  @Post(':id/apply-proposal')
  @ApiOperation({ summary: 'Apply one budget proposal transactionally' })
  @ApiResponse({ status: 200, description: 'applied + recomputed total' })
  async apply(
    @Req() req: FastifyRequest,
    @Param('id') listId: string,
    @Body() body: unknown,
  ): Promise<{ applied: boolean; estimatedTotalKopecks: number }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const parsed = ApplyBudgetProposalDtoSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppHttpException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: { fields: { _: ['invalid proposal'] } },
      });
    }
    return this.svc.applyProposal(user.id, listId, parsed.data);
  }

  /** MC-056: toggle the purchased flag of one item. */
  @Patch('items/:itemId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set the purchased flag of a list item' })
  async setPurchased(
    @Req() req: FastifyRequest,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<{ purchased: boolean }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    const purchased = (body as { purchased?: unknown } | null)?.purchased === true;
    return this.svc.setItemPurchased(user.id, itemId, purchased);
  }

  /** MC-056: complete the list — purchased goods are credited to the pantry. */
  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete the list; purchased items go to the pantry' })
  async complete(
    @Req() req: FastifyRequest,
    @Param('id') listId: string,
  ): Promise<{ completed: boolean; pantryItemsTouched: number }> {
    const user = currentUser(req as unknown as { user: AuthenticatedUser });
    return this.svc.complete(user.id, listId);
  }
}
