CREATE TABLE `cmy_games` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`mode` text DEFAULT 'forehead' NOT NULL,
	`word_source` text DEFAULT 'random' NOT NULL,
	`master_player_id` text,
	`phase` text DEFAULT 'play' NOT NULL,
	`words` text DEFAULT '{}' NOT NULL,
	`order` text NOT NULL,
	`turn_index` integer DEFAULT 0 NOT NULL,
	`question` text,
	`step_deadline` integer,
	`round_deadline` integer,
	`solved` text DEFAULT '{}' NOT NULL,
	`used_words` text DEFAULT '[]' NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cmy_games_room_unique` ON `cmy_games` (`room_id`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `cmy_mode` text DEFAULT 'forehead';--> statement-breakpoint
ALTER TABLE `rooms` ADD `cmy_word_source` text DEFAULT 'random';--> statement-breakpoint
ALTER TABLE `rooms` ADD `cmy_master_player_id` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `cmy_timer` text DEFAULT 'on';