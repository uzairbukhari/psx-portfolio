CREATE TABLE `user_roles` (
	`email` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `user_roles` (`email`, `role`, `created_at`) VALUES ('suzairbukhari@gmail.com', 'super_admin', '2026-09-30T00:00:00.000Z');
