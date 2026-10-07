CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`day` text NOT NULL,
	`user_key` text,
	`anon_id` text,
	`session_id` text NOT NULL,
	`platform` text NOT NULL,
	`app_version` text,
	`event` text NOT NULL,
	`props` text,
	`is_admin` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_events_day_idx` ON `analytics_events` (`day`,`event`);--> statement-breakpoint
CREATE INDEX `analytics_events_user_idx` ON `analytics_events` (`user_key`,`day`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`email` text PRIMARY KEY NOT NULL,
	`first_seen_at` text NOT NULL,
	`first_platform` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_platform` text NOT NULL,
	`origin` text NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `app_users` (`email`,`first_seen_at`,`first_platform`,`last_seen_at`,`last_platform`,`origin`)
SELECT `email`, MIN(`created_at`), MAX(`platform`), MAX(`last_seen_at`), MAX(`platform`), 'existing' FROM `mobile_sessions` GROUP BY `email`;
