CREATE TABLE IF NOT EXISTS platform_tools (
  tool_key VARCHAR(40) PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  key_preview VARCHAR(20) NULL,
  account_label VARCHAR(160) NULL,
  checked_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO platform_tools (tool_key, ciphertext, account_label, checked_at)
SELECT 'apify', cred.ciphertext, 'Moved from a business connection', UTC_TIMESTAMP()
FROM integration_connections c
JOIN integration_providers p ON p.id = c.provider_id
JOIN integration_credentials cred ON cred.connection_id = c.id
WHERE p.provider_key = 'apify' AND c.status = 'connected' AND c.mode = 'live'
ORDER BY c.id
LIMIT 1;

DELETE c FROM integration_connections c
JOIN integration_providers p ON p.id = c.provider_id
WHERE p.provider_key = 'apify';

DELETE FROM integration_providers WHERE provider_key = 'apify';
