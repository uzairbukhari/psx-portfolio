CREATE TABLE `ai_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`month` text NOT NULL,
	`status` text NOT NULL,
	`payload` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_reviews_user_created` ON `ai_reviews` (`user_id`,`created_at`);