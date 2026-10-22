import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

let shared: PrismaClient | undefined;

/** Process-wide Prisma client. Pass `log` to opt into query logging in development. */
export function getPrisma(options?: ConstructorParameters<typeof PrismaClient>[0]): PrismaClient {
  if (!shared) shared = new PrismaClient(options);
  return shared;
}
export * from './calendar-sync';
