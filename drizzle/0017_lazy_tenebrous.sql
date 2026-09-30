CREATE TABLE `rate_limits` (
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `action`)
);
