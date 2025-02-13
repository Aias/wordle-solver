import { db, candidateWords, round1, conditionalGuesses } from "../data";
import { asc } from "drizzle-orm";

const MAX_ROUNDS = 6;

/**
 * A simple interface to store the result of a recursive computation:
 * - guess: the word that yields the minimal expected moves
 * - moves: the expected moves value for that guess
 */
interface GuessResult {
  guess: string;
  moves: number;
}

/**
 * A structure to track our global progress and log it periodically.
 */
interface ProgressTracker {
  expansions: number; // how many subsets we have expanded
  expansionsLogInterval: number; // how often to log expansions
  bestSoFar: number; // the best (lowest) expected moves found so far at the top level
}

//
// =========================================
// 1. Feedback Calculation + Caching
// =========================================
//

/**
 * Computes the Wordle feedback for a given guess vs a solution.
 * Returns a 5-char string of digits (0=gray, 1=yellow, 2=green).
 */
function getFeedback(guess: string, solution: string): string {
  const feedback = Array(5).fill("");
  const solutionChars = solution.split("");

  // Mark greens (2)
  for (let i = 0; i < 5; i++) {
    if (guess[i] === solution[i]) {
      feedback[i] = "2";
      solutionChars[i] = ""; // used up
    }
  }

  // Mark yellows (1) and grays (0)
  for (let i = 0; i < 5; i++) {
    if (feedback[i] === "") {
      const idx = solutionChars.indexOf(guess[i]);
      if (idx !== -1) {
        feedback[i] = "1";
        solutionChars[idx] = ""; // used up
      } else {
        feedback[i] = "0";
      }
    }
  }

  return feedback.join("");
}

/**
 * Build a 2D feedback cache to avoid recomputing getFeedback many times.
 * feedbackCache[guess][answer] = feedbackString
 */
async function buildFeedbackCache(): Promise<
  Record<string, Record<string, string>>
> {
  const cache: Record<string, Record<string, string>> = {};
  const fullCandidates = await db.query.candidateWords.findMany({
    orderBy: [asc(candidateWords.word)],
  });
  for (const { word: guess } of fullCandidates) {
    cache[guess] = {};
    for (const { word: answer } of fullCandidates) {
      cache[guess][answer] = getFeedback(guess, answer);
    }
  }
  return cache;
}

//
// =========================================
// 2. Recursive Function with Pruning
// =========================================
//

/**
 * Recursively compute the guess that minimizes the expected moves to solve Wordle.
 * We keep track of expansions in a "progress" object and log periodically.
 *
 * If partial computations exceed `progress.bestSoFar`, we prune (i.e., abort exploring
 * that guess), as we won't do better than the best known top-level guess.
 *
 * @param candidates - sorted array of candidate words
 * @param depthLeft - how many guesses remain (including this one)
 * @param feedbackCache - precomputed feedback
 * @param memo - memo table keyed by "depth:candidates.join(',')"
 * @param progress - tracks expansions and bestSoFar for pruning
 * @returns { guess, moves }
 */
