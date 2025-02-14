import { db } from "./db";
import { bestGuesses } from "./schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";

// Maximum rounds in Wordle.
const MAX_ROUNDS = 6;
// In our base‑3 encoding, "22222" equals 242.
const CORRECT_CODE = 242;

/* ========================================================
   1. Feedback Functions & Precomputed Matrix
======================================================== */

/**
 * Computes the Wordle feedback for a guess vs. solution as a base‑3 numeric code.
 * Each of the 5 positions becomes a digit:
 *  - 2 for green,
 *  - 1 for yellow,
 *  - 0 for gray.
 */
function getFeedbackCode(guess: string, solution: string): number {
  const digits = new Array(5).fill(0);
  const solArr = solution.split("");
  // First pass: mark greens.
  for (let i = 0; i < 5; i++) {
    if (guess[i] === solution[i]) {
      digits[i] = 2;
      solArr[i] = ""; // mark as used
    }
  }
  // Second pass: mark yellows.
  for (let i = 0; i < 5; i++) {
    if (digits[i] !== 2) {
      const idx = solArr.indexOf(guess[i]);
      if (idx !== -1) {
        digits[i] = 1;
        solArr[idx] = "";
      }
    }
  }
  let code = 0;
  for (let i = 0; i < 5; i++) {
    code = code * 3 + digits[i];
  }
  return code;
}

/**
 * Converts a numeric feedback code to a 5‑character string (base‑3).
 */
function feedbackToString(code: number): string {
  let s = code.toString(3);
  while (s.length < 5) {
    s = "0" + s;
  }
  return s;
}

/**
 * Builds the full feedback matrix for all candidate word pairs.
 */
function buildFeedbackMatrix(words: string[]): Uint8Array {
  const N = words.length;
  const matrix = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      matrix[i * N + j] = getFeedbackCode(words[i], words[j]);
    }
  }
  return matrix;
}

/* ========================================================
   2. In‑Memory Data Structures & Helper Functions
======================================================== */

/**
 * Computes the MD5 hash of the sorted candidate set (an array of numbers).
 */
function candidateSetHash(candidates: number[]): string {
  const sorted = candidates.slice().sort((a, b) => a - b);
  const joined = sorted.join(",");
  return createHash("md5").update(joined).digest("hex");
}

/**
 * Computes one‑step Shannon entropy for a given guess (by index) over candidateIndices.
 */
