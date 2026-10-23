-- Remindora is free with full access: drop stored plan-level limits/flags so the catalog
-- defaults (everything enabled) apply. Per-user overrides are kept.
DELETE FROM "Entitlement" WHERE "userId" IS NULL;
