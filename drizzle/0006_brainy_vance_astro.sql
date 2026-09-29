CREATE TABLE `market_summary_refreshes` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL,
	`updated_at` text NOT NULL
);
