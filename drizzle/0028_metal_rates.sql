CREATE TABLE `metal_rates` (
	`date` text NOT NULL,
	`metal` text NOT NULL,
	`kind` text NOT NULL,
	`pkr_per_tola` real NOT NULL,
	`source_url` text NOT NULL,
	`source_label` text,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`date`, `metal`, `kind`)
);
