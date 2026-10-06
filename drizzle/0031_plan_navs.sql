CREATE TABLE `plan_navs` (
	`fund_id` text NOT NULL,
	`date` text NOT NULL,
	`nav` real NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`fund_id`, `date`)
);
