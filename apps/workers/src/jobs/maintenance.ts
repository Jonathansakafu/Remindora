import type { Deps } from '../deps';

/** Housekeeping: expire stale auth artefacts, purge old trash and old event logs. */
export async function runMaintenance(d: Deps, now = new Date()) {
  const [pairings, challenges, trash, events] = await Promise.all([
    d.prisma.devicePairingToken.updateMany({
      where: { OR: [{ status: 'PENDING', expiresAt: { lt: now } }, { status: { in: ['CLAIMED', 'APPROVED'] }, claimExpiresAt: { lt: now } }] },
      data: { status: 'EXPIRED' },
    }),
    d.prisma.emailChallenge.updateMany({ where: { status: { in: ['PENDING', 'AWAITING_APPROVAL', 'APPROVED'] }, expiresAt: { lt: now } }, data: { status: 'EXPIRED' } }),
    d.prisma.task.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } }),
    d.prisma.notificationEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 180 * 86_400_000) } } }),
  ]);
  return { pairingsExpired: pairings.count, challengesExpired: challenges.count, trashPurged: trash.count, eventsPruned: events.count };
}
