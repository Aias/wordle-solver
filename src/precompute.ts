import { db, candidateWords, conditionalGuesses } from "../data";
import { asc } from "drizzle-orm";

const MAX_ROUNDS = 6;

/**
 * Represents the result of a recursive expected-moves computation:
 *  - guess: the chosen word that minimizes the expected number of moves
 *  - moves: the expected (average) number of moves if that guess is chosen
 */
interface GuessResult {
  guess: string;
  moves: number;
}

/**
 * Tracks progress of the recursion to provide logging and pruning:
 *  - expansions: number of subsets we've expanded in recursion
 *  - expansionsLogInterval: how often to log expansions
 *  - bestSoFar: the best (lowest) expected moves found so far (used for pruning)
 */
interface ProgressTracker {
  expansions: number;
  expansionsLogInterval: number;
  bestSoFar: number;
}

/* --------------------------------------
   1. Feedback + Candidate Filtering
-------------------------------------- */

/**
 * Compute Wordle-style feedback for guess vs solution.
 * Returns a 5-character string of digits:
 *   '2' = green, '1' = yellow, '0' = gray
 */
function getFeedback(guess: string, solution: string): string {
  const feedback = Array(5).fill("");
  const solutionChars = solution.split("");

  // Mark greens (2)
  for (let i = 0; i < 5; i++) {
    if (guess[i] === solution[i]) {
      feedback[i] = "2";
      solutionChars[i] = "";
    }
  }

  // Mark yellows (1) or grays (0)
  for (let i = 0; i < 5; i++) {
    if (feedback[i] === "") {
      const idx = solutionChars.indexOf(guess[i]);
      if (idx !== -1) {
        feedback[i] = "1";
        solutionChars[idx] = "";
      } else {
        feedback[i] = "0";
      }
    }
  }
  return feedback.join("");
}

/**
 * Filters the given candidate list down to only those words that would produce
 * exactly the specified feedback if 'guess' was used against them.
 */
function filterCandidatesByFeedback(
  candidates: string[],
  guess: string,
  feedback: string,
  feedbackCache: Record<string, Record<string, string>>
): string[] {
  return candidates.filter((word) => {
    return feedbackCache[guess][word] === feedback;
  });
}

/**
 * Builds a 2D feedback cache for all (guess, answer) pairs in the corpus.
 * feedbackCache[guess][answer] = feedback string
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

/* --------------------------------------
   2. One-Step Entropy
-------------------------------------- */

/**
 * Computes a quick, one-step entropy measure for 'guess' given a candidate list.
 * This is used to sort guesses so that we explore high-entropy (likely better) guesses first.
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

/* --------------------------------------
   3. Recursive Expected-Moves Search
-------------------------------------- */

/**
 * Recursively compute the guess that yields minimal expected moves among 'candidates',
 * with 'depthLeft' guesses remaining. We reorder guesses by a quick one-step entropy
 * to find a good guess early (and prune subsequent guesses).
 *
 * If 'depthLeft' == 0, we fallback to a single-step entropy approach rather than a deeper search.
 */
function computeOptimalGuessRecursive(
  candidates: string[],
  depthLeft: number,
  feedbackCache: Record<string, Record<string, string>>,
  memo: Map<string, GuessResult>,
  progress: ProgressTracker,
  logCandidates: boolean = true
): GuessResult {
  // Base cases:
  if (candidates.length <= 1) {
    return { guess: candidates[0] || "", moves: 0 };
  }
  if (depthLeft === 0) {
    // Fallback: pick the guess with the highest single-step entropy
    let bestGuess = "";
    let bestFallback = Infinity;
    const maxEnt = Math.log2(candidates.length);

    for (const guess of candidates) {
      const ent = oneStepEntropy(guess, candidates, feedbackCache);
      // We'll define fallback cost as 1 + (maxEnt - ent), so lower is better
      const cost = 1 + (maxEnt - ent);
      if (cost < bestFallback) {
        bestFallback = cost;
        bestGuess = guess;
      }
    }
    return { guess: bestGuess, moves: bestFallback };
  }

  // Check memo
  const memoKey = `${depthLeft}:${candidates.join(",")}`;
  if (memo.has(memoKey)) {
    return memo.get(memoKey)!;
  }

  // Logging expansions
  progress.expansions += 1;
  if (progress.expansions % progress.expansionsLogInterval === 0) {
    console.log(
      `[INFO] expansions=${progress.expansions}, depthLeft=${depthLeft}, size=${candidates.length}`
    );
  }

  // Sort guesses by one-step entropy (descending), so best guesses are tried first
  const guessOrder = candidates.slice();
  guessOrder.sort(
    (a, b) =>
      oneStepEntropy(b, candidates, feedbackCache) -
      oneStepEntropy(a, candidates, feedbackCache)
  );

  if (logCandidates) {
    console.log(`[INFO] Candidates: ${guessOrder.join(", ")}`);
  }

  let localBestGuess = "";
  let localBestMoves = Infinity;

  // Explore guesses in order of descending one-step entropy
  for (const guess of guessOrder) {
    // Partition the candidate set by feedback
    const feedbackCounts: Record<string, number> = {};
    const feedbackGroups: Record<string, string[]> = {};

    for (const answer of candidates) {
      const fb = feedbackCache[guess][answer];
      feedbackCounts[fb] = (feedbackCounts[fb] || 0) + 1;
      if (!feedbackGroups[fb]) feedbackGroups[fb] = [];
      feedbackGroups[fb].push(answer);
    }

    // Accumulate expected moves
    let expectedMoves = 1; // +1 for the current guess
    for (const [fb, group] of Object.entries(feedbackGroups)) {
      const prob = group.length / candidates.length;
      if (group.length > 1) {
        const subResult = computeOptimalGuessRecursive(
          group,
          depthLeft - 1,
          feedbackCache,
          memo,
          progress,
          false
        );
        expectedMoves += prob * subResult.moves;
      }
      // Early partial sum check
      if (expectedMoves >= localBestMoves) {
        expectedMoves = Infinity;
        break;
      }
    }

    // Prune if we can't beat the global bestSoFar
    if (expectedMoves >= progress.bestSoFar) {
      continue;
    }

    if (expectedMoves < localBestMoves) {
      localBestMoves = expectedMoves;
      localBestGuess = guess;
      // If we find a guess near 1.0, no need to continue
      if (localBestMoves <= 1.00001) {
        break;
      }
    }
  }

  const result = { guess: localBestGuess, moves: localBestMoves };
  memo.set(memoKey, result);

  // If we're at the top-level, update progress.bestSoFar
  if (depthLeft === MAX_ROUNDS && localBestMoves < progress.bestSoFar) {
    progress.bestSoFar = localBestMoves;
  }

  return result;
}

