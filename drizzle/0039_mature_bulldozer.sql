CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`contact_email` text,
	`signed_in` integer DEFAULT 0 NOT NULL,
	`user_key` text,
	`page` text DEFAULT '' NOT NULL,
	`platform` text DEFAULT 'web' NOT NULL,
	`app_version` text,
	`status` text DEFAULT 'new' NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`,`id`);