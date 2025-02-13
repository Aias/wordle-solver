import { db } from "./db";
import { candidateWords, round1, round2 } from "./schema";

(async () => {
  await db.delete(candidateWords);
  await db.delete(round1);
  await db.delete(round2);

  const words = await Bun.file("./data/words.txt").text();
  const wordArray = words
    .split("\n")
    .flatMap((word) => word.trim().split(" "))
    .filter((word) => word.length === 5);

  wordArray.forEach(async (word) => {
    await db.insert(candidateWords).values({ word: word.toUpperCase() });
    console.log(`Inserted ${word}`);
  });

  await db.insert(round1).values({
    bestGuess: "TRACE",
  });
})();
