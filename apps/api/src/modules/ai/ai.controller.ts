import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../../common/auth';
import type { AuthContext } from '../../common/request';
import { AiService } from './ai.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('plan-day')
  @HttpCode(200)
  @ApiOperation({ summary: 'Time-blocked plan for the rest of today (Premium)' })
  planDay(@Auth() a: AuthContext) {
    return this.ai.planDay(a.userId);
  }

  @Post('breakdown/:taskId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suggest checklist steps for a task (Premium)' })
  breakdown(@Auth() a: AuthContext, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.ai.breakdown(a.userId, taskId);
  }

  @Post('prioritize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suggest priorities for today’s tasks (Premium)' })
  prioritize(@Auth() a: AuthContext) {
    return this.ai.prioritize(a.userId);
  }
}
