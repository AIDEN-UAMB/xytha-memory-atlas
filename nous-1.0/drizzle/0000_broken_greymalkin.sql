CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`profile_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memories_owner_profile` ON `memories` (`owner`,`profile_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`feedback` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_owner_profile` ON `messages` (`owner`,`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`birth` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_profiles_owner` ON `profiles` (`owner`);