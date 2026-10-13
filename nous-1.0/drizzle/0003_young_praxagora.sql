ALTER TABLE `messages` ADD `profile_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `revision` integer DEFAULT 1 NOT NULL;