CREATE TABLE `recommendation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`recommendation_id` text NOT NULL,
	`phase` text NOT NULL,
	`cycle` integer NOT NULL,
	`state` text NOT NULL,
	`provider_response_id` text,
	`request` text NOT NULL,
	`response` text,
	`reserved_usd` real NOT NULL,
	`cost_usd` real,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recommendation_attempts_run` ON `recommendation_attempts` (`recommendation_id`);