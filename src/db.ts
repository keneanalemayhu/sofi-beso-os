// src/db.ts

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const useSSL = process.env.DB_SSL === "true";

export const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected PG pool error", err);
});