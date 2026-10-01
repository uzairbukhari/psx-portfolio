CREATE TABLE `mobile_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`device_name` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `mobile_sessions_email_idx` ON `mobile_sessions` (`email`);