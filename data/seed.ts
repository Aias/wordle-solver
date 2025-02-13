import { db } from "./db";
import { candidateWords, round1, conditionalGuesses } from "./schema";

(async () => {
  await db.delete(candidateWords);
  await db.delete(round1);
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

  await db.insert(round1).values({
    bestGuess: "TRACE",
  });
})();
