ALTER TABLE `monthly_recommendations` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `deadline_at` text;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `progress` text;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `idempotency_key` text;--> statement-breakpoint
CREATE INDEX `idx_monthly_recommendations_due` ON `monthly_recommendations` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monthly_recommendations_idem` ON `monthly_recommendations` (`user_id`,`idempotency_key`);