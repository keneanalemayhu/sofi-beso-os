-- 001_finance.sql
-- Waiter wages, expenses, savings.
-- Reconciled against live schema dump 2026-08-10.

BEGIN;

-- ============================================================
-- 0. PREREQ: admin role
-- ============================================================
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('cashier', 'kitchen', 'admin'));

-- ============================================================
-- 1. WAITER WAGES
-- ============================================================
ALTER TABLE waiters
    ADD COLUMN wage_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (wage_amount >= 0),
    ADD COLUMN wage_cycle VARCHAR(10) NOT NULL DEFAULT 'monthly'
        CHECK (wage_cycle IN ('daily', 'weekly', 'monthly')),
    ADD COLUMN wage_day SMALLINT CHECK (wage_day BETWEEN 1 AND 31),
    ADD COLUMN hired_on DATE;
-- wage_day: monthly -> day of month 1-31 | weekly -> ISO dow 1-7 | daily -> NULL

CREATE TABLE waiter_wage_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    waiter_id UUID NOT NULL REFERENCES waiters(id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    paid_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date,
    paid_by UUID REFERENCES users(id),
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT wage_period_check CHECK (period_end >= period_start),
    UNIQUE (waiter_id, period_start, period_end)
);

-- ============================================================
-- 2. EXPENSES
-- ============================================================
CREATE TABLE expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE recurring_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    description VARCHAR(200) NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    frequency VARCHAR(10) NOT NULL
        CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    day_of_week SMALLINT CHECK (day_of_week BETWEEN 1 AND 7),
    day_of_month SMALLINT CHECK (day_of_month BETWEEN 1 AND 31),
    start_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT recurring_schedule_check CHECK (
        (frequency = 'daily'   AND day_of_week IS NULL AND day_of_month IS NULL) OR
        (frequency = 'weekly'  AND day_of_week IS NOT NULL AND day_of_month IS NULL) OR
        (frequency = 'monthly' AND day_of_week IS NULL AND day_of_month IS NOT NULL)
    )
);

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    recurring_expense_id UUID REFERENCES recurring_expenses(id) ON DELETE SET NULL,
    wage_payment_id UUID REFERENCES waiter_wage_payments(id) ON DELETE CASCADE,
    description VARCHAR(200) NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date,
    payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'transfer', 'telebirr', 'cbe', 'other')),
    created_by UUID REFERENCES users(id),
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT expense_source_check CHECK (
        NOT (recurring_expense_id IS NOT NULL AND wage_payment_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_expenses_recurring_instance
    ON expenses (recurring_expense_id, expense_date)
    WHERE recurring_expense_id IS NOT NULL;

-- ============================================================
-- 3. SAVINGS
-- ============================================================
CREATE TABLE savings_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    period_type VARCHAR(10) NOT NULL
        CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    target_per_period NUMERIC(10,2) NOT NULL CHECK (target_per_period > 0),
    period_count INTEGER NOT NULL CHECK (period_count > 0),
    start_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE savings_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES savings_plans(id) ON DELETE CASCADE,
    period_index INTEGER NOT NULL CHECK (period_index >= 1),
    period_date DATE NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    saved_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    note TEXT,
    UNIQUE (plan_id, period_index)
);

CREATE VIEW savings_progress AS
SELECT
    e.plan_id,
    p.name AS plan_name,
    e.period_index,
    e.period_date,
    e.amount,
    SUM(e.amount) OVER (
        PARTITION BY e.plan_id ORDER BY e.period_index
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_total
FROM savings_entries e
JOIN savings_plans p ON p.id = e.plan_id;

CREATE VIEW savings_plan_summary AS
SELECT
    p.id AS plan_id,
    p.name,
    p.period_type,
    p.target_per_period,
    p.period_count,
    p.start_date,
    p.is_active,
    (p.target_per_period * p.period_count) AS target_total,
    COALESCE(SUM(e.amount), 0) AS saved_total,
    COUNT(e.id) AS periods_saved
FROM savings_plans p
LEFT JOIN savings_entries e ON e.plan_id = p.id
GROUP BY p.id;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_wage_payments_waiter ON waiter_wage_payments(waiter_id);
CREATE INDEX idx_wage_payments_paid_on ON waiter_wage_payments(paid_on);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_wage_payment ON expenses(wage_payment_id);
CREATE INDEX idx_recurring_expenses_active ON recurring_expenses(is_active);
CREATE INDEX idx_savings_entries_plan ON savings_entries(plan_id);

INSERT INTO expense_categories (name) VALUES
    ('Ingredients'), ('Rent'), ('Utilities'), ('Wages'),
    ('Equipment'), ('Maintenance'), ('Other')
ON CONFLICT (name) DO NOTHING;

COMMIT;