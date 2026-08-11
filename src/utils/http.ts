// src/utils/http.ts

/** Express 5 route params can be string | string[]; normalize to a string. */
export function param(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}