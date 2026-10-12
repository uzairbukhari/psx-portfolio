CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`source` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`ok` integer NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job`,`started_at`);