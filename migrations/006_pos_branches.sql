-- 006_pos_branches.sql
-- Branch scoping for the POS surface only (cashier + orders-history).
-- Admin-side scoping (expenses, savings, wages) comes later.
--
-- Branch is resolved from the tablet: each device is registered to exactly
-- one branch, so a cashier cannot pick the wrong one mid-shift.

BEGIN;

-- ============================================================
-- 1. BRANCHES
-- ============================================================
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO branches (name, slug) VALUES ('Main', 'main');

-- ============================================================
-- 2. DEVICES
-- ============================================================
CREATE TABLE devices (
    device_id TEXT PRIMARY KEY,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    name VARCHAR(100),
    registered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP
);

-- Keeps tablets running the current bundle working through the rollout.
INSERT INTO devices (device_id, branch_id, name)
SELECT 'cashier-1', id, 'Legacy cashier (pre-branch)' FROM branches WHERE slug = 'main';

-- ============================================================
-- 3. SCOPE ORDERS AND STAFF
-- ============================================================
ALTER TABLE orders  ADD COLUMN branch_id UUID REFERENCES branches(id);
ALTER TABLE waiters ADD COLUMN branch_id UUID REFERENCES branches(id);

UPDATE orders  SET branch_id = (SELECT id FROM branches WHERE slug = 'main');
UPDATE waiters SET branch_id = (SELECT id FROM branches WHERE slug = 'main');

ALTER TABLE orders  ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE waiters ALTER COLUMN branch_id SET NOT NULL;

-- Both branches will have an አስቴር
ALTER TABLE waiters DROP CONSTRAINT waiters_name_key;
ALTER TABLE waiters ADD CONSTRAINT waiters_branch_name_key UNIQUE (branch_id, name);

DROP INDEX idx_waiters_pos;
CREATE INDEX idx_waiters_pos ON waiters (branch_id, name)
    WHERE role = 'waiter' AND is_active;

-- ============================================================
-- 4. MENU: CATALOG + PER-BRANCH OFFERING
-- ============================================================
-- menu_items.price becomes the default; a branch may override or omit.
CREATE TABLE branch_menu_items (
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    price_override NUMERIC(10,2) CHECK (price_override >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (branch_id, menu_item_id)
);

INSERT INTO branch_menu_items (branch_id, menu_item_id)
SELECT (SELECT id FROM branches WHERE slug = 'main'), id FROM menu_items;

-- Same shape the POS already consumes: id, name, price, category_name, is_active
CREATE VIEW branch_menu AS
SELECT
    bmi.branch_id,
    m.id,
    m.category_id,
    c.name AS category_name,
    m.name,
    COALESCE(bmi.price_override, m.price) AS price,
    (m.is_active AND bmi.is_active) AS is_active,
    m.created_at
FROM branch_menu_items bmi
JOIN menu_items m ON m.id = bmi.menu_item_id
JOIN categories c ON c.id = m.category_id;

CREATE INDEX idx_orders_branch_created ON orders (branch_id, created_at DESC);
CREATE INDEX idx_branch_menu_items_branch ON branch_menu_items (branch_id) WHERE is_active;

COMMIT;