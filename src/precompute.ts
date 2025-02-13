import { db, candidateWords, bestGuesses } from "../data";
import { asc } from "drizzle-orm";
import { createHash } from "crypto";

const MAX_ROUNDS = 6;

/**
 * Represents the result of a recursive expected-moves computation:
 *  - bestGuess: chosen word that minimizes expected moves
 *  - expectedMoves: the computed expected (average) number of moves for that guess
 */
interface GuessResult {
  bestGuess: string;
  expectedMoves: number;
}

/**
 * Progress tracker for logging and pruning
 */
interface ProgressTracker {
  expansions: number;
  expansionsLogInterval: number;
  bestSoFar: number; // best (lowest) expected moves found so far
}

/* ======================================================================
   1. Feedback & Candidate Filtering
   ====================================================================== */

/**
 * Compute Wordle-style feedback for (guess, solution).
 * Returns a 5-char string with '2'=green, '1'=yellow, '0'=gray.
 */
function getFeedback(guess: string, solution: string): string {
  const feedback = Array(5).fill("");
  const chars = solution.split("");

  // Mark greens
  for (let i = 0; i < 5; i++) {
    if (guess[i] === solution[i]) {
      feedback[i] = "2";
      chars[i] = ""; // used
    }
  }
  // Mark yellows or grays
  for (let i = 0; i < 5; i++) {
    if (feedback[i] === "") {
      const idx = chars.indexOf(guess[i]);
      if (idx !== -1) {
        feedback[i] = "1";
        chars[idx] = "";
      } else {
        feedback[i] = "0";
      }
    }
  }
  return feedback.join("");
}

/**
 * Build a full feedback cache [guess][answer] -> feedback,
 * so we don't recalc getFeedback repeatedly.
 */
async function buildFeedbackCache(): Promise<
  Record<string, Record<string, string>>
> {
  const cache: Record<string, Record<string, string>> = {};
  const allRows = await db.query.candidateWords.findMany({
    orderBy: [asc(candidateWords.word)],
  });

  // Build row of guess => row of answer => feedback
  for (const { word: g } of allRows) {
    cache[g] = {};
  }
  for (const { word: guess } of allRows) {
    for (const { word: answer } of allRows) {
      cache[guess][answer] = getFeedback(guess, answer);
    }
  }
  return cache;
}

/**
 * Filter a candidate list by a particular feedback pattern.
 */
function filterCandidatesByFeedback(
  candidates: string[],
  guess: string,
  fb: string,
  feedbackCache: Record<string, Record<string, string>>
): string[] {
  return candidates.filter((c) => feedbackCache[guess][c] === fb);
}

/* ======================================================================
   2. One-Step Entropy
   ====================================================================== */

/**
 * Computes one-step Shannon entropy for 'guess' vs. the 'candidates' subset.
 */
