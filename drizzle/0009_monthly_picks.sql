CREATE TABLE `monthly_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` real NOT NULL,
	`fee_pct` real DEFAULT 0 NOT NULL,
	`shortlist` text NOT NULL,
	`status` text NOT NULL,
	`provider_response_id` text,
	`result` text,
	`sources` text,
	`error` text,
	`model` text NOT NULL,
	`estimated_cost_usd` real,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_monthly_recommendations_user_created` ON `monthly_recommendations` (`user_id`,`created_at`);
