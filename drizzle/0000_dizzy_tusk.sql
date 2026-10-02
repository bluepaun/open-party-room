CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`word` text NOT NULL,
	`word_id` integer NOT NULL,
	`liar_player_id` text NOT NULL,
	`order` text NOT NULL,
	`phase` text DEFAULT 'reveal' NOT NULL,
	`explain_index` integer DEFAULT 0 NOT NULL,
	`confirmed` text DEFAULT '[]' NOT NULL,
	`votes` text DEFAULT '{}' NOT NULL,
	`accused_player_id` text,
	`guess` text,
	`result` text,
	`result_reason` text,
	`used_words` text DEFAULT '[]' NOT NULL,
	`turn_ended_at` integer,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_room_name_unique` ON `players` (`room_id`,`name`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`game` text DEFAULT 'lyar' NOT NULL,
	`host_player_id` text,
	`status` text DEFAULT 'lobby' NOT NULL,
	`created_at` integer NOT NULL
);
