import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '../../common/auth';
import type { AuthContext } from '../../common/request';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Completion rate, overdue, focus, habit consistency, distribution, trends (premium insights on Premium)' })
  summary(@Auth() a: AuthContext, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analytics.summary(a.userId, from, to);
  }

  @Get('report')
  @ApiOperation({ summary: 'Downloadable productivity report (Premium)' })
  async report(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response, @Query('format') format: 'json' | 'csv' = 'json', @Query('from') from?: string, @Query('to') to?: string) {
    const out = await this.analytics.report(a.userId, format === 'csv' ? 'csv' : 'json', from, to);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="remindora-report.csv"');
    }
    return out;
  }
}
