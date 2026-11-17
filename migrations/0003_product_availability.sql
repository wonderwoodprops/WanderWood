-- Mark products that are immediately available from stock.
ALTER TABLE products ADD COLUMN is_available_now INTEGER NOT NULL DEFAULT 0 CHECK (is_available_now IN (0, 1));
