-- Canonical subtype is server-owned. Historical prompts remain unclassified.
ALTER TABLE writing_prompts ADD COLUMN IF NOT EXISTS task_category varchar(60);
