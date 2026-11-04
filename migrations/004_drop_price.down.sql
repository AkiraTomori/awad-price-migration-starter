-- Controlled schema recovery BEFORE any v3 restart. Existing v4 can keep running.
ALTER TABLE menu_items ADD COLUMN price REAL CHECK (price > 0);
UPDATE menu_items SET price = price_vnd / 1000.0;

-- Restore the bridge for ongoing v4 writes before any v3 restart.
CREATE TRIGGER menu_price_vnd_insert AFTER INSERT ON menu_items
WHEN NEW.price_vnd IS NOT NULL AND NEW.price IS NOT NEW.price_vnd / 1000.0
BEGIN
  UPDATE menu_items SET price = NEW.price_vnd / 1000.0 WHERE id = NEW.id;
END;

CREATE TRIGGER menu_price_vnd_update AFTER UPDATE OF price_vnd, price ON menu_items
WHEN NEW.price_vnd IS NOT NULL AND NEW.price IS NOT NEW.price_vnd / 1000.0
BEGIN
  UPDATE menu_items SET price = NEW.price_vnd / 1000.0 WHERE id = NEW.id;
END;
