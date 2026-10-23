-- Email reminders are now part of the Free plan (catalog default). Drop any stored plan-level row that disabled them.
DELETE FROM "Entitlement" WHERE "plan" = 'FREE' AND "userId" IS NULL AND "key" = 'reminders.email';
