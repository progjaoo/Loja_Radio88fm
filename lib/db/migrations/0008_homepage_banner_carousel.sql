ALTER TABLE store_homepage_banner
  ADD COLUMN IF NOT EXISTS slides jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE store_homepage_banner
SET slides = jsonb_build_array(jsonb_build_object(
  'id', 'legacy-main',
  'enabled', enabled,
  'title', title,
  'description', description,
  'imageUrl', image_url,
  'mobileImageUrl', mobile_image_url,
  'alt', alt,
  'ctaLabel', cta_label,
  'ctaHref', cta_href
))
WHERE jsonb_array_length(slides) = 0
  AND (
    image_url IS NOT NULL
    OR mobile_image_url IS NOT NULL
    OR btrim(title) <> ''
    OR btrim(description) <> ''
    OR enabled
  );
