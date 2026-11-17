-- Customizable text displayed on the immediate-availability badge.
ALTER TABLE products ADD COLUMN availability_label TEXT NOT NULL DEFAULT 'זמין במלאי';
