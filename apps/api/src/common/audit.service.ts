import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@remindora/database';
import { PrismaService } from './prisma.service';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'denied' | 'failure';
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Security audit trail. Never pass secrets, codes or tokens in metadata. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    try {
      await db.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          sessionId: entry.sessionId ?? null,
          workspaceId: entry.workspaceId ?? null,
          targetType: entry.targetType,
          targetId: entry.targetId,
          outcome: entry.outcome ?? 'success',
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      // Inside a transaction the caller's failure handling applies; standalone, never fail the request on audit errors.
      if (tx) throw e;
      this.logger.error(`audit write failed for ${entry.action}: ${(e as Error).message}`);
    }
  }
}
