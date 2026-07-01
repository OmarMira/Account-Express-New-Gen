-- Human-confirmed smart classification foundation.
-- Adds explicit workflow state while keeping role nullable for unconfirmed entities.
ALTER TABLE "EntityContext"
  ADD COLUMN "classificationStatus" TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION;

ALTER TABLE "EntityContext"
  ALTER COLUMN "role" DROP NOT NULL;

DO $$
DECLARE
  legacy_otro_count integer;
BEGIN
  SELECT COUNT(*) INTO legacy_otro_count
  FROM "EntityContext"
  WHERE "role" = 'OTRO';

  RAISE NOTICE 'HCSC foundation migration: legacy OTRO contexts to mark pending review: %', legacy_otro_count;
END $$;

-- Treat legacy OTRO as uncertainty, not a final classification.
-- This preserves pattern, roles, userDescription, transactionDirection, glAccountId,
-- source, timestamps, and any external references. BankRule rows are intentionally
-- untouched so existing automation data is not silently created, deleted,
-- activated, deactivated, or overwritten by this migration.
UPDATE "EntityContext"
SET
  "role" = NULL,
  "classificationStatus" = 'PENDING_REVIEW',
  "classificationConfidence" = NULL
WHERE "role" = 'OTRO';

CREATE INDEX "EntityContext_companyId_classificationStatus_idx"
  ON "EntityContext"("companyId", "classificationStatus");
