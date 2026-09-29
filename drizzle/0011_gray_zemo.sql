ALTER TABLE `monthly_recommendations` ADD `workflow_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `snapshot` text;--> statement-breakpoint
ALTER TABLE `recommendation_attempts` ADD `batch_key` text DEFAULT 'legacy' NOT NULL;