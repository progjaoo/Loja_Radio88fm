INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
CROSS JOIN store_permissions AS permissions
WHERE roles.slug = 'stockist'
  AND roles.is_system = true
  AND permissions.key IN ('categories:read', 'payments:read')
ON CONFLICT DO NOTHING;
