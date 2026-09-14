CREATE TABLE `research_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`stage` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_events_job_id` ON `research_events` (`job_id`,`id`);--> statement-breakpoint
CREATE TABLE `research_helpers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_helpers_token_hash_unique` ON `research_helpers` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_research_helpers_user_id` ON `research_helpers` (`user_id`);--> statement-breakpoint
CREATE TABLE `research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ticker` text NOT NULL,
	`company_name` text NOT NULL,
	`sector` text DEFAULT 'Unknown' NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`budget_micros` integer DEFAULT 500000 NOT NULL,
	`spent_micros` integer DEFAULT 0 NOT NULL,
	`reports_found` integer DEFAULT 0 NOT NULL,
	`checkpoint` text,
	`result` text,
	`error` text,
	`lease_owner` text,
	`lease_until` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_research_jobs_user_updated` ON `research_jobs` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_research_jobs_status_lease` ON `research_jobs` (`status`,`lease_until`);