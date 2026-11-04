-- Install only after backfill/check and verification of v3/v3 writers.
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
