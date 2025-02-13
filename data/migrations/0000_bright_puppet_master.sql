CREATE TABLE `candidate_words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conditional_guesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round` integer NOT NULL,
	`previous_guess` text NOT NULL,
	`feedback` text NOT NULL,
	`best_guess` text NOT NULL,
	`expected_moves` real NOT NULL,
	`all_possibilities` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conditional_guesses_round_previous_guess_feedback_unique` ON `conditional_guesses` (`round`,`previous_guess`,`feedback`);--> statement-breakpoint
CREATE TABLE `round1` (
	`id` integer PRIMARY KEY NOT NULL,
	`best_guess` text NOT NULL
);
