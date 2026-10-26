ALTER TABLE products
  ADD COLUMN ncm_suggestion text;

ALTER TABLE products
  ADD CONSTRAINT products_ncm_suggestion_format_check
  CHECK (ncm_suggestion IS NULL OR ncm_suggestion ~ '^[0-9]{8}$');
