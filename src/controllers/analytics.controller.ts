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
  "7": 7,
  "30": 30,
  "90": 90,
};

export async function overviewAnalytics(req: Request, res: Response) {
  const periodParam = String(req.query.period ?? "7");
  const days = ALLOWED_PERIODS[periodParam];

  if (!days) {
    return res
      .status(400)
      .json({ error: "Invalid period. Use 7, 30, or 90." });
  }

  // Rolling window: last N days in Addis Ababa time, inclusive of today.
  // We work off created_at and exclude voided orders.
  const interval = `${days} days`;

  try {
    // Stat cards: totals over the window
    const summaryQuery = pool.query(
      `
      SELECT
        COUNT(*)::int                         AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS total_sales,
        COALESCE(
          (SELECT SUM(oi.quantity)
           FROM order_items oi
           JOIN orders o2 ON o2.id = oi.order_id
           WHERE o2.status <> 'voided'
             AND o2.created_at >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1::int - 1) * interval '1 day'
          ), 0)::int                          AS items_sold
      FROM orders o
      WHERE o.status <> 'voided'
        AND o.created_at >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1::int - 1) * interval '1 day'
      `,
      [days],
    );

    // Daily sales series for the chart
    const seriesQuery = pool.query(
      `
      SELECT
        (o.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day,
        COUNT(*)::int                          AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS sales
      FROM orders o
      WHERE o.status <> 'voided'
        AND o.created_at >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1::int - 1) * interval '1 day'
      GROUP BY day
      ORDER BY day ASC
      `,
      [days],
    );

    // Top items: units + value
    const itemsQuery = pool.query(
      `
      SELECT
        m.id,
        m.name,
        c.name                                    AS category_name,
        SUM(oi.quantity)::int                     AS units,
        COALESCE(SUM(oi.quantity * oi.price_at_time), 0)::float AS value
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items m ON m.id = oi.menu_item_id
      JOIN categories c ON c.id = m.category_id
      WHERE o.status <> 'voided'
        AND o.created_at >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1::int - 1) * interval '1 day'
      GROUP BY m.id, m.name, c.name
      ORDER BY value DESC
      `,
      [days],
    );

    const itemSeriesQuery = pool.query(
      `
      SELECT
        (o.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day,
        m.id,
        m.name,
        SUM(oi.quantity)::int AS units,
        COALESCE(SUM(oi.quantity * oi.price_at_time), 0)::float AS value
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items m ON m.id = oi.menu_item_id
      WHERE o.status <> 'voided'
        AND o.created_at >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1::int - 1) * interval '1 day'
      GROUP BY day, m.id, m.name
      ORDER BY day ASC, value DESC
      `,
      [days],
    );

    // Waiter breakdown: units + value
    const waitersQuery = pool.query(
      `
      SELECT
        w.id,
        w.name,
        COUNT(DISTINCT o.id)::int                 AS order_count,
        COALESCE(SUM(oi.quantity), 0)::int        AS units,
        COALESCE(SUM(oi.quantity * oi.price_at_time), 0)::float AS value
      FROM orders o
      JOIN waiters w ON w.id = o.waiter_id
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status <> 'voided'
        AND o.created_at >= (now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1::int - 1) * interval '1 day'
      GROUP BY w.id, w.name
      ORDER BY value DESC
      `,
      [days],
    );

    const [summary, series, items, itemSeries, waiters] = await Promise.all([
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

    const item_series = Array.from(itemSeriesMap.values());

    res.json({
      period: days,
      summary: summary.rows[0],
      series: series.rows,
      items: items.rows,
      waiters: waiters.rows,
      item_series,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Overview analytics failed" });
  }
}