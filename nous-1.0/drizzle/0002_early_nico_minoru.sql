CREATE TABLE `chat_runs` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`profile_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`message_id` text,
	`user_id` text,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_chat_runs_owner_created` ON `chat_runs` (`owner`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_runs_owner_active` ON `chat_runs` (`owner`) WHERE "chat_runs"."status" = 'running';