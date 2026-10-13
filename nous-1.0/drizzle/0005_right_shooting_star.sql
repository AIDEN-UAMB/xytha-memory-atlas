CREATE TABLE `knowledge_demand` (
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`scope` text NOT NULL,
	`scope_palace` text NOT NULL,
	`main_star` text NOT NULL,
	`purpose` text NOT NULL,
	`target` integer NOT NULL,
	`expanded` integer NOT NULL,
	`injected` integer NOT NULL,
	`cited` integer NOT NULL,
	`modifiers` text NOT NULL,
	PRIMARY KEY(`owner`, `request_id`, `scope`, `scope_palace`, `main_star`),
	FOREIGN KEY (`owner`,`request_id`) REFERENCES `workflow_observations`(`owner`,`request_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_observations` (
	`version` text NOT NULL,
	`created_at` text NOT NULL,
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_revision` integer NOT NULL,
	`route` text NOT NULL,
	`reason_code` text NOT NULL,
	`domain` text NOT NULL,
	`domain_source` text NOT NULL,
	`outcome` text NOT NULL,
	`delivery_state` text NOT NULL,
	`first_t2` text NOT NULL,
	`facts_conditional` integer,
	`actual_calls` integer NOT NULL,
	`input_chars` integer NOT NULL,
	`query_started` integer NOT NULL,
	`query_complete` integer NOT NULL,
	`cohort` text NOT NULL,
	PRIMARY KEY(`owner`, `request_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_observations_owner_date` ON `workflow_observations` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_observations_owner_profile` ON `workflow_observations` (`owner`,`profile_id`);
--> statement-breakpoint
CREATE TRIGGER `observations_delete_profile` AFTER DELETE ON `profiles`
BEGIN
 DELETE FROM `workflow_observations` WHERE `owner`=OLD.`owner` AND `profile_id`=OLD.`id`;
END;
