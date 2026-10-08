// src/controllers/analytics.controller.ts

import { Request, Response } from "express";
import { pool } from "../db";

export async function todayAnalytics(_: Request, res: Response) {
  try {
    const summary = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_sales
      FROM orders
      WHERE status = 'completed'
        AND completed_at >= date_trunc('day', now())
        AND completed_at < date_trunc('day', now()) + interval '1 day'
    `);

    res.json({
      summary: summary.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Analytics failed" });
  }
}


const ALLOWED_PERIODS: Record<string, number> = {
  "1": 1,
  "7": 7,
  "30": 30,
  "90": 90,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function overviewAnalytics(req: Request, res: Response) {
  const periodParam = String(req.query.period ?? "7");
  const days = ALLOWED_PERIODS[periodParam];

  if (!days) {
    return res.status(400).json({
      error: "Invalid period. Use 1, 7, 30, or 90.",
    });
  }

  // Validate YYYY-MM-DD, including real calendar dates.
  const rawDate = req.query.date;
  let selectedDate: string;

  if (rawDate === undefined) {
    // Today's calendar date in Addis Ababa.
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Addis_Ababa",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const part = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";

    selectedDate =
      `${part("year")}-${part("month")}-${part("day")}`;
  } else {
    if (typeof rawDate !== "string" || !DATE_RE.test(rawDate)) {
      return res.status(400).json({
        error: "Invalid date. Use YYYY-MM-DD.",
      });
    }

    const parsed = new Date(`${rawDate}T00:00:00Z`);

    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== rawDate
    ) {
      return res.status(400).json({
        error: "Invalid calendar date.",
      });
    }

    selectedDate = rawDate;
  }

  // Our order timestamps are UTC stored as timestamp without time zone.
  // Convert local Addis business-day boundaries into UTC timestamps.
  //
  // start: selectedDate - (days - 1), at 00:00 Addis
  // end:   selectedDate + 1, at 00:00 Addis (exclusive)
  //
  // PostgreSQL receives the same parameters for every query.
  const params = [selectedDate, days];

  const bounds = `
    WITH boundaries AS (
      SELECT
        (
          ($1::date - ($2::int - 1))::timestamp
          AT TIME ZONE 'Africa/Addis_Ababa'
          AT TIME ZONE 'UTC'
        ) AS start_utc,
        (
          ($1::date + 1)::timestamp
          AT TIME ZONE 'Africa/Addis_Ababa'
          AT TIME ZONE 'UTC'
        ) AS end_utc
    )
  `;

  const orderFilter = `
    o.status <> 'voided'
    AND o.created_at >= b.start_utc
    AND o.created_at < b.end_utc
  `;

  try {
    const summaryQuery = pool.query(
      `
      ${bounds}
      SELECT
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS total_sales,
        COALESCE(
          (
            SELECT SUM(oi.quantity)
            FROM order_items oi
            JOIN orders o2 ON o2.id = oi.order_id
            WHERE o2.status <> 'voided'
              AND o2.created_at >= b.start_utc
              AND o2.created_at < b.end_utc
          ),
          0
        )::int AS items_sold
      FROM boundaries b
      LEFT JOIN orders o
        ON o.status <> 'voided'
       AND o.created_at >= b.start_utc
       AND o.created_at < b.end_utc
      `,
      params,
    );

    const seriesQuery = pool.query(
      `
      ${bounds}
      SELECT
        (
          (o.created_at AT TIME ZONE 'UTC')
          AT TIME ZONE 'Africa/Addis_Ababa'
        )::date AS day,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS sales
      FROM orders o
      CROSS JOIN boundaries b
      WHERE ${orderFilter}
      GROUP BY day
      ORDER BY day ASC
      `,
      params,
    );

    const itemsQuery = pool.query(
      `
      ${bounds}
      SELECT
        m.id,
        m.name,
        c.name AS category_name,
        SUM(oi.quantity)::int AS units,
        COALESCE(
          SUM(oi.quantity * oi.price_at_time), 0
        )::float AS value
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items m ON m.id = oi.menu_item_id
      JOIN categories c ON c.id = m.category_id
      CROSS JOIN boundaries b
      WHERE ${orderFilter}
      GROUP BY m.id, m.name, c.name
      ORDER BY value DESC
      `,
      params,
    );

    const itemSeriesQuery = pool.query(
      `
      ${bounds}
      SELECT
        (
          (o.created_at AT TIME ZONE 'UTC')
          AT TIME ZONE 'Africa/Addis_Ababa'
        )::date AS day,
        m.id,
        m.name,
        SUM(oi.quantity)::int AS units,
        COALESCE(
          SUM(oi.quantity * oi.price_at_time), 0
        )::float AS value
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items m ON m.id = oi.menu_item_id
      CROSS JOIN boundaries b
      WHERE ${orderFilter}
      GROUP BY day, m.id, m.name
      ORDER BY day ASC, value DESC
      `,
      params,
    );

    const waitersQuery = pool.query(
      `
      ${bounds}
      SELECT
        w.id,
        w.name,
        COUNT(DISTINCT o.id)::int AS order_count,
        COALESCE(SUM(oi.quantity), 0)::int AS units,
        COALESCE(
          SUM(oi.quantity * oi.price_at_time), 0
        )::float AS value
      FROM orders o
      JOIN waiters w ON w.id = o.waiter_id
      JOIN order_items oi ON oi.order_id = o.id
      CROSS JOIN boundaries b
      WHERE ${orderFilter}
      GROUP BY w.id, w.name
      ORDER BY value DESC
      `,
      params,
    );

    const [summary, series, items, itemSeries, waiters] =
      await Promise.all([
        summaryQuery,
        seriesQuery,
        itemsQuery,
        itemSeriesQuery,
        waitersQuery,
      ]);

    const itemSeriesMap = new Map<
      string,
      {
        day: string;
        items: {
          id: string;
          name: string;
          units: number;
          value: number;
        }[];
      }
    >();

    for (const row of itemSeries.rows) {
      const day =
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10);

      if (!itemSeriesMap.has(day)) {
        itemSeriesMap.set(day, {
          day,
          items: [],
        });
      }

      itemSeriesMap.get(day)!.items.push({
        id: String(row.id),
        name: row.name,
        units: Number(row.units),
        value: Number(row.value),
      });
    }

    // Normalize dates to YYYY-MM-DD so the frontend doesn't
    // accidentally shift a day due to browser time zones.
    const normalizedSeries = series.rows.map((row) => ({
      ...row,
      day:
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10),
    }));

    return res.json({
      period: days,
      date: selectedDate,
      summary: summary.rows[0],
      series: normalizedSeries,
      items: items.rows,
      waiters: waiters.rows,
      item_series: Array.from(itemSeriesMap.values()),
    });
  } catch (err) {
    console.error("overviewAnalytics", err);
    return res.status(500).json({
      error: "Overview analytics failed",
    });
  }
}
