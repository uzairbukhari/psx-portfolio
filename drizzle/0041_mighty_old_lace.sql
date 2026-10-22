CREATE TABLE `d1_usage_days` (
	`day` text PRIMARY KEY NOT NULL,
	`reads` integer DEFAULT 0 NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`by_db` text DEFAULT '{}' NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_usage_created` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_event_ts_idx` ON `analytics_events` (`event`,`ts`);--> statement-breakpoint
CREATE INDEX `analytics_events_event_user_idx` ON `analytics_events` (`event`,`user_key`,`day`);--> statement-breakpoint
CREATE INDEX `company_facts_fetched_idx` ON `company_facts` (`fetched_at`);--> statement-breakpoint
CREATE INDEX `dividend_announcements_fetched_idx` ON `dividend_announcements` (`fetched_at`);--> statement-breakpoint
CREATE INDEX `metal_rates_fetched_idx` ON `metal_rates` (`fetched_at`);