CREATE INDEX `analytics_events_event_ts_idx` ON `analytics_events` (`event`,`ts`);--> statement-breakpoint
CREATE INDEX `analytics_events_event_user_idx` ON `analytics_events` (`event`,`user_key`,`day`);--> statement-breakpoint
CREATE INDEX `metal_rates_fetched_idx` ON `metal_rates` (`fetched_at`);