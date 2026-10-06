CREATE TABLE `fund_catalog` (
	`mufap_id` text PRIMARY KEY NOT NULL,
	`amc` text NOT NULL,
	`fund_name` text NOT NULL,
	`category` text NOT NULL,
	`sector` text NOT NULL,
	`inception_date` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fund_navs` (
	`mufap_id` text NOT NULL,
	`date` text NOT NULL,
	`nav` real NOT NULL,
	`offer` real NOT NULL,
	`repurchase` real NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`mufap_id`, `date`)
);
