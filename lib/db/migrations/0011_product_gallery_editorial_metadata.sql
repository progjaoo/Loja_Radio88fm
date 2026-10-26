ALTER TABLE products
  ADD COLUMN gallery_layout text NOT NULL DEFAULT 'square';

ALTER TABLE products
  ADD CONSTRAINT products_gallery_layout_check
  CHECK (gallery_layout IN ('square', 'portrait'));

ALTER TABLE store_product_images
  ADD COLUMN is_hover boolean NOT NULL DEFAULT false;

UPDATE products AS product
SET gallery_layout = 'portrait'
FROM categories AS category
WHERE category.id = product.category_id
  AND lower(category.name) = 'camisas';

UPDATE store_product_images AS image
SET is_primary = false
FROM products AS product
JOIN categories AS category ON category.id = product.category_id
WHERE image.product_id = product.id
  AND lower(category.name) = 'camisas'
  AND EXISTS (
    SELECT 1
    FROM store_product_images AS back_art
    WHERE back_art.product_id = product.id
      AND lower(back_art.alt) LIKE '%estampa traseira%'
  );

WITH eligible_back_art AS (
  SELECT DISTINCT ON (image.product_id) image.id, image.product_id, image.url
  FROM store_product_images AS image
  JOIN products AS product ON product.id = image.product_id
  JOIN categories AS category ON category.id = product.category_id
  WHERE lower(category.name) = 'camisas'
    AND lower(image.alt) LIKE '%estampa traseira%'
  ORDER BY image.product_id, image.sort_order, image.created_at
)
UPDATE store_product_images AS image
SET is_primary = true
FROM eligible_back_art AS candidate
WHERE image.id = candidate.id;

UPDATE products AS product
SET image_url = image.url
FROM store_product_images AS image
WHERE image.product_id = product.id
  AND image.is_primary;

WITH eligible_back_photos AS (
  SELECT DISTINCT ON (image.product_id) image.id
  FROM store_product_images AS image
  JOIN products AS product ON product.id = image.product_id
  JOIN categories AS category ON category.id = product.category_id
  WHERE lower(category.name) = 'camisas'
    AND lower(image.alt) LIKE '%manequim%'
    AND (lower(image.alt) LIKE '%traseir%' OR lower(image.alt) LIKE '%costas%')
  ORDER BY image.product_id, image.sort_order, image.created_at
)
UPDATE store_product_images AS image
SET is_hover = true
FROM eligible_back_photos AS candidate
WHERE image.id = candidate.id;

CREATE UNIQUE INDEX store_product_images_hover_unique
  ON store_product_images (product_id)
  WHERE is_hover;
