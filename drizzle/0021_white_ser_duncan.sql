CREATE TABLE `refresh_state` (
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`last_attempt_at` text,
	`last_success_at` text,
	`last_error` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`kind`, `key`)
);
--> statement-breakpoint
ALTER TABLE `quote_refreshes` ADD `observed_at` text;