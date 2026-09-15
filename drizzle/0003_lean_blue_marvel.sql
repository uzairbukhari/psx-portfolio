CREATE TABLE `quote_refreshes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tickers` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`lease_owner` text,
	`lease_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_quote_refreshes_user_updated` ON `quote_refreshes` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_quote_refreshes_status_lease` ON `quote_refreshes` (`status`,`lease_until`);