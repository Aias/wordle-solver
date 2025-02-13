import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";

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

/**
 * Table for storing the mapping from a feedback pattern to the optimal second guess.
 * The feedback pattern is stored as a string (e.g. "01210"), where:
 *   0 = gray, 1 = yellow, 2 = green.
 */
export const round2 = sqliteTable("round2", {
  feedback: text("feedback").primaryKey(),
  bestGuess: text("best_guess").notNull(),
  possibilities: text("possibilities").notNull(),
  expectedMoves: real("expected_moves").notNull(),
});
