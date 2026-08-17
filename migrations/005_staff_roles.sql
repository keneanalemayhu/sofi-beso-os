-- 005_staff_roles.sql
-- Staff are not all waiters. Only role='waiter' is offered in the POS
-- order screen; the rest exist for payroll only. Table stays named
-- `waiters` because orders.waiter_id and the offline sync queues on the
-- deployed tablets reference it.

BEGIN;

ALTER TABLE waiters
    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'waiter'
        CHECK (role IN ('waiter', 'cook', 'cashier', 'janitor', 'manager', 'other'));

-- POS lookup path
CREATE INDEX idx_waiters_pos ON waiters (name) WHERE role = 'waiter' AND is_active;

COMMIT;