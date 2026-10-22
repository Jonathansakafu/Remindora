import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { AccessService } from './common/access.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth';
import { EntitlementsService } from './common/entitlements.service';
import { AllExceptionsFilter } from './common/errors';
import { PrismaService } from './common/prisma.service';
import { RateLimitGuard, RateLimiter } from './common/rate-limit';
import { RedisService } from './common/redis.service';
import { StorageService } from './common/storage/storage.service';
import { buildKeys, ENV, KEYS, loadServerEnv, type ServerEnv } from './config';
import { ActivityService } from './modules/activity/activity.service';
import { AdminController } from './modules/admin/admin.controller';
import { AiController } from './modules/ai/ai.controller';
import { AiService } from './modules/ai/ai.service';
import { AnalyticsController } from './modules/analytics/analytics.controller';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { OAuthService } from './modules/auth/oauth.service';
import { BillingController } from './modules/billing/billing.controller';
import { BillingService } from './modules/billing/billing.service';
import { DevicesController } from './modules/devices/devices.controller';
import { DevicesService } from './modules/devices/devices.service';
import { HealthController } from './modules/health/health.controller';
import { IntegrationsController } from './modules/integrations/integrations.controller';
import { IntegrationsService } from './modules/integrations/integrations.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { PairingController } from './modules/pairing/pairing.controller';
import { PairingService } from './modules/pairing/pairing.service';
import { PlanningController } from './modules/planning/planning.controller';
import { PlanningService } from './modules/planning/planning.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { ProjectsService } from './modules/projects/projects.service';
import { SyncController } from './modules/sync/sync.controller';
import { ReminderScheduler } from './modules/tasks/reminder-scheduler.service';
import { TaskExtrasService } from './modules/tasks/task-extras.service';
import { AttachmentBlobController, TasksController } from './modules/tasks/tasks.controller';
import { TasksService } from './modules/tasks/tasks.service';
import { WellbeingController } from './modules/wellbeing/wellbeing.controller';
import { WellbeingService } from './modules/wellbeing/wellbeing.service';
import { WorkspacesController } from './modules/workspaces/workspaces.controller';
import { WorkspacesService } from './modules/workspaces/workspaces.service';
import { QueueService } from './queues/queue.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RealtimeService } from './realtime/realtime.service';

/** Strips query strings from logged URLs: they can carry signed links or one-time codes. */
function safeUrl(url: string | undefined) {
  return (url ?? '').split('?')[0];
}

@Global()
@Module({})
class ConfigModule {
  static forRoot(env: ServerEnv) {
    return {
      module: ConfigModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: KEYS, useValue: buildKeys(env) },
      ],
      exports: [ENV, KEYS],
    };
  }
}

export function createAppModule(env: ServerEnv = loadServerEnv()) {
  @Module({
    imports: [
      ConfigModule.forRoot(env),
      LoggerModule.forRoot({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' || req.url === '/metrics' },
          // Never log credentials, codes or tokens (QR pairing tokens included).
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-claim-secret"]', 'res.headers["set-cookie"]', 'req.body', 'req.query'],
            remove: true,
          },
          serializers: {
            req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, url: safeUrl(req.url) }),
          },
        },
      }),
    ],
    controllers: [
      HealthController,
      AuthController,
      DevicesController,
      PairingController,
      WorkspacesController,
      ProjectsController,
      TasksController,
      AttachmentBlobController,
      NotificationsController,
      PlanningController,
      WellbeingController,
      AnalyticsController,
      BillingController,
      AdminController,
      IntegrationsController,
      SyncController,
      AiController,
    ],
    providers: [
      PrismaService,
      RedisService,
      StorageService,
      RateLimiter,
      AuditService,
      AccessService,
      EntitlementsService,
      QueueService,
      RealtimeService,
      RealtimeGateway,
      AuthGuard,
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_GUARD, useExisting: AuthGuard },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ActivityService,
      AuthService,
      OAuthService,
      DevicesService,
      PairingService,
      WorkspacesService,
      ProjectsService,
      ReminderScheduler,
      NotificationsService,
      TasksService,
      TaskExtrasService,
      PlanningService,
      WellbeingService,
      AnalyticsService,
      BillingService,
      IntegrationsService,
      AiService,
    ],
  })
  class AppModule {}
  return AppModule;
}
