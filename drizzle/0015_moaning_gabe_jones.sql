CREATE TABLE `facts_requests` (
	`ticker` text PRIMARY KEY NOT NULL,
	`requested_at` text NOT NULL,
	`attempted_at` text,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `gather_started_at` text;--> statement-breakpoint
ALTER TABLE `monthly_recommendations` ADD `pending_tickers` text;