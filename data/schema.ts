import {
  sqliteTable,
  integer,
  text,
  real,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Table for storing the valid candidate words.
 */
export const candidateWords = sqliteTable("candidate_words", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  word: text("word").notNull(),
});

/**
 * Table for storing the precomputed best first guess.
 * (Since there’s only one best guess for round 1, we can use a fixed ID, e.g. 1.)
 */
export const round1 = sqliteTable("round1", {
  id: integer("id").primaryKey(),
  bestGuess: text("best_guess").notNull(),
});

export const conditionalGuesses = sqliteTable(
  "conditional_guesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    round: integer("round").notNull(),
    previousGuess: text("previous_guess").notNull(),
    feedback: text("feedback").notNull(),
    bestGuess: text("best_guess").notNull(),
    expectedMoves: real("expected_moves").notNull(),
    allPossibilities: text("all_possibilities").notNull(),
  },
  (table) => [unique().on(table.round, table.previousGuess, table.feedback)]
);
