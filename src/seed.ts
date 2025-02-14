import { db } from "./db";
import { candidateWords, bestGuesses } from "./schema";

const STARTING_WORDS = [
  "TRACE", // https://jonathanolson.net/experiments/optimal-wordle-solutions
  "SALET",
  "ROATE", // https://medium.com/@tglaiel/the-mathematically-optimal-first-guess-in-wordle-cbcb03c19b0a
  "RAISE",
  "SOARE",
];

(async () => {
  await db.delete(candidateWords);
  await db.delete(bestGuesses);

  const words = await Bun.file("./data/words.txt").text();
  const wordArray = words
    .split("\n")
    .flatMap((word) => word.toUpperCase().trim().split(" "))
    .filter((word) => word.length === 5);

  for (const word of wordArray) {
    await db.insert(candidateWords).values({ word });
    console.log(`Inserted ${word}`);
  }

  await db.insert(bestGuesses).values(
    STARTING_WORDS.map((word) => ({
      round: 1,
      previousGuess: null,
      feedback: null,
      bestGuess: word,
      expectedMoves: 3.5, // All of these are somewhere between 3 and 4, see links above.
      candidateWords: wordArray.join(","),
    }))
  );
})();
