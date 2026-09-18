-- 009_archive_menu_items.sql
-- Menu revisions leave catalog rows behind: no branch offers them, but past
-- orders reference them so they cannot be deleted without losing item names
-- in order history. Flag them instead, and keep the admin Items page to
-- what is actually sellable.

BEGIN;

ALTER TABLE menu_items
    ADD COLUMN archived_at TIMESTAMP;

-- Everything no branch currently offers.
UPDATE menu_items m
SET archived_at = NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM branch_menu_items b WHERE b.menu_item_id = m.id
);

CREATE INDEX idx_menu_items_active ON menu_items (category_id)
    WHERE archived_at IS NULL;

COMMIT;