// src/db.ts

import { Pool, types } from "pg";
import dotenv from "dotenv";
import { poolConfigFromEnv } from "./config";

dotenv.config();
types.setTypeParser(1082, (val) => val);

/** Anything a query can run on: the pool or a checked-out client. */
export type Queryable = Pick<Pool, "query">;

export const pool = new Pool(poolConfigFromEnv());

pool.on("error", (err) => {
  console.error("Unexpected PG pool error", err);
});
