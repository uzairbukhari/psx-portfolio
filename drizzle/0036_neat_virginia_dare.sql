CREATE TABLE `platform_metrics` (
	`day` text NOT NULL,
	`script` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`limit_hits` integer DEFAULT 0 NOT NULL,
	`cpu_p50` real,
	`cpu_p99` real,
	`statuses` text DEFAULT '{}' NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`day`, `script`)
);
--> statement-breakpoint
CREATE TABLE `server_errors` (
	`route` text NOT NULL,
	`code` text NOT NULL,
	`minute` text NOT NULL,
	`status` integer NOT NULL,
	`n` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`route`, `code`, `minute`)
);
--> statement-breakpoint
CREATE INDEX `server_errors_minute_idx` ON `server_errors` (`minute`);