// src/errors.ts

import type { NextFunction, Request, Response } from "express";

/** An error that is safe to show to the client, with its HTTP status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type PgLikeError = Error & { code?: string };

/** Turns any error into a status and a message that is safe to send. */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;

  const e = err as PgLikeError;
  switch (e?.code) {
    case "22P02": // invalid_text_representation, e.g. a malformed UUID
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
      return new HttpError(400, "Invalid input");
    case "22003": // numeric_value_out_of_range
      return new HttpError(400, "Number out of range");
    case "23503": // foreign_key_violation
      return new HttpError(400, "A referenced record does not exist");
    case "23514": // check_violation
      return new HttpError(400, "Value not allowed");
    case "57014": // query_canceled (statement_timeout)
      return new HttpError(503, "Server is busy, please try again");
  }

  // pg-pool gave up waiting for a free connection (connectionTimeoutMillis)
  if (e?.message?.includes("timeout exceeded when trying to connect")) {
    return new HttpError(503, "Server is busy, please try again");
  }

  return new HttpError(500, "Something went wrong");
}

/** Express error handler: logs the real error, sends only a safe message. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const type = (err as { type?: string })?.type;
  if (type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  const httpErr = toHttpError(err);
  if (httpErr.status >= 500) {
    console.error(`${req.method} ${req.originalUrl} failed:`, err);
  }
  res.status(httpErr.status).json({ error: httpErr.message });
}
