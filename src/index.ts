import { db, round2 } from "../data";
import { runPrecomputation } from "./precompute";

await db.delete(round2);

runPrecomputation();
