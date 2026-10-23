-- Tasks with a specific time now always get a reminder at that time (any priority).
-- Give upcoming open timed tasks created under the old rules (no reminder) one now.
-- The worker sweep picks rows up by nextFireAt; quiet hours are re-checked when they fire.
INSERT INTO "Reminder" ("id", "taskId", "userId", "offsetMinutes", "state", "nextFireAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", COALESCE(t."assigneeId", t."creatorId"), 0, 'ACTIVE', t."dueAt", now(), now()
FROM "Task" t
WHERE t."dueAt" > now()
  AND t."allDay" = false
  AND t."completedAt" IS NULL
  AND t."deletedAt" IS NULL
  AND t."archived" = false
  AND NOT EXISTS (SELECT 1 FROM "Reminder" r WHERE r."taskId" = t."id");