/**
 * Given a 'previousGuess' and a list of valid 'remainingCandidates', we partition the candidates
 * by their feedback relative to 'previousGuess', then recursively compute the best guess for each partition.
 *
 * The results are stored in 'conditionalGuesses' so we can recall them later.
 */
export async function computeConditionalGuesses(
  previousGuess: string,
  round: number,
  remainingCandidates: string[]
) {
  // Sort the list to have a consistent ordering
  const candidates = remainingCandidates.slice().sort();
  console.log(
    `[INFO] Round ${round}: building feedback cache for ${candidates.length} candidates.`
  );

  const feedbackCache = await buildFeedbackCache();

  // Partition candidates by feedback from 'previousGuess'
  // so we only consider consistent words in each group
  const feedbackGroups: Record<string, string[]> = {};
  for (const candidate of candidates) {
    const fb = feedbackCache[previousGuess][candidate];
    if (!feedbackGroups[fb]) {
      feedbackGroups[fb] = [];
    }
    feedbackGroups[fb].push(candidate);
  }

  const memo = new Map<string, GuessResult>();
  const progress: ProgressTracker = {
    expansions: 0,
    expansionsLogInterval: 5000,
    bestSoFar: Infinity,
  };

  // For each unique feedback pattern, compute best next guess with depth=MAX_ROUNDS - (round-1).
  // E.g., if round=2, we have 5 guesses left.
  const depthLeft = MAX_ROUNDS - (round - 1);

  for (const [fb, group] of Object.entries(feedbackGroups)) {
    if (group.length <= 1) {
      // If there's only 0 or 1 candidate, the best guess is trivially known
      const bestSecond = group[0] || previousGuess;
      console.log(
        `[INFO] Feedback ${fb}: only one candidate => best guess=${bestSecond}`
      );
      await db.insert(conditionalGuesses).values({
        currentRound: round,
        previousGuess,
        feedback: fb,
        bestGuess: bestSecond,
        expectedMoves: 0,
        candidateWords: group.join(","),
      });
      continue;
    }
    console.log(
      `[INFO] Round ${round}, feedback=${fb}, group size=${group.length}`
    );

    // Recurse
    const result = computeOptimalGuessRecursive(
      group,
      depthLeft,
      feedbackCache,
      memo,
      progress
    );
    console.log(
      `[INFO] => best guess=${
        result.guess
      } (expected moves=${result.moves.toFixed(3)}), expansions so far=${
        progress.expansions
      }`
    );

    await db.insert(conditionalGuesses).values({
      currentRound: round,
      previousGuess,
      feedback: fb,
      bestGuess: result.guess,
      expectedMoves: result.moves,
      candidateWords: group.join(","),
    });
  }
}

/* --------------------------------------
   6. Runner
-------------------------------------- */

/**
 * Runs precomputation for every candidate as if it were the "previous guess".
 * This will populate 'conditionalGuesses' for round=2.
 * You could adapt this to handle deeper rounds if needed.
 */
export async function runPrecomputation() {
  const allCandidates = await db.query.candidateWords.findMany({
    orderBy: [asc(candidateWords.word)],
  });
  const allWords = allCandidates.map((row) => row.word);

  console.log(`[INFO] Starting runPrecomputation on ${allWords.length} words.`);

  // For each word in the corpus, treat it as if it were the previous guess
  // and compute the best next guess for the next round
  for (const word of allWords) {
    console.log(
      `[INFO] Computing conditional guesses for previous guess='${word}'...`
    );
    const remaining = allWords.filter((w) => w !== word);
    await computeConditionalGuesses(word, 2, remaining);
  }

  console.log("[INFO] runPrecomputation complete!");
}
