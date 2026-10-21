-- Shared daily budget and per-visitor quota for hosted model calls.
-- Only pseudonymous digests are stored; never IPs, prompts or API keys.
CREATE TABLE ai_question_quotas (
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
  PRIMARY KEY(day,bucket,identity_hash)
);
--> statement-breakpoint
CREATE INDEX ai_question_quotas_day_idx ON ai_question_quotas(day);
