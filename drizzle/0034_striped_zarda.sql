CREATE TABLE `admin_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_actions_at_idx` ON `admin_actions` (`at`);--> statement-breakpoint
ALTER TABLE `user_roles` ADD `note` text;--> statement-breakpoint
ALTER TABLE `user_roles` ADD `added_by` text;