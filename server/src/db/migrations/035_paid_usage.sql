CREATE TABLE IF NOT EXISTS paid_usage (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tool ENUM('llm', 'apify') NOT NULL,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(160) NULL,
  purpose VARCHAR(40) NULL,
  feature VARCHAR(60) NULL,
  organization_id BIGINT UNSIGNED NULL,
  status ENUM('ok', 'failed') NOT NULL DEFAULT 'ok',
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  items INT UNSIGNED NOT NULL DEFAULT 0,
  max_charge_usd DECIMAL(8,2) NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_paid_usage_time (tool, created_at),
  KEY idx_paid_usage_org (organization_id, created_at)
) ENGINE=InnoDB;
