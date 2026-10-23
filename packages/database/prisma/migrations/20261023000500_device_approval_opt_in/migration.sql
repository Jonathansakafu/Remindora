-- Approving new sign-ins from another device is now opt-in (the emailed code already proves the
-- address). Existing accounts switch to the new default; sign-ins stuck waiting for an approval
-- are expired so those devices return to the sign-in screen.
ALTER TABLE "User" ALTER COLUMN "requireDeviceApproval" SET DEFAULT false;
UPDATE "User" SET "requireDeviceApproval" = false;
UPDATE "EmailChallenge" SET "status" = 'EXPIRED' WHERE "status" = 'AWAITING_APPROVAL';