function computeOptimalGuessRecursive(
  candidates: string[],
  depthLeft: number,
  feedbackCache: Record<string, Record<string, string>>,
  memo: Map<string, GuessResult>,
  progress: ProgressTracker
): GuessResult {
  // Base / edge cases
  if (candidates.length <= 1) {
    return { guess: candidates[0] || "", moves: 0 };
  }
  if (depthLeft === 0) {
    // Fallback using one-step entropy as a heuristic
    let bestGuess = "";
    let bestFallbackCost = Infinity;
    const maxEntropy = Math.log2(candidates.length); // maximum possible entropy for the candidate set

    for (const guess of candidates) {
      let entropy = 0;
      const freq: Record<string, number> = {};
      for (const answer of candidates) {
        const fb = feedbackCache[guess][answer];
        freq[fb] = (freq[fb] || 0) + 1;
      }
      for (const count of Object.values(freq)) {
        const p = count / candidates.length;
        entropy -= p * Math.log2(p);
      }
      // Define the fallback cost such that a lower cost is better.
      // Adding 1 ensures that an ideal move (instant win) would have cost 1.
      // The penalty is proportional to the "missing" entropy compared to the maximum.
      const fallbackCost = 1 + (maxEntropy - entropy);
      if (fallbackCost < bestFallbackCost) {
        bestFallbackCost = fallbackCost;
        bestGuess = guess;
      }
    }
    return { guess: bestGuess, moves: bestFallbackCost };
  }

  // Generate memo key
  const key = `${depthLeft}:${candidates.join(",")}`;
  if (memo.has(key)) {
    return memo.get(key)!;
  }

  // Count expansions
  progress.expansions += 1;
  if (progress.expansions % progress.expansionsLogInterval === 0) {
    console.log(
      `[INFO] expansions: ${progress.expansions}, depthLeft=${depthLeft}, setSize=${candidates.length}`
    );
  }

  let bestGuess = "";
  let bestExpected = Infinity;

  // Try each candidate as guess
  for (let i = 0; i < candidates.length; i++) {
    const guess = candidates[i];

    // Partition by feedback
    const feedbackGroups: Record<string, string[]> = {};
    for (const answer of candidates) {
      const fb = feedbackCache[guess][answer];
      if (!feedbackGroups[fb]) feedbackGroups[fb] = [];
      feedbackGroups[fb].push(answer);
    }

    // Accumulate expected moves for this guess
    let expectedMoves = 0;
    for (const group of Object.values(feedbackGroups)) {
      const prob = group.length / candidates.length;
      if (group.length > 1) {
        const sub = computeOptimalGuessRecursive(
          group,
          depthLeft - 1,
          feedbackCache,
          memo,
          progress
        ).moves;
        // For expected value, we always multiply by prob
        if (sub === Infinity) {
          expectedMoves += prob * Infinity; // => Infinity if prob>0
        } else {
          expectedMoves += prob * sub;
        }
      }
    }
    // +1 for the current guess
    expectedMoves += 1;

    // If partial result is already worse than our known best, prune
    if (expectedMoves >= progress.bestSoFar) {
      // This guess can't beat the best top-level guess we have so far, skip it
      continue;
    }

    // Keep track of the best among these local candidates
    if (expectedMoves < bestExpected) {
      bestExpected = expectedMoves;
      bestGuess = guess;
      // Additional pruning:
      // If we find something extremely close to 1.0, we can break early:
      if (bestExpected <= 1.00001) {
        break;
      }
    }
  }

  const result: GuessResult = { guess: bestGuess, moves: bestExpected };
  memo.set(key, result);

  // If we're at the top-level call (depthLeft == MAX_ROUNDS) and this guess is better than
  // the global bestSoFar, we update the global bestSoFar for subsequent pruning
  // (Or you can do this conditionally if you only want to track top-level calls.)
  if (depthLeft === MAX_ROUNDS && bestExpected < progress.bestSoFar) {
    progress.bestSoFar = bestExpected;
  }

  return result;
}

//
// =========================================
// 4. Precomputation
// =========================================
//

/**
 * Computes the best first guess from the entire candidate corpus.
 * If `useRecursive` is true, we do a full 6-depth search. Otherwise, we pick
 * the word with highest one-step Shannon entropy.
 */
