CREATE TABLE `chat_checkpoints` (
	`owner` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`lease_token` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `request_id`),
	FOREIGN KEY (`owner`,`request_id`) REFERENCES `chat_runs`(`owner`,`id`) ON UPDATE no action ON DELETE cascade
);
