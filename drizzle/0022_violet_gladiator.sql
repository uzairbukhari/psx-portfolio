CREATE TABLE `security_catalog` (
	`ticker` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sector` text,
	`security_type` text,
	`source` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
