-- 008_imperial_menu_v2.sql
-- Replaces Imperial's menu with the new printed menu (ሶፊ በሶ #2).
--
-- The printed menu has two levels (section → sub-section); categories are
-- one level, so the eight main sections become the categories and the
-- sub-sections are dropped.
--
-- ትኩስ መጠጦች is shared with Main because categories.name is globally unique.
-- Items whose names collide there (ሻይ, ቀሽር) reuse Main's catalog rows with a
-- price_override rather than creating duplicates.
--
-- Catalog rows left orphaned by the old menu are removed at the end, except
-- any that appear in past orders.
--
-- Safe to re-run.

BEGIN;

-- ============================================================
-- 0. CLEAR IMPERIAL'S CURRENT OFFERING
-- ============================================================
DELETE FROM branch_menu_items
WHERE branch_id = (SELECT id FROM branches WHERE slug = 'imperial');

-- ============================================================
-- 1. CATEGORIES
-- ============================================================
INSERT INTO categories (name) VALUES
    ('የፍስክ ቁርስና ምሳ'),
    ('የጾም ቁርስና ምሳ'),
    ('በትዕዛዝ የሚጨመሩ'),
    ('የበሶ ምርጫዎች'),
    ('የተልባ ምርጫዎች'),
    ('የአብሽ ምርጫዎች'),
    ('ትኩስ መጠጦች'),
    ('ቀዝቃዛ መጠጦች')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 2. ITEMS AND OFFERING
-- ============================================================
CREATE TEMP TABLE imperial_menu (cat TEXT, item TEXT, price NUMERIC(10,2))
ON COMMIT DROP;

INSERT INTO imperial_menu (cat, item, price) VALUES
-- ሀ. የፍስክ ቁርስና ምሳ
('የፍስክ ቁርስና ምሳ', 'እንቁላል ሳንደዊች',    150),
('የፍስክ ቁርስና ምሳ', 'እንቁላል ፍርፍር',     230),
('የፍስክ ቁርስና ምሳ', 'እንቁላል በሥጋ',      250),
('የፍስክ ቁርስና ምሳ', 'እንቁላል ስልስ',      230),
('የፍስክ ቁርስና ምሳ', 'ፓስታ በእንቁላል',     250),
('የፍስክ ቁርስና ምሳ', 'መኮረኒ በእንቁላል',    250),
('የፍስክ ቁርስና ምሳ', 'ሩዝ በእንቁላል',      250),
('የፍስክ ቁርስና ምሳ', 'ፈታ',             270),
('የፍስክ ቁርስና ምሳ', 'ጨጨብሳ ስፔሻል',      270),
('የፍስክ ቁርስና ምሳ', 'ቅንጬ በቅቤ',        250),
('የፍስክ ቁርስና ምሳ', 'ዱለት መደበኛ',       300),
('የፍስክ ቁርስና ምሳ', 'ዱለት ስፔሻል',       350),
('የፍስክ ቁርስና ምሳ', 'ፋል',             230),
('የፍስክ ቁርስና ምሳ', 'ፋል ስፔሻል',        270),
('የፍስክ ቁርስና ምሳ', 'ሥጋ ፍርፍር',        270),
('የፍስክ ቁርስና ምሳ', 'ሥጋ ፍርፍር ሙሉ',     320),
('የፍስክ ቁርስና ምሳ', 'ጥብስ ፍርፍር',       300),
('የፍስክ ቁርስና ምሳ', 'ጥብስ ፍርፍር ሙሉ',    350),
('የፍስክ ቁርስና ምሳ', 'ጥብስ የበሬ',        400),
('የፍስክ ቁርስና ምሳ', 'ጥብስ የበግ',        450),
('የፍስክ ቁርስና ምሳ', 'ቅቅል',            500),
('የፍስክ ቁርስና ምሳ', 'ቀይ ወጥ',          350),
('የፍስክ ቁርስና ምሳ', 'ምንቼት',           300),
('የፍስክ ቁርስና ምሳ', 'ድንች በሥጋ',        300),
('የፍስክ ቁርስና ምሳ', 'ምስር በሥጋ',        300),
('የፍስክ ቁርስና ምሳ', 'ቦዘና',            300),
('የፍስክ ቁርስና ምሳ', 'ጎመን በሥጋ',        350),
('የፍስክ ቁርስና ምሳ', 'ሩዝ በሥጋ',         280),
('የፍስክ ቁርስና ምሳ', 'ፓስታ በሥጋ',        280),
('የፍስክ ቁርስና ምሳ', 'ማካሮኒ በሥጋ',       280),

