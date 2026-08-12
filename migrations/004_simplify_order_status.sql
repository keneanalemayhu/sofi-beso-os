-- 004_simplify_order_status.sql
-- Payment capture was intentionally dropped: cashiers close an order without
-- a separate payment step. 'completed' therefore carries no meaning distinct
-- from 'pending' — an order counts unless it is voided. Collapse the 2,045
-- legacy 'completed' rows and drop the status from the constraint.

BEGIN;

UPDATE orders SET status = 'pending' WHERE status = 'completed';

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'voided'));

DROP TABLE IF EXISTS payments;

COMMIT;