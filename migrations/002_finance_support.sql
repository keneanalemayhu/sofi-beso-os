-- 002_finance_support.sql
-- Calendar support for wages, recurring expense generator, daily cash view.

BEGIN;

-- ============================================================
-- 1. DUAL CALENDAR PAYDAY
-- ============================================================
ALTER TABLE waiters
    ADD COLUMN wage_calendar VARCHAR(10) NOT NULL DEFAULT 'gregorian'
        CHECK (wage_calendar IN ('gregorian', 'ethiopian'));

-- wage_day is now interpreted against wage_calendar:
--   gregorian + monthly -> day of month 1-31 (clamped to month length)
--   ethiopian + monthly -> day of Ethiopian month 1-30 (Pagume 1-6)
--   weekly (either)     -> ISO day of week 1-7
--   daily               -> NULL

-- ============================================================
-- 2. RECURRING EXPENSE GENERATOR
-- ============================================================
CREATE OR REPLACE FUNCTION generate_due_expenses(target_date DATE DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    d         DATE := COALESCE(target_date, (now() AT TIME ZONE 'Africa/Addis_Ababa')::date);
    last_day  INT  := EXTRACT(DAY FROM (date_trunc('month', d) + INTERVAL '1 month - 1 day'))::int;
    inserted  INT;
BEGIN
    INSERT INTO expenses (
        category_id, recurring_expense_id, description,
        amount, expense_date, payment_method, note
    )
    SELECT
        r.category_id, r.id, r.description,
        r.amount, d, 'cash', 'Auto-generated from recurring schedule'
    FROM recurring_expenses r
    WHERE r.is_active
      AND r.start_date <= d
      AND (r.end_date IS NULL OR r.end_date >= d)
      AND (
            r.frequency = 'daily'
         OR (r.frequency = 'weekly'
             AND r.day_of_week = EXTRACT(ISODOW FROM d)::int)
         OR (r.frequency = 'monthly'
             AND EXTRACT(DAY FROM d)::int = LEAST(r.day_of_month, last_day))
      )
    ON CONFLICT (recurring_expense_id, expense_date)
        WHERE recurring_expense_id IS NOT NULL
        DO NOTHING;

    GET DIAGNOSTICS inserted = ROW_COUNT;
    RETURN inserted;
END;
$$ LANGUAGE plpgsql;

-- Month-end clamping: a rent set to the 31st fires on the 30th in April,
-- the 28th in February. It never silently skips a month.

-- ============================================================
-- 3. DAILY CASH VIEW
-- ============================================================
CREATE OR REPLACE VIEW daily_cash_flow AS
WITH order_days AS (
    SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa')::date AS day,
           SUM(total_amount) AS revenue
    FROM orders
    WHERE status = 'completed'
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
    COALESCE(o.revenue, 0) AS revenue,
    COALESCE(e.total, 0)   AS expenses,
    COALESCE(s.total, 0)   AS savings,
    COALESCE(o.revenue, 0) - COALESCE(e.total, 0) AS available_cash,
    COALESCE(o.revenue, 0) - COALESCE(e.total, 0) - COALESCE(s.total, 0) AS cash_after_savings
FROM all_days a
LEFT JOIN order_days   o ON o.day = a.day
LEFT JOIN expense_days e ON e.day = a.day
LEFT JOIN saving_days  s ON s.day = a.day;

COMMIT;