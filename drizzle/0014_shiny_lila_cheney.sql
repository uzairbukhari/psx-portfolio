CREATE TABLE `price_history` (
	`ticker` text PRIMARY KEY NOT NULL,
	`eod` text DEFAULT '[]' NOT NULL,
	`intraday` text DEFAULT '[]' NOT NULL,
	`eod_fetched_at` text,
	`intraday_fetched_at` text
);