-- ለ. የጾም ቁርስና ምሳ
('የጾም ቁርስና ምሳ', 'ጨጨብሳ',                    230),
('የጾም ቁርስና ምሳ', 'ቅንጬ',                     230),
('የጾም ቁርስና ምሳ', 'ዳቦ ፍርፍር',                 230),
('የጾም ቁርስና ምሳ', 'ፍርፍር',                    230),
('የጾም ቁርስና ምሳ', 'ቂጣ በለውዝ ከወተት ጋር',         200),
('የጾም ቁርስና ምሳ', 'መደበኛ ፍርፍር ሙሉ',            270),
('የጾም ቁርስና ምሳ', 'ተልባ ፍትፍት በበረዶ',           250),
('የጾም ቁርስና ምሳ', 'ሱፍ ፍትፍት በበረዶ',            250),
('የጾም ቁርስና ምሳ', 'ሽሮ ፍትፍት በበረዶ',            230),
('የጾም ቁርስና ምሳ', 'ቲማቲም እና ኪያር ቁርጥ በቂጣ',     250),
('የጾም ቁርስና ምሳ', 'ሽሮ ፈሰስ',                  230),
('የጾም ቁርስና ምሳ', 'ተጋቢኖ',                    250),
('የጾም ቁርስና ምሳ', 'ምስር በቀይ/በአልጫ',            230),
('የጾም ቁርስና ምሳ', 'ጎመን',                     250),
('የጾም ቁርስና ምሳ', 'በየአይነቱ',                  250),
('የጾም ቁርስና ምሳ', 'ግማሽ ግማሽ',                 270),
('የጾም ቁርስና ምሳ', 'ግማሽ ግማሽ በድርቆሽ',           300),
('የጾም ቁርስና ምሳ', 'ግማሽ ግማሽ በተልባ',            300),
('የጾም ቁርስና ምሳ', 'ግማሽ ግማሽ በሱፍ',             300),
('የጾም ቁርስና ምሳ', 'ግማሽ ግማሽ በቅንጬ',            300),
('የጾም ቁርስና ምሳ', 'ፓስታ በሶስ',                 230),
('የጾም ቁርስና ምሳ', 'ማካሮኒ በሶስ',                230),
('የጾም ቁርስና ምሳ', 'ፓስታ በአትክልት',              250),
('የጾም ቁርስና ምሳ', 'ማካሮኒ በአትክልት',             250),
('የጾም ቁርስና ምሳ', 'ሩዝ በአትክልት',               250),
('የጾም ቁርስና ምሳ', 'ቲማቲም ለብለብ',               230),
('የጾም ቁርስና ምሳ', 'ቲማቲም ቁርጥ',                230),

-- ሐ. በትዕዛዝ የሚጨመሩ
('በትዕዛዝ የሚጨመሩ', 'እንጀራ ሙሉ',     60),
('በትዕዛዝ የሚጨመሩ', 'እንጀራ ግማሽ',    30),
('በትዕዛዝ የሚጨመሩ', 'ቆጮ',          30),
('በትዕዛዝ የሚጨመሩ', 'ዳቦ',          15),
('በትዕዛዝ የሚጨመሩ', 'አቮካዶ',        50),
('በትዕዛዝ የሚጨመሩ', 'ቂጣ',          50),
('በትዕዛዝ የሚጨመሩ', 'ማር',          50),
('በትዕዛዝ የሚጨመሩ', 'እርጎ',         50),
('በትዕዛዝ የሚጨመሩ', 'አይብ',         50),
('በትዕዛዝ የሚጨመሩ', 'እንቁላል',       50),

-- የበሶ ምርጫዎች
('የበሶ ምርጫዎች', 'መደበኛ በሶ',                              60),
('የበሶ ምርጫዎች', 'በሶ በተልባ',                              70),
('የበሶ ምርጫዎች', 'በሶ በወተት',                              80),
('የበሶ ምርጫዎች', 'በሶ በአብሽ',                              80),
('የበሶ ምርጫዎች', 'በሶ በማር',                               80),
('የበሶ ምርጫዎች', 'በሶ በለውዝ',                              80),
('የበሶ ምርጫዎች', 'በሶ በለውዝ፣ በወተት፣ በማር፣ በተልባ',            160),
('የበሶ ምርጫዎች', 'በሶ በለውዝ፣ በወተት፣ በማር፣ በአብሽ',            160),
('የበሶ ምርጫዎች', 'በሶ ልዩ (በወተት፣ በማር፣ በተልባ)',             130),
('የበሶ ምርጫዎች', 'በሶ ልዩ 2 (አብሽ፣ ተልባ፣ ለውዝ፣ ማርና ወተት)',   180),

