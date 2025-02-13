import { db, conditionalGuesses } from "../data";
import { runPrecomputation } from "./precompute";

await db.delete(conditionalGuesses);

runPrecomputation();
