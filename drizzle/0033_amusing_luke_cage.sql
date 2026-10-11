CREATE TABLE `fund_payouts` (
	`mufap_id` text NOT NULL,
	`payout_date` text NOT NULL,
	`per_unit` real NOT NULL,
	`ex_nav` real NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`mufap_id`, `payout_date`)
);
