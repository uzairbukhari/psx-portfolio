CREATE TABLE `corporate_actions` (
	`ticker` text NOT NULL,
	`kind` text DEFAULT 'split' NOT NULL,
	`effective_date` text NOT NULL,
	`old_shares` integer NOT NULL,
	`new_shares` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_label` text,
	`verification` text DEFAULT 'curated' NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`ticker`, `kind`, `effective_date`)
);

--> statement-breakpoint
INSERT INTO `corporate_actions` (`ticker`,`kind`,`effective_date`,`old_shares`,`new_shares`,`source_url`,`source_label`,`verification`,`checked_at`) VALUES
('SYS','split','2025-06-02',1,5,'https://digitalpakistan.pk/psx-temporarily-suspends-trading-in-systems-limited/','PSX notice reported by Digital Pakistan: Systems Limited face value Rs 10 to Rs 2, trading suspended 29-30 May 2025, resumed 2 June 2025','curated','2026-10-04'),
('LUCK','split','2025-04-28',1,5,'https://profit.pakistantoday.com.pk/2025/04/15/lucky-cement-to-suspend-trading-from-april-21-to-implement-15-stock-split/','PSX notice reported by Profit: Lucky Cement face value Rs 10 to Rs 2, trading suspended 21-25 April 2025, resumed 28 April 2025','curated','2026-10-04');