function oneStepEntropy(
  guess: string,
  candidates: string[],
  feedbackCache: Record<string, Record<string, string>>
): number {
  const freq: Record<string, number> = {};
  for (const ans of candidates) {
    const fb = feedbackCache[guess][ans];
    freq[fb] = (freq[fb] || 0) + 1;
  }
  let entropy = 0;
  const total = candidates.length;
  for (const count of Object.values(freq)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/* ======================================================================
   3. Hashing for Candidate Set
   ====================================================================== */

/**
 * Creates an MD5 hash of the sorted candidate set to use as a key
 * in memoization or DB caching.
 */
function hashCandidateSet(candidates: string[]): string {
  // Already sorted outside, but just to be sure:
  const joined = candidates.join(",");
  return createHash("md5").update(joined).digest("hex");
}

/* ======================================================================
   4. Recursive Expected-Moves Computation
   ====================================================================== */

function computeOptimalGuessRecursive(
  candidates: string[],
  depthLeft: number,
  feedbackCache: Record<string, Record<string, string>>,
  memo: Map<string, GuessResult>,
  progress: ProgressTracker,
  logCandidates: boolean = false
): GuessResult {
  // Base cases
  if (candidates.length <= 1) {
    return { bestGuess: candidates[0] || "", expectedMoves: 0 };
  }
  if (depthLeft === 0) {
    // Fallback: best one-step entropy
    let fallbackBest = "";
    let fallbackCost = Infinity;
    const maxEnt = Math.log2(candidates.length);
    for (const guess of candidates) {
      const ent = oneStepEntropy(guess, candidates, feedbackCache);
      const cost = 1 + (maxEnt - ent);
      if (cost < fallbackCost) {
        fallbackCost = cost;
        fallbackBest = guess;
      }
    }
    return { bestGuess: fallbackBest, expectedMoves: fallbackCost };
  }

  // Check memo
  const hash = hashCandidateSet(candidates);
  const memoKey = `${depthLeft}:${hash}`;
  if (memo.has(memoKey)) {
    return memo.get(memoKey)!;
  }

  // Log expansions
  progress.expansions++;
  if (progress.expansions % progress.expansionsLogInterval === 0) {
    console.log(
      `[INFO] expansions=${progress.expansions}, depthLeft=${depthLeft}, setSize=${candidates.length}`
    );
  }

  // Sort guesses by descending one-step entropy
  const guessOrder = candidates.slice();
  guessOrder.sort(
    (a, b) =>
      oneStepEntropy(b, candidates, feedbackCache) -
      oneStepEntropy(a, candidates, feedbackCache)
  );
  if (logCandidates) {
    console.log(`[INFO] Candidates: ${guessOrder.join(",")}`);
  }

  let localBest: GuessResult = { bestGuess: "", expectedMoves: Infinity };

  for (const guess of guessOrder) {
    // Partition into feedback groups
    const partitions: Record<string, string[]> = {};
    for (const ans of candidates) {
      const fb = feedbackCache[guess][ans];
      if (!partitions[fb]) partitions[fb] = [];
      partitions[fb].push(ans);
    }

    let expMoves = 1; // current guess
    for (const group of Object.values(partitions)) {
      const prob = group.length / candidates.length;
      if (group.length > 1) {
        const subRes = computeOptimalGuessRecursive(
          group,
          depthLeft - 1,
          feedbackCache,
          memo,
          progress
        );
        expMoves += prob * subRes.expectedMoves;
      }
      // Early partial sum check
      if (expMoves >= localBest.expectedMoves) {
        expMoves = Infinity;
        break;
      }
    }

    // Prune if we can't improve the top-level bestSoFar
    if (expMoves >= progress.bestSoFar) {
      continue;
    }

    if (expMoves < localBest.expectedMoves) {
      localBest = { bestGuess: guess, expectedMoves: expMoves };
      // If near 1.0, bail out
      if (localBest.expectedMoves <= 1.00001) {
        break;
      }
    }
  }

  memo.set(memoKey, localBest);

  // Update global bestSoFar if this is top-level
  if (
    depthLeft === MAX_ROUNDS &&
    localBest.expectedMoves < progress.bestSoFar
  ) {
    progress.bestSoFar = localBest.expectedMoves;
  }

  return localBest;
}

/* ======================================================================
   5. Round 2 Precomputation:
      - We assume we have a row in bestGuesses for round=1 with bestGuess="TRACE"
      - That row has candidateWords = the entire corpus
      - We'll partition that set by possible feedback strings for "TRACE",
        then compute the best guess among each partition, storing round=2 results
   ====================================================================== */

export async function runPrecomputation() {
  // 1) Look up the row for round=1. We expect bestGuess="TRACE" and a full candidate list.
  const round1Row = await db.query.bestGuesses.findFirst({
    where: (table, { eq }) => eq(table.round, 1),
  });
  if (!round1Row) {
    console.error(
      "[ERROR] No round=1 row found in best_guesses. Please insert one first."
    );
    return;
  }

  const { bestGuess: firstGuess, candidateWords: allCandidatesStr } = round1Row;
  if (!firstGuess) {
    console.error("[ERROR] Round=1 row is missing bestGuess. Aborting.");
    return;
  }

  console.log(`[INFO] Found round=1 row. bestGuess=${firstGuess}`);
  const allCandidates = allCandidatesStr.split(",").sort();
  console.log(`[INFO] Full candidate set size=${allCandidates.length}.`);

  // 2) Build the feedback cache (once)
  console.log("[INFO] Building feedback cache...");
  const feedbackCache = await buildFeedbackCache();
  console.log("[INFO] Feedback cache built.");

  // 3) Partition the entire set by the feedback they'd produce for firstGuess.
  const feedbackGroups: Record<string, string[]> = {};
  for (const candidate of allCandidates) {
    const fb = feedbackCache[firstGuess][candidate];
    if (!feedbackGroups[fb]) feedbackGroups[fb] = [];
    feedbackGroups[fb].push(candidate);
  }

  // 4) For each feedback pattern, run a recursive search on that subset and store round=2 in DB
  const memo = new Map<string, GuessResult>();
  const progress: ProgressTracker = {
    expansions: 0,
    expansionsLogInterval: 1000,
    bestSoFar: Infinity,
  };
  const depthLeft = MAX_ROUNDS - 1; // we've used 1 guess, so 5 remain

  for (const [fb, group] of Object.entries(feedbackGroups)) {
    // If group.length <= 1, trivial
    if (group.length <= 1) {
      const best = group[0] || firstGuess;
      console.log(
        `[INFO] Feedback=${fb} => only ${group.length} candidate => best guess=${best}`
      );
      await db.insert(bestGuesses).values({
        round: 2,
        previousGuess: firstGuess,
        feedback: fb,
        bestGuess: best,
        expectedMoves: 0,
        candidateWords: group.join(","),
      });
      continue;
    }
    console.log(
      `[INFO] Feedback=${fb}, group size=${group.length}. Computing optimal guess...`
    );
    const result = computeOptimalGuessRecursive(
      group,
      depthLeft,
      feedbackCache,
      memo,
      progress
    );
    console.log(
      `[INFO] => best guess=${
        result.bestGuess
      }, expected moves=${result.expectedMoves.toFixed(3)}, expansions so far=${
        progress.expansions
      }`
    );

    // Store in DB
    await db.insert(bestGuesses).values({
      round: 2,
      previousGuess: firstGuess,
      feedback: fb,
      bestGuess: result.bestGuess,
      expectedMoves: result.expectedMoves,
      candidateWords: group.join(","),
    });
  }

  console.log("[INFO] Precomputation for round=2 complete!");
}
