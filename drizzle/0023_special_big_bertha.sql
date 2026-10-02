CREATE TABLE `ipo_offers` (
	`ticker` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`offer_price` real,
	`allotment_date` text,
	`listing_date` text,
	`evidence` text,
	`verification` text,
	`reason` text,
	`error` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_requests` (
	`kind` text NOT NULL,
	`ticker` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`dispatched_at` text,
	`started_at` text,
	`completed_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`rows_found` integer,
	`coverage_from` text,
	`error` text,
	PRIMARY KEY(`kind`, `ticker`)
);
