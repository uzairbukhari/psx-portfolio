CREATE TABLE `fx_rate_history` (
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`year` text NOT NULL,
	`closes` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`currency`, `kind`, `year`)
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`pkr_per_unit` real NOT NULL,
	`source_url` text NOT NULL,
	`source_label` text,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`currency`, `kind`, `date`)
);
--> statement-breakpoint
CREATE INDEX `fx_rates_date_idx` ON `fx_rates` (`date`);