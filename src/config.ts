// src/config.ts
//
// Settings read from the environment. Nothing here opens connections, so
// it is safe to import from anywhere (including tests).

import type { PoolConfig } from "pg";

/** Time zone of the business day ("today's" orders, daily reports). */
export const BUSINESS_TZ = process.env.BUSINESS_TZ || "Africa/Addis_Ababa";

function intFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function poolConfigFromEnv(): PoolConfig {
  const useSSL = process.env.DB_SSL === "true";

  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: intFromEnv("DB_PORT", 5432),
    ssl: useSSL ? { rejectUnauthorized: false } : undefined,

    // Same size as the pg default; raise it if the database allows more.
    max: intFromEnv("DB_POOL_MAX", 10),
    // When every connection is busy, give up after 5s with "busy, retry"
    // instead of leaving the cashier's request hanging.
    connectionTimeoutMillis: intFromEnv("DB_CONNECT_TIMEOUT_MS", 5000),
    idleTimeoutMillis: 30_000,
    // No single query may hold a connection longer than this.
    statement_timeout: intFromEnv("DB_STATEMENT_TIMEOUT_MS", 15_000),
  };
}
