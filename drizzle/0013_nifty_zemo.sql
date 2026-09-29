CREATE TABLE `dividend_announcements` (
	`ticker` text NOT NULL,
	`book_closure_start` text NOT NULL,
	`kind` text NOT NULL,
	`book_closure_end` text NOT NULL,
	`announced_on` text NOT NULL,
	`period` text NOT NULL,
	`details` text NOT NULL,
	`percent` real,
	`per_share_rs` real,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`ticker`, `book_closure_start`, `announced_on`, `kind`)
);
