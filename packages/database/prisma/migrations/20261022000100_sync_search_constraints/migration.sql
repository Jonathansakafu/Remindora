-- Offline sync cursor: every insert/update of a syncable row takes the next value
-- of a global sequence. Clients pull `syncSeq > cursor` to catch up, including
-- soft-deleted tombstones.
CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE OR REPLACE FUNCTION remindora_set_sync_seq() RETURNS trigger AS $$
BEGIN
  NEW."syncSeq" := nextval('sync_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_sync_seq BEFORE INSERT OR UPDATE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION remindora_set_sync_seq();
CREATE TRIGGER project_sync_seq BEFORE INSERT OR UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION remindora_set_sync_seq();

-- Advanced search: trigram index for fast case-insensitive substring matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX task_title_trgm ON "Task" USING gin (title gin_trgm_ops);
CREATE INDEX task_description_trgm ON "Task" USING gin (description gin_trgm_ops);

-- Exactly one Inbox per workspace.
CREATE UNIQUE INDEX project_one_inbox ON "Project" ("workspaceId") WHERE "isInbox" AND "deletedAt" IS NULL;

-- Entitlement rows are unique per (plan, key) for plan defaults and per (user, key) for overrides.
CREATE UNIQUE INDEX entitlement_plan_key ON "Entitlement" ("plan", "key") WHERE "userId" IS NULL;
CREATE UNIQUE INDEX entitlement_user_key ON "Entitlement" ("userId", "key") WHERE "userId" IS NOT NULL;

-- Due reminders are swept by (nextFireAt) for active/snoozed states only.
CREATE INDEX reminder_due_sweep ON "Reminder" ("nextFireAt") WHERE "state" IN ('ACTIVE', 'SNOOZED');

-- Sanity constraints.
ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT pref_intervals_positive CHECK ("criticalRepeatMinutes" >= 5 AND "highRepeatMinutes" >= 5 AND "maxRealerts" >= 0);
ALTER TABLE "Task" ADD CONSTRAINT task_duration_positive CHECK ("durationMinutes" IS NULL OR "durationMinutes" > 0);
ALTER TABLE "FeatureFlag" ADD CONSTRAINT flag_rollout_range CHECK ("rolloutPercent" BETWEEN 0 AND 100);