export async function precomputeBestFirstGuess(useRecursive = false) {
  const candidateRows = await db.select().from(candidateWords);

  // Single sort of candidate set
  const candidates = candidateRows.map((row) => row.word).sort();

  const feedbackCache = await buildFeedbackCache();

  let bestFirstGuess = "";
  if (!useRecursive) {
    // Use simple one-step entropy
    console.log("[INFO] Building feedback cache for one-step entropy...");

    let bestEntropy = -Infinity;
    for (const g of candidates) {
      let entropy = 0;
      // Compute entropy
      const freq: Record<string, number> = {};
      for (const ans of candidates) {
        const fb = feedbackCache[g][ans];
        freq[fb] = (freq[fb] || 0) + 1;
      }
      const total = candidates.length;
      for (const count of Object.values(freq)) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
      if (entropy > bestEntropy) {
        bestEntropy = entropy;
        bestFirstGuess = g;
      }
    }
    console.log(
      `[INFO] Best first guess by entropy: ${bestFirstGuess} (entropy=${bestEntropy.toFixed(
        3
      )})`
    );
  } else {
    // Use full recursion with depth=6
    console.log(
      `[INFO] Full recursion with depth=6 on ${candidates.length} candidates.`
    );
    console.log("[INFO] Building complete feedback cache...");

    const memo = new Map<string, GuessResult>();
    const progress: ProgressTracker = {
      expansions: 0,
      expansionsLogInterval: 1000,
      bestSoFar: Infinity,
    };
    const result = computeOptimalGuessRecursive(
      candidates,
      MAX_ROUNDS,
      feedbackCache,
      memo,
      progress
    );
    bestFirstGuess = result.guess;
    console.log(
      `[INFO] Recursive best first guess: ${bestFirstGuess}, expected moves ~ ${result.moves.toFixed(
        3
      )}`
    );
    console.log(`[INFO] Total expansions: ${progress.expansions}`);
  }

  const [record] = await db
    .insert(round1)
    .values({ id: 1, bestGuess: bestFirstGuess })
    .returning();
  console.log(`[INFO] Stored best first guess in DB: ${bestFirstGuess}`);
  return record;
}

/**
 * For each possible feedback pattern from the best first guess, compute the
 * optimal second guess using recursion with depth=5.
 */
export async function computeConditionalGuesses(
  previousGuess: string,
  round: number,
  remainingCandidates: string[]
) {
  const candidates = remainingCandidates.slice().sort();

  console.log(`[INFO] Building feedback cache for second-guess computation...`);
  const feedbackCache = await buildFeedbackCache();

  // Partition all candidates by the feedback they'd produce if the bestFirstGuess were used
  const feedbackGroups: Record<string, string[]> = {};
  for (const answer of candidates) {
    const fb = feedbackCache[previousGuess][answer];
    if (!feedbackGroups[fb]) feedbackGroups[fb] = [];
    feedbackGroups[fb].push(answer);
  }

  const memo = new Map<string, GuessResult>();

  // We'll track expansions as well
  const progress: ProgressTracker = {
    expansions: 0,
    expansionsLogInterval: 500,
    bestSoFar: Infinity,
  };

  // For each feedback, run recursion with depth=5
  for (const [fb, group] of Object.entries(feedbackGroups)) {
    if (group.length <= 1) {
      // If only one or zero candidates remain, that guess is trivially correct.
      const bestSecond = group[0] || previousGuess;
      console.log(
        `[INFO] Feedback ${fb}: only one candidate, so bestSecond=${bestSecond}`
      );
      await db.insert(conditionalGuesses).values({
        round,
        previousGuess,
        feedback: fb,
        bestGuess: bestSecond,
        expectedMoves: 0,
        allPossibilities: group.join(","),
      });
      continue;
    }
    console.log(
      `[INFO] Computing second guess for feedback ${fb} (group size=${group.length})...`
    );
    const result = computeOptimalGuessRecursive(
      group,
      MAX_ROUNDS - 1,
      feedbackCache,
      memo,
      progress
    );
    console.log(
      `[INFO] -> best second guess: ${
        result.guess
      }, expected moves=${result.moves.toFixed(3)} (expansions so far: ${
        progress.expansions
      })`
    );
    await db.insert(conditionalGuesses).values({
      round,
      previousGuess,
      feedback: fb,
      bestGuess: result.guess,
      expectedMoves: result.moves,
      allPossibilities: candidates.join(","),
    });
  }
}

export async function runPrecomputation() {
  const allCandidates = await db.query.candidateWords.findMany({
    orderBy: [asc(candidateWords.word)],
  });
  const allWords = allCandidates.map((row) => row.word);
  for (const word of allWords) {
    console.log(`[INFO] Computing conditional guesses for ${word}...`);
    const remainingCandidates = allWords.filter((w) => w !== word);
    await computeConditionalGuesses(word, 2, remainingCandidates);
  }
}
