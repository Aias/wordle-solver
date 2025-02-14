# Wordle Solver

This repository contains a **Wordle Solver** implemented in TypeScript using [Bun](https://bun.sh) as the runtime and [Drizzle ORM](https://orm.drizzle.team) for database interactions. The solver uses a mix of precomputation and on-the-fly recursion to determine optimal guesses, storing intermediate results in a local SQLite database for quick lookups.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Installation & Requirements](#installation--requirements)
3. [Database Setup & Migrations](#database-setup--migrations)
4. [Seeding the Database](#seeding-the-database)
5. [Running the Solver](#running-the-solver)
6. [Project Structure](#project-structure)
7. [How It Works](#how-it-works)
   - [Database Schema](#database-schema)
   - [Feedback Calculation](#feedback-calculation)
   - [Recursive Computation & Caching](#recursive-computation--caching)
   - [Round 2 Precomputation](#round-2-precomputation)
8. [License](#license)

---

## Project Overview

**Wordle Solver** is a project designed to calculate the best possible guesses in the game of [Wordle](https://www.nytimes.com/games/wordle/index.html). It uses:

- A **recursive search** with Shannon entropy–based scoring to find guesses that minimize the expected number of remaining moves.
- A **SQLite database** (powered by [Drizzle ORM](https://orm.drizzle.team)) to cache intermediate computations (memoization).
- **Bun** as the runtime environment for faster install and execution times.

This solver currently focuses on:

1. Storing a canonical list of words (`words.txt`).
2. Storing a pre-selected set of optimized first guesses.
3. For each first guess, precomputing the best second, third, etc. guesses for every possible outcome.

You can easily extend the logic to handle deeper round-by-round calculations, or run them on-the-fly.

---

## Installation & Requirements

### 1. Install Bun

To use this project, you must have [Bun](https://bun.sh) installed. Follow the official instructions at [bun.sh](https://bun.sh) to install Bun on your system.

### 2. Install Dependencies

Once Bun is installed, clone this repository and run:

```bash
bun install
```

This will install all necessary dependencies declared in `package.json` (and locked in `bun.lock`).

### Database Setup & Migrations

Drizzle ORM automatically manages database migrations if you set them up correctly. 1. Configure Drizzle: The file `drizzle.config.ts` specifies the SQLite dialect and the location of your migrations folder: `./data/migrations`. 2. Run Migrations: To ensure your local database is up-to-date, run:

```bash
bun run src/migrate.ts
```

This executes `migrate.ts`, which calls Drizzle’s migrator to apply all SQL files in `./data/migrations`.

A local SQLite database file is located at `./data/sqlite.db` (as configured in `drizzle.config.ts`).

### Seeding the Database

Before running the solver, you’ll likely want to seed the database with the canonical Wordle word list. This list is contained in `data/words.txt`. Run:

```bash
bun run src/seed.ts
```

This does two things:

1. Deletes any existing data in the `candidate_words` and `best_guesses` tables.
2. Inserts each 5-letter word from `words.txt` into the `candidate_words` table.
3. Inserts a number of round=1 rows into `best_guesses` based on known optimal starting words.

If you would like to compute your own starting words, you can edit the relevant lines in `seed.ts`.

### Running the Solver

The main entry point is `index.ts`, which calls the precomputation routine from `precompute.ts`. To execute:

```bash
bun run src/index.ts
```

By default, this will:

1. Look up your round=1 guesses (e.g. “TRACE”) and retrieve the candidate word list from the database.
2. Build a feedback matrix for all pairs of candidate words.
3. Partition those words by the feedback they would give to the first guess.
4. Recursively compute the best guess for round=2 for each feedback partition.
5. Store all results back into the best_guesses table for quick lookups later.

The console output will show, for each feedback partition, which guess is the best next guess and the expected average number of remaining guesses if you use it.

**Note:** This will take a while to run, especially for feedback rounds with large numbers of possible next guesses. The full database size once completed is ~50 MB.

## Project Structure

```
wordle-solver
├── bun.lock
├── README.md
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── data
│   ├── migrations
│   └── words.txt
└── src
    ├── schema.ts       # Drizzle schema definitions for candidate_words and best_guesses
    ├── migrate.ts      # Runs database migrations
    ├── seed.ts         # Seeds database with words.txt and an initial best guess
    ├── precompute.ts   # Core logic for building feedback matrix and computing best guesses
    ├── index.ts        # Entry point; runs precomputation
    └── db.ts           # Database connection (Bun + Drizzle)

	•	bun.lock: Lockfile for Bun dependencies.
	•	package.json: Project’s scripts and dependency definitions.
	•	tsconfig.json: TypeScript configuration (using bundler resolution).
	•	drizzle.config.ts: Drizzle config for SQLite, including migration folder, DB path, etc.
	•	data/migrations: SQL migrations automatically generated or manually edited.
	•	data/words.txt: A curated list of 5-letter words used as the solver’s candidate set.
```

## How It Works

### Database Schema

Defined in `schema.ts`:

**candidate_words**

Stores valid candidate words, each row is one 5-letter word.

**best_guesses**

Caches computed guesses for:

1. A given round (1–6).
2. The previous guess and its feedback (for round=2).
3. A unique hash of the current candidate subset.

- We store `bestGuess`, `expectedMoves`, and the entire set of candidate words for that scenario.

### Feedback Calculation

A feedback code is computed for each (guess, solution) pair.

Each of the 5 letters is assigned a digit in base‑3:

- 2 = Green (correct letter in correct place)
- 1 = Yellow (correct letter in wrong place)
- 0 = Gray (letter not in solution or already accounted for)

These codes are stored in a feedback matrix (Uint8Array) for fast lookups:

- `feedbackMatrix[i \* N + j]` is the feedback code when word `i` is guessed against word `j`.

### Recursive Computation & Caching

We define a recursive function computeOptimalGuessRecursive() that:

1. If there is only one candidate left, return that candidate immediately (expectedMoves = 0).
2. Otherwise, for each potential guess in the candidate set, partition the candidates by feedback outcome.
3. Recursively compute the expected moves for each partition.
4. Use Shannon entropy as a heuristic (high-entropy guesses first) and alpha–beta pruning to skip suboptimal paths.
5. Store the best guess in both an in-memory map and the SQLite cache (best_guesses table).

### Round 2 Precomputation

- The solver uses a number of known “best” first guesses (round=1).
- We retrieve those guesses from the DB, build the feedback matrix, then for each possible feedback pattern (e.g. `00220`), we compute the best next guess.
- The results are stored in best_guesses, so if you actually want to play Wordle with this solver, you can query this table for instant lookups (or continue the recursion further as needed).

## License

This project is open-source; feel free to adapt it for your own Wordle-solving experiments, local puzzle assistants, or educational projects.

If you have suggestions or issues, please open an Issue or contribute a pull request.
