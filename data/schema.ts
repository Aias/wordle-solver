import {
  sqliteTable,
  integer,
  text,
  real,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * Table for storing the valid candidate words.
 */
export const candidateWords = sqliteTable("candidate_words", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  word: text("word").notNull(),
});

export const conditionalGuesses = sqliteTable(
  "conditional_guesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    currentRound: integer("current_round").notNull(),
    previousGuess: text("previous_guess").notNull(),
    feedback: text("feedback").notNull(),
    bestGuess: text("best_guess").notNull(),
    expectedMoves: real("expected_moves").notNull(),
    candidateWords: text("candidate_words").notNull(),
    candidateHash: text("candidate_hash"),
  },
  (table) => [
    index("idx_lookup").on(
      table.currentRound,
      table.previousGuess,
      table.feedback,
      table.candidateHash
    ),
  ]
);
