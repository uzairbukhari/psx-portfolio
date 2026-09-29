CREATE TABLE `company_facts` (
	`ticker` text PRIMARY KEY NOT NULL,
	`fetched_on` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL
);
