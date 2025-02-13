CREATE TABLE `best_guesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round` integer NOT NULL,
	`previous_guess` text,
	`feedback` text,
	`best_guess` text NOT NULL,
	`expected_moves` real NOT NULL,
	`candidate_words` text NOT NULL,
	`candidate_hash` text
);
--> statement-breakpoint
CREATE INDEX `idx_lookup` ON `best_guesses` (`round`,`previous_guess`,`feedback`,`candidate_hash`);--> statement-breakpoint
CREATE INDEX `idx_round_guess` ON `best_guesses` (`round`,`previous_guess`);--> statement-breakpoint
CREATE TABLE `candidate_words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL
);
