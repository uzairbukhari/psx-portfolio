CREATE TABLE `ai_company_profiles` (
	`ticker` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_company_research` (
	`ticker` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`inputs_hash` text NOT NULL,
	`price_at_report` real,
	`researched_at` text NOT NULL,
	`checked_at` text NOT NULL,
	`carried_forward` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_financial_extracts` (
	`ticker` text NOT NULL,
	`doc_key` text NOT NULL,
	`period` text,
	`payload` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`ticker`, `doc_key`)
);
--> statement-breakpoint
CREATE TABLE `ai_macro_briefs` (
	`month` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_news_items` (
	`url` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`published_on` text,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_news_ticker` ON `ai_news_items` (`ticker`,`published_on`);--> statement-breakpoint
CREATE TABLE `ai_rankings` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`tickers_hash` text NOT NULL,
	`payload` text NOT NULL,
	`prices` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_rankings_month` ON `ai_rankings` (`month`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_research_requests` (
	`ticker` text PRIMARY KEY NOT NULL,
	`requested_at` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` text,
	`finished_at` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `ai_research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`models` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`stats` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_ai_research_runs_started` ON `ai_research_runs` (`started_at`);