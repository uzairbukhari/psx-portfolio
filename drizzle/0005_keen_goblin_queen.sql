CREATE TABLE `quote_refreshes` (
	`ticker` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`as_of` text NOT NULL,
	`quote_date` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	`updated_at` text NOT NULL
);
