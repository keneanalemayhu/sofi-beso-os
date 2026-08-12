-- 003_revenue_from_orders.sql
-- Payment capture is intentionally absent: cashiers close an order in one
-- step, so 'completed' never gets set. Revenue is derived from all
-- non-voided orders instead of status='completed'.

BEGIN;

DROP VIEW IF EXISTS daily_cash_flow;

CREATE VIEW daily_cash_flow AS
WITH order_days AS (
    SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa')::date AS day,
           SUM(total_amount) AS revenue,
           COUNT(*) AS order_count
    FROM orders
    WHERE status <> 'voided'
    GROUP BY 1
),
expense_days AS (
    SELECT expense_date AS day, SUM(amount) AS total
    FROM expenses GROUP BY 1
),
saving_days AS (
    SELECT period_date AS day, SUM(amount) AS total
    FROM savings_entries GROUP BY 1
),
all_days AS (
    SELECT day FROM order_days
    UNION SELECT day FROM expense_days
    UNION SELECT day FROM saving_days
)
SELECT
    a.day,
    COALESCE(o.revenue, 0)     AS revenue,
    COALESCE(o.order_count, 0) AS order_count,
    COALESCE(e.total, 0)       AS expenses,
    COALESCE(s.total, 0)       AS savings,
    COALESCE(o.revenue, 0) - COALESCE(e.total, 0) AS available_cash,
    COALESCE(o.revenue, 0) - COALESCE(e.total, 0) - COALESCE(s.total, 0) AS cash_after_savings
FROM all_days a
LEFT JOIN order_days   o ON o.day = a.day
LEFT JOIN expense_days e ON e.day = a.day
LEFT JOIN saving_days  s ON s.day = a.day;

COMMIT;