-- Password sign-in and password reset.
ALTER TYPE "LinkMethod" ADD VALUE 'PASSWORD';
ALTER TYPE "ChallengePurpose" ADD VALUE 'PASSWORD_RESET';
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
