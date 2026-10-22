CREATE TABLE `facts_benchmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`computed_on` text NOT NULL,
	`sample` integer NOT NULL
);
