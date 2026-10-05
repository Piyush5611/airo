DELETE o FROM integration_objects o
JOIN integration_connections c ON c.id = o.connection_id
JOIN integration_providers p ON p.id = c.provider_id
WHERE p.provider_key = 'nexcall';
