-- Migration to drop unique constraint on pipeline_stages and add index
ALTER TABLE "pipeline_stages" DROP CONSTRAINT IF EXISTS "pipeline_stages_workspace_id_sort_order_key";
CREATE INDEX IF NOT EXISTS "pipeline_stages_workspace_id_sort_order_idx" ON "pipeline_stages" ("workspace_id", "sort_order");