function oneStepEntropy(
  guessIdx: number,
  candidateIndices: number[],
  feedbackMatrix: Uint8Array,
  N: number
): number {
  const freq: Record<number, number> = {};
  for (const candIdx of candidateIndices) {
    const code = feedbackMatrix[guessIdx * N + candIdx];
    freq[code] = (freq[code] || 0) + 1;
  }
  let entropy = 0;
  const total = candidateIndices.length;
  for (const count of Object.values(freq)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/* ========================================================
   3. Prepared Statements for SQLite Caching
======================================================== */

// Prepared statement for checking the cache.
const selectBestGuessStmt = db
  .select({
    bestGuess: bestGuesses.bestGuess,
    expectedMoves: bestGuesses.expectedMoves,
  })
  .from(bestGuesses)
  .where(
    and(
      eq(bestGuesses.round, sql.placeholder("round")),
      eq(bestGuesses.candidateHash, sql.placeholder("hash"))
    )
  )
  .prepare();

/**
 * Checks the DB cache for a computed best guess.
 */
async function checkCachedBestGuess(
  round: number,
  candHash: string
): Promise<{ bestGuess: number; expectedMoves: number } | null> {
  const result = await selectBestGuessStmt.execute({
    round: round,
    hash: candHash,
  });
  if (result && result.length > 0) {
    const bestGuessWord = result[0].bestGuess;
    const bestGuessIdx = wordToIndex.get(bestGuessWord);
    if (bestGuessIdx === undefined) return null;
    return {
      bestGuess: bestGuessIdx,
      expectedMoves: result[0].expectedMoves,
    };
  }
  return null;
}

// Prepared statement for inserting into the cache.
const insertBestGuessStmt = db
  .insert(bestGuesses)
  .values({
    round: sql.placeholder("round"),
    previousGuess: sql.placeholder("prevGuess"),
    feedback: sql.placeholder("feedback"),
    bestGuess: sql.placeholder("bestGuess"),
    expectedMoves: sql.placeholder("expMoves"),
    candidateWords: sql.placeholder("candWords"),
    candidateHash: sql.placeholder("candHash"),
  })
  .prepare();

/**
 * Stores a computed best guess in the DB.
 * For round=2, we now pass the actual previous guess and feedback.
 * For deeper recursion, we leave them empty by design.
 */
async function storeBestGuessInDB(
  round: number,
  candHash: string,
  candidateIndices: number[],
  bestGuessIdx: number,
  expectedMoves: number,
  previousGuess: string = "",
  feedback: string = ""
): Promise<void> {
  if (bestGuessIdx < 0 || bestGuessIdx >= words.length) {
    console.error(`[ERROR] Invalid bestGuessIdx: ${bestGuessIdx}`);
    return;
  }
  const candidateWordsArr = candidateIndices
    .slice()
    .sort((a, b) => a - b)
    .map((idx) => words[idx]);
  try {
    await insertBestGuessStmt.execute({
      round: round,
      prevGuess: previousGuess,
      feedback: feedback,
      bestGuess: words[bestGuessIdx],
      expMoves: expectedMoves,
      candWords: candidateWordsArr.join(","),
      candHash: candHash,
    });
  } catch (error) {
    console.error(`[ERROR] Failed to store best guess in DB:`, {
      round,
      previousGuess,
      feedback,
      bestGuess: words[bestGuessIdx],
      expectedMoves,
      candidateCount: candidateWordsArr.length,
      error,
    });
    throw error;
  }
}

/* ========================================================
   4. Global Variables (Filled in runPrecomputation)
======================================================== */

let words: string[] = []; // Candidate words array (from round 1)
const wordToIndex = new Map<string, number>(); // word -> index mapping
let feedbackMatrix: Uint8Array; // Precomputed feedback matrix
let N = 0; // Number of candidate words

/* ========================================================
   5. Recursive Expected‑Moves Computation with Alpha–Beta Pruning
======================================================== */

/**
 * In‑memory memoization cache.
 * Key: `${depthLeft}:${candidateSetHash}`
 */
const memo = new Map<string, { bestGuess: number; expectedMoves: number }>();

/**
 * Recursively computes the best guess for the candidate set.
 *
 * @param candidateIndices Array of candidate word indices.
 * @param depthLeft Number of guesses remaining (6 is round 1, 5 is round 2, etc.).
 * @param alpha Current best (lowest) worst‑case cost for pruning.
 * @param prevGuess For round=2 calls, the prior guess (e.g. "TRACE"), else "".
 * @param feedback For round=2 calls, the feedback code from guess (e.g. "00220"), else "".
 */
async function computeOptimalGuessRecursive(
  candidateIndices: number[],
  depthLeft: number,
  alpha: number,
  prevGuess: string,
  feedback: string
): Promise<{ bestGuess: number; expectedMoves: number }> {
  // Base checks
  if (candidateIndices.length === 0) {
    throw new Error("Empty candidate set");
  }

  // Determine the "round" from depthLeft.
  // For Wordle: round = MAX_ROUNDS - depthLeft + 1
  const currentRound = MAX_ROUNDS - depthLeft + 1;
  // Create a stable key for memo + DB.
  candidateIndices.sort((a, b) => a - b);
  const candHash = candidateSetHash(candidateIndices);
  const memoKey = `${depthLeft}:${candHash}`;

  // If there's exactly one candidate, we know the best guess is that candidate, expected 0 more moves.
  // We do want to store this in the DB (if not cached) to ensure round=2 metadata is recorded properly.
  if (candidateIndices.length === 1) {
    // Check memo or DB
    if (memo.has(memoKey)) {
      return memo.get(memoKey)!;
    }
    const cached = await checkCachedBestGuess(currentRound, candHash);
    if (cached) {
      memo.set(memoKey, cached);
      return cached;
    }
    // Store for the base case
    const singleBest = {
      bestGuess: candidateIndices[0],
      expectedMoves: 0,
    };
    memo.set(memoKey, singleBest);
    // If round=2, store real previousGuess/feedback; otherwise blank
    const storePrevGuess = currentRound === 2 ? prevGuess : "";
    const storeFeedback = currentRound === 2 ? feedback : "";
    await storeBestGuessInDB(
      currentRound,
      candHash,
      candidateIndices,
      singleBest.bestGuess,
      singleBest.expectedMoves,
      storePrevGuess,
      storeFeedback
    );
    return singleBest;
  }

  // Check memo
  if (memo.has(memoKey)) {
    return memo.get(memoKey)!;
  }
  // Check DB cache
  const cached = await checkCachedBestGuess(currentRound, candHash);
  if (cached) {
    memo.set(memoKey, cached);
    return cached;
  }

  // Fallback: initialize with first candidate (just to have some valid baseline).
  let localBest = {
    bestGuess: candidateIndices[0],
    expectedMoves: Infinity,
  };

  // Sort guesses by descending one‑step entropy to prioritize high-entropy guesses first.
  const guessList = candidateIndices.slice();
  guessList.sort(
    (a, b) =>
      oneStepEntropy(b, candidateIndices, feedbackMatrix, N) -
      oneStepEntropy(a, candidateIndices, feedbackMatrix, N)
  );

  // Search all possible guesses among the candidate set
  for (const guessIdx of guessList) {
    // Partition candidate set by feedback outcome for guessIdx.
    const partitions = new Map<number, number[]>();
    for (const secretIdx of candidateIndices) {
      const fbCode = feedbackMatrix[guessIdx * N + secretIdx];
      if (!partitions.has(fbCode)) {
        partitions.set(fbCode, []);
      }
      partitions.get(fbCode)!.push(secretIdx);
    }

    let expMoves = 1; // cost for using the current guess
    for (const subset of partitions.values()) {
      const prob = subset.length / candidateIndices.length;
      if (subset.length > 1) {
        const subRes = await computeOptimalGuessRecursive(
          subset,
          depthLeft - 1,
          Math.min(alpha, localBest.expectedMoves),
          "", // deeper recursion => no "previousGuess"
          "" // deeper recursion => no "feedback"
        );
        expMoves += prob * subRes.expectedMoves;
      } else {
        // If subset.length === 1, no further moves needed for that subset
        expMoves += prob * 0;
      }
      // Alpha–beta pruning check
      if (expMoves >= localBest.expectedMoves || expMoves >= alpha) {
        expMoves = Infinity;
        break;
      }
    }

    // Update local best
    if (expMoves < localBest.expectedMoves) {
      localBest = { bestGuess: guessIdx, expectedMoves: expMoves };
      // If we've found an extremely good guess, we can short-circuit.
      if (localBest.expectedMoves <= 1.00001) break;
    }
  }

  memo.set(memoKey, localBest);

  // Store the best guess in DB.
  // For round=2, store real previousGuess/feedback; for deeper recursion, store blank.
  const storePrevGuess = currentRound === 2 ? prevGuess : "";
  const storeFeedback = currentRound === 2 ? feedback : "";
  await storeBestGuessInDB(
    currentRound,
    candHash,
    candidateIndices,
    localBest.bestGuess,
    localBest.expectedMoves,
    storePrevGuess,
    storeFeedback
  );

  return localBest;
}

/* ========================================================
   6. Round 2 Precomputation: Partitioning by First Guess Feedback
======================================================== */

/**
 * Main routine for precomputing round‑2 best guesses.
 * Now handles multiple round‑1 starting words, including non-candidate words.
 */
export async function runPrecomputation() {
  // Retrieve all round‑1 rows from the DB.
  const round1Rows = await db.query.bestGuesses.findMany({
    where: (table, { eq }) => eq(table.round, 1),
  });
  if (!round1Rows || round1Rows.length === 0) {
    console.error(
      "[ERROR] No round=1 rows found. Insert starting words first."
    );
    return;
  }
  console.log(`[INFO] Found ${round1Rows.length} round=1 starting words.`);

  // Parse full candidate set from first round‑1 row
  // (they should all have the same candidate set)
  const candidateWordsStr = round1Rows[0].candidateWords;
  const candidateWordsArr = candidateWordsStr
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  candidateWordsArr.sort();
  words = candidateWordsArr;
  N = words.length;
  words.forEach((w, i) => wordToIndex.set(w, i));
  console.log(`[INFO] Full candidate set size=${N}.`);

  // Build feedback matrix for all words.
  console.log("[INFO] Building feedback matrix...");
  feedbackMatrix = buildFeedbackMatrix(words);
  console.log("[INFO] Feedback matrix built.");

  // Process each starting word
  for (const round1Row of round1Rows) {
    const firstGuess = round1Row.bestGuess;
    if (!firstGuess) {
      console.error("[ERROR] Found round=1 row missing bestGuess, skipping.");
      continue;
    }
    console.log(`\n[INFO] Processing starting word: ${firstGuess}`);

    // For non-candidate starting words, we need to compute feedback directly
    const feedbackGroups = new Map<number, number[]>();
    for (let idx = 0; idx < N; idx++) {
      // If the first guess is in our candidate set, use the matrix
      // Otherwise, compute the feedback directly
      const fbCode = wordToIndex.has(firstGuess)
        ? feedbackMatrix[wordToIndex.get(firstGuess)! * N + idx]
        : getFeedbackCode(firstGuess, words[idx]);

      if (!feedbackGroups.has(fbCode)) {
        feedbackGroups.set(fbCode, []);
      }
      feedbackGroups.get(fbCode)!.push(idx);
    }

    // Compute best guess for round=2 in each feedback partition
    const depthLeft = MAX_ROUNDS - 1;

    for (const [fbCode, group] of feedbackGroups.entries()) {
      const groupSorted = group.slice().sort((a, b) => a - b);
      console.log(
        `[INFO] ${firstGuess}, feedback=${feedbackToString(
          fbCode
        )}, possible next guesses=${
          groupSorted.length
        }. Computing optimal guess...`
      );

      const result = await computeOptimalGuessRecursive(
        groupSorted,
        depthLeft,
        Infinity,
        firstGuess,
        feedbackToString(fbCode)
      );

      console.log(
        `[INFO] ${firstGuess}, feedback=${feedbackToString(
          fbCode
        )} => best guess=${
          words[result.bestGuess]
        } (expected guesses=${result.expectedMoves.toFixed(3)})`
      );
    }
  }

  console.log(
    "\n[INFO] Precomputation for round 2 complete for all starting words!"
  );
}
