import { db } from "./db";
import { candidateWords, conditionalGuesses } from "./schema";

(async () => {
  await db.delete(candidateWords);
  await db.delete(conditionalGuesses);

  const words = await Bun.file("./data/words.txt").text();
  const wordArray = words
    .split("\n")
    .flatMap((word) => word.trim().split(" "))
    .filter((word) => word.length === 5);

  for (const word of wordArray) {
    await db.insert(candidateWords).values({ word: word.toUpperCase() });
    console.log(`Inserted ${word}`);
  }

  await db.insert(conditionalGuesses).values({
    currentRound: 1,
    previousGuess: "TRACE",
    feedback: "00000",
    bestGuess: "TRACE",
    expectedMoves: 0,
    candidateWords: "TRACE",
    candidateHash: "TRACE",
  });
})();
