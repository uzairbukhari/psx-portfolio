CREATE TABLE `security_face_values` (
	`ticker` text NOT NULL,
	`effective_from` text DEFAULT '' NOT NULL,
	`face_value` real NOT NULL,
	`source_url` text NOT NULL,
	`source_label` text,
	`evidence` text,
	`verified_at` text NOT NULL,
	PRIMARY KEY(`ticker`, `effective_from`)
);
--> statement-breakpoint
ALTER TABLE `refresh_requests` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `sector_code` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `sector_name` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `name_source` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `sector_source` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `source_urls` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `resolution_status` text DEFAULT 'incomplete' NOT NULL;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `listing_status` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `profile_fetched_at` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `face_value` real;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `face_value_source` text;--> statement-breakpoint
ALTER TABLE `security_catalog` ADD `face_value_verified_at` text;