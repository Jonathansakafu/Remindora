import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/** Provider-agnostic AI port. Features call this; the implementation is chosen by AI_PROVIDER. */

export interface AiTask {
  id: string;
  title: string;
  priority: string;
  dueAt: string | null;
  durationMinutes: number | null;
  project: string;
  overdue: boolean;
}

export const dayPlanSchema = z.object({
  summary: z.string(),
  blocks: z.array(z.object({ taskId: z.string(), start: z.string().describe('Local time HH:MM'), minutes: z.number().int(), reason: z.string() })),
  deferred: z.array(z.object({ taskId: z.string(), reason: z.string() })),
});
export type DayPlan = z.infer<typeof dayPlanSchema>;

export const breakdownSchema = z.object({ steps: z.array(z.object({ title: z.string(), minutes: z.number().int() })) });
export type Breakdown = z.infer<typeof breakdownSchema>;

export const prioritySchema = z.object({
  suggestions: z.array(z.object({ taskId: z.string(), priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), reason: z.string() })),
});
export type PrioritySuggestions = z.infer<typeof prioritySchema>;

export interface PlanContext {
  timezone: string;
  now: string;
  dayStart: string;
  dayEnd: string;
}

export interface AiProvider {
  readonly name: string;
  planDay(tasks: AiTask[], ctx: PlanContext): Promise<DayPlan>;
  breakdown(task: { title: string; description: string | null }): Promise<Breakdown>;
  prioritize(tasks: AiTask[], ctx: PlanContext): Promise<PrioritySuggestions>;
}

const RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

/** Deterministic, offline planner. Used when no model provider is configured, and as a fallback. */
export class HeuristicProvider implements AiProvider {
  readonly name = 'heuristic';

  async planDay(tasks: AiTask[], ctx: PlanContext): Promise<DayPlan> {
    const sorted = [...tasks].sort((a, b) => Number(b.overdue) - Number(a.overdue) || RANK[b.priority]! - RANK[a.priority]! || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
    const [sh, sm] = ctx.dayStart.split(':').map(Number);
    const [eh, em] = ctx.dayEnd.split(':').map(Number);
    let cursor = Math.max(sh! * 60 + sm!, Number(ctx.now.slice(11, 13)) * 60 + Number(ctx.now.slice(14, 16)));
    cursor = Math.ceil(cursor / 15) * 15;
    const end = eh! * 60 + em!;
    const blocks: DayPlan['blocks'] = [];
    const deferred: DayPlan['deferred'] = [];
    for (const t of sorted) {
      const minutes = t.durationMinutes ?? (RANK[t.priority]! >= 3 ? 60 : 30);
      if (cursor + minutes > end) {
        deferred.push({ taskId: t.id, reason: 'Not enough time left today' });
        continue;
      }
      const reason = t.overdue ? 'Overdue — clear it first' : RANK[t.priority]! >= 3 ? `${t.priority.toLowerCase()} priority` : 'Fits the remaining time';
      blocks.push({ taskId: t.id, start: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`, minutes, reason });
      cursor += minutes + 10; // 10-minute buffer between blocks
    }
    return { summary: `${blocks.length} tasks scheduled${deferred.length ? `, ${deferred.length} deferred` : ''}. Hardest and most urgent work first.`, blocks, deferred };
  }

  async breakdown(task: { title: string }): Promise<Breakdown> {
    return {
      steps: [
        { title: `Clarify the outcome for “${task.title}”`, minutes: 10 },
        { title: 'Gather inputs and materials', minutes: 20 },
        { title: 'Do a first draft / first pass', minutes: 45 },
        { title: 'Review and refine', minutes: 20 },
        { title: 'Share or mark done', minutes: 5 },
      ],
    };
  }

  async prioritize(tasks: AiTask[]): Promise<PrioritySuggestions> {
    const now = Date.now();
    return {
      suggestions: tasks.map((t) => {
        const hours = t.dueAt ? (new Date(t.dueAt).getTime() - now) / 3_600_000 : Infinity;
        const priority = t.overdue || hours < 4 ? 'CRITICAL' : hours < 24 ? 'HIGH' : hours < 72 ? 'MEDIUM' : t.dueAt ? 'LOW' : 'NONE';
        const reason = t.overdue ? 'Overdue' : Number.isFinite(hours) ? `Due in ${Math.max(1, Math.round(hours))}h` : 'No due date';
        return { taskId: t.id, priority, reason };
      }),
    };
  }
}

/**
 * Claude via the official SDK. Structured JSON output (`output_config.format`)
 * guarantees schema-shaped responses; server-side refusal fallbacks
 * (`fallbacks: "default"`) re-run a declined request on Anthropic's recommended
 * fallback model.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private async structured<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: jsonSchema } },
      system,
      messages: [{ role: 'user', content: user }],
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    if (response.stop_reason === 'refusal') throw new Error('The AI provider declined this request');
    if (response.stop_reason === 'max_tokens') throw new Error('The AI response was truncated');
    const text = response.content.find((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')?.text;
    if (!text) throw new Error('Empty AI response');
    return schema.parse(JSON.parse(text));
  }

  planDay(tasks: AiTask[], ctx: PlanContext) {
    return this.structured(
      dayPlanSchema,
      'You are a pragmatic planning assistant inside a task manager. Build a realistic time-blocked plan for the rest of the user’s day. Respect due times, put overdue and critical work first, leave short buffers between blocks, and defer what doesn’t fit. Only use task ids from the input. Reasons are one short sentence.',
      JSON.stringify({ context: ctx, tasks }),
    );
  }

  breakdown(task: { title: string; description: string | null }) {
    return this.structured(
      breakdownSchema,
      'Break the task into 3–8 concrete, actionable checklist steps in the order they should be done, each with a realistic time estimate in minutes. Step titles start with a verb and stay under 80 characters.',
      JSON.stringify(task),
    );
  }

  prioritize(tasks: AiTask[], ctx: PlanContext) {
    return this.structured(
      prioritySchema,
      'Suggest a priority (NONE, LOW, MEDIUM, HIGH, CRITICAL) for each task based on urgency (due date relative to now) and apparent importance. CRITICAL is only for things that will cause real harm if missed today. Give one short reason each. Only use task ids from the input.',
      JSON.stringify({ context: ctx, tasks }),
    );
  }
}