-- የተልባ ምርጫዎች
('የተልባ ምርጫዎች', 'ንጹሕ ተልባ',                 100),
('የተልባ ምርጫዎች', 'ተልባ በወተት',                130),
('የተልባ ምርጫዎች', 'ተልባ በማር',                 130),
('የተልባ ምርጫዎች', 'ተልባ በለውዝ',                130),
('የተልባ ምርጫዎች', 'ተልባ ልዩ (በማር እና በወተት)',    160),

-- የአብሽ ምርጫዎች
('የአብሽ ምርጫዎች', 'ንጹሕ አብሽ ብቻ',           100),
('የአብሽ ምርጫዎች', 'አብሽ በተልባ',             130),
('የአብሽ ምርጫዎች', 'አብሽ በማር',              130),
('የአብሽ ምርጫዎች', 'አብሽ በወተት',             130),
('የአብሽ ምርጫዎች', 'አብሽ በለውዝ',             130),
('የአብሽ ምርጫዎች', 'አብሽ ልዩ (በማር፣ በወተት)',   150),

-- ትኩስ መጠጦች (shared category with Main; ሻይ and ቀሽር reuse Main's rows)
('ትኩስ መጠጦች', 'ቡና የጀበና',      40),
('ትኩስ መጠጦች', 'ቡና የማሽን',      90),
('ትኩስ መጠጦች', 'ሻይ',           30),
('ትኩስ መጠጦች', 'ሻይ በማር',       60),
('ትኩስ መጠጦች', 'አስፕሪስ',        60),
('ትኩስ መጠጦች', 'ለዉዝ ሻይ',       80),
('ትኩስ መጠጦች', 'ወተት',          90),
('ትኩስ መጠጦች', 'ቀሽር',          30),
('ትኩስ መጠጦች', 'ማክያቶ የፆም',     80),
('ትኩስ መጠጦች', 'ማካያቶ',         80),
('ትኩስ መጠጦች', 'ስፔሻል ሻይ',     110),
('ትኩስ መጠጦች', 'ብርቱካን ሻይ',     80),
('ትኩስ መጠጦች', 'ሎሚ ሻይ',        80),

-- ቀዝቃዛ መጠጦች
('ቀዝቃዛ መጠጦች', 'ውሃ (ግማሽ ሊትር)',   30),
('ቀዝቃዛ መጠጦች', 'ውሃ (1 ሊትር)',     50),
('ቀዝቃዛ መጠጦች', 'ውሃ (2 ሊትር)',     60),
('ቀዝቃዛ መጠጦች', 'የለስላሳ መጠጦች',     50),
('ቀዝቃዛ መጠጦች', 'አምቦ ውሃ',         50),
('ቀዝቃዛ መጠጦች', 'ንጉስ ማልት',        80);

-- Create catalog rows. Existing rows keep their price, so Main's ሻይ stays 25.
INSERT INTO menu_items (category_id, name, price)
SELECT c.id, im.item, im.price
FROM imperial_menu im
JOIN categories c ON c.name = im.cat
ON CONFLICT (category_id, name) DO NOTHING;

-- Offer them at Imperial, overriding only where Imperial's price differs
-- from the catalog default.
INSERT INTO branch_menu_items (branch_id, menu_item_id, price_override)
SELECT
    (SELECT id FROM branches WHERE slug = 'imperial'),
    m.id,
    CASE WHEN m.price <> im.price THEN im.price END
FROM imperial_menu im
JOIN categories c ON c.name = im.cat
JOIN menu_items m ON m.category_id = c.id AND m.name = im.item
ON CONFLICT (branch_id, menu_item_id)
    DO UPDATE SET price_override = EXCLUDED.price_override;

-- ============================================================
-- 3. CLEAN UP THE OLD MENU
-- ============================================================
-- Catalog rows no branch offers any more, and that no past order references.
-- Rows that appear in orders are kept so history stays readable.
DELETE FROM menu_items m
WHERE NOT EXISTS (
        SELECT 1 FROM branch_menu_items b WHERE b.menu_item_id = m.id
      )
  AND NOT EXISTS (
        SELECT 1 FROM order_items oi WHERE oi.menu_item_id = m.id
      );

-- Categories left with no items at all.
DELETE FROM categories c
WHERE NOT EXISTS (
    SELECT 1 FROM menu_items m WHERE m.category_id = c.id
);

COMMIT;