-- S8: only after verified v4/v4, a verified backup, and student approval on live DB.
DROP TRIGGER menu_price_vnd_insert;
DROP TRIGGER menu_price_vnd_update;
ALTER TABLE menu_items DROP COLUMN price;
