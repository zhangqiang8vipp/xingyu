-- Additive only: no revision is deleted and no historical content is changed
-- by applying the schema migration. Data conversion is a separate, bounded,
-- opt-in operation with verified reverse reconstruction.
ALTER TABLE document_revisions ADD COLUMN reverse_patch TEXT;
--> statement-breakpoint
ALTER TABLE document_revisions ADD COLUMN original_content_length INTEGER;
--> statement-breakpoint
ALTER TABLE document_revisions ADD COLUMN compaction_state TEXT NOT NULL DEFAULT 'pending';
