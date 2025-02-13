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

export const bestGuesses = sqliteTable(
  "best_guesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    round: integer("round").notNull(),
    previousGuess: text("previous_guess"),
    feedback: text("feedback"),
    bestGuess: text("best_guess").notNull(),
    expectedMoves: real("expected_moves").notNull(),
    candidateWords: text("candidate_words").notNull(),
    candidateHash: text("candidate_hash"),
  },
  (table) => [
    index("idx_lookup").on(
      table.round,
      table.previousGuess,
      table.feedback,
      table.candidateHash
    ),
    index("idx_round_guess").on(table.round, table.previousGuess),
  ]
);
