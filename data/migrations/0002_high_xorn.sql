CREATE TABLE `conditional_guesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round` integer NOT NULL,
	`previous_guess` text NOT NULL,
	`feedback` text NOT NULL,
	`best_guess` text NOT NULL,
	`expected_moves` real NOT NULL,
	`all_possibilities` text NOT NULL
);
