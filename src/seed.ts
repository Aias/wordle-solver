import { db } from "./db";
import { candidateWords, bestGuesses } from "./schema";

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

  await db.insert(bestGuesses).values({
    round: 1,
    previousGuess: null,
    feedback: null,
    bestGuess: "TRACE",
    expectedMoves: 6,
    candidateWords: wordArray.join(","),
  });
})();
