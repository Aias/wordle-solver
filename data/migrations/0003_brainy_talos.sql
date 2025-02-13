DROP TABLE `round2`;--> statement-breakpoint
CREATE UNIQUE INDEX `conditional_guesses_round_previous_guess_feedback_unique` ON `conditional_guesses` (`round`,`previous_guess`,`feedback`);