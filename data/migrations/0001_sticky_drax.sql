ALTER TABLE `conditional_guesses` RENAME COLUMN "round" TO "current_round";--> statement-breakpoint
ALTER TABLE `conditional_guesses` RENAME COLUMN "all_possibilities" TO "candidate_words";--> statement-breakpoint
DROP TABLE `round1`;--> statement-breakpoint
DROP INDEX `conditional_guesses_round_previous_guess_feedback_unique`;--> statement-breakpoint
ALTER TABLE `conditional_guesses` ADD `candidate_hash` text;--> statement-breakpoint
CREATE INDEX `idx_lookup` ON `conditional_guesses` (`current_round`,`previous_guess`,`feedback`,`candidate_hash`);