CREATE TABLE `candidate_words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `round1` (
	`id` integer PRIMARY KEY NOT NULL,
	`best_guess` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `round2` (
	`feedback` text PRIMARY KEY NOT NULL,
	`best_guess` text NOT NULL
);
