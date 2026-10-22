import { Inject, Injectable, Logger } from '@nestjs/common';
import { isOverdue } from '@remindora/core';
import { DateTime } from 'luxon';
import { AccessService } from '../../common/access.service';
import { EntitlementsService } from '../../common/entitlements.service';
import { PrismaService } from '../../common/prisma.service';
import { RateLimiter } from '../../common/rate-limit';
import { ENV, type ServerEnv } from '../../config';
import { TasksService } from '../tasks/tasks.service';
import { AnthropicProvider, HeuristicProvider, type AiProvider, type AiTask, type PlanContext } from './providers';

@Injectable()
export class AiService {
  private readonly logger = new Logger('AI');
  private readonly provider: AiProvider;
  private readonly fallback = new HeuristicProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly entitlements: EntitlementsService,
    private readonly tasks: TasksService,
    private readonly limiter: RateLimiter,
    @Inject(ENV) env: ServerEnv,
  ) {
    this.provider = env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL) : this.fallback;
  }

  /** Runs on the configured provider; on provider failure degrades to the deterministic planner. */
  private async run<T>(fn: (p: AiProvider) => Promise<T>): Promise<T & { provider: string }> {
    try {
      return { ...(await fn(this.provider)), provider: this.provider.name };
    } catch (e) {
      if (this.provider === this.fallback) throw e;
      this.logger.warn(`AI provider failed, using heuristic planner: ${(e as Error).message}`);
      return { ...(await fn(this.fallback)), provider: this.fallback.name };
    }
  }

  private async guard(userId: string) {
    await this.entitlements.assertFeature(userId, 'ai');
    await this.limiter.hit(`ai:u:${userId}`, 30, 3600);
  }

  private async context(userId: string): Promise<{ ctx: PlanContext; tz: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = DateTime.now().setZone(user.timezone);
    return { tz: user.timezone, ctx: { timezone: user.timezone, now: now.toISO()!, dayStart: '08:00', dayEnd: '19:00' } };
  }

  private async todayTasks(userId: string, tz: string): Promise<AiTask[]> {
    const list = await this.tasks.query(userId, { view: 'today', limit: 40 });
    const projects = new Map((await this.prisma.project.findMany({ where: { id: { in: list.map((t) => t.projectId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return list.map((t) => ({ id: t.id, title: t.title, priority: t.priority, dueAt: t.dueAt, durationMinutes: t.durationMinutes, project: projects.get(t.projectId) ?? '', overdue: isOverdue(t, new Date(), tz) }));
  }

  async planDay(userId: string) {
    await this.guard(userId);
    const { ctx, tz } = await this.context(userId);
    const tasks = await this.todayTasks(userId, tz);
    const ids = new Set(tasks.map((t) => t.id));
    const plan = await this.run((p) => p.planDay(tasks, ctx));
    // Never trust ids the model invented.
    return { ...plan, blocks: plan.blocks.filter((b) => ids.has(b.taskId)), deferred: plan.deferred.filter((d) => ids.has(d.taskId)) };
  }

  async breakdown(userId: string, taskId: string) {
    await this.guard(userId);
    const { task } = await this.access.task(userId, taskId, 'task.read');
    return this.run((p) => p.breakdown({ title: task.title, description: task.description }));
  }

  async prioritize(userId: string) {
    await this.guard(userId);
    const { ctx, tz } = await this.context(userId);
    const tasks = await this.todayTasks(userId, tz);
    const ids = new Set(tasks.map((t) => t.id));
    const out = await this.run((p) => p.prioritize(tasks, ctx));
    return { ...out, suggestions: out.suggestions.filter((s) => ids.has(s.taskId)) };
  }
}
