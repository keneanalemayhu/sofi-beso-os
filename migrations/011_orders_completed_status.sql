-- 011_orders_completed_status.sql
-- An order is done the moment it is placed (the kitchen ticket is printed).
-- 004 kept the old name 'pending' for that state, so the history screen
-- showed every order as "pending". Rename it to 'completed'. An order is
-- now either 'completed' or 'voided'.
--
-- Deploy together with the backend that expects 'completed': the old code
-- lists orders WHERE status = 'pending' and would show empty lists.

BEGIN;

ALTER TABLE orders DROP CONSTRAINT orders_status_check;

UPDATE orders
SET status = 'completed',
    completed_at = COALESCE(completed_at, created_at)
WHERE status = 'pending';

-- Voided orders were placed (completed) before they were voided.
UPDATE orders
SET completed_at = created_at
WHERE completed_at IS NULL;

ALTER TABLE orders
    ALTER COLUMN status SET DEFAULT 'completed',
    ALTER COLUMN completed_at SET DEFAULT (NOW() AT TIME ZONE 'UTC'),
    ALTER COLUMN completed_at SET NOT NULL,
    ADD CONSTRAINT orders_status_check CHECK (status IN ('completed', 'voided'));

-- Only two values: an index on status alone never helps.
DROP INDEX IF EXISTS idx_orders_status;

-- Keeps the line order of a ticket. All items of an order are now inserted
-- in one statement, so they share created_at and it cannot order them.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_no INTEGER;

COMMIT;
