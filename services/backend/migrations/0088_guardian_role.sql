-- Parent Connect: a guardian is a real, separate account role. It never reuses the student role.
-- ADD VALUE lives alone in its own migration: PostgreSQL cannot use a new enum value in the same transaction.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'guardian';
