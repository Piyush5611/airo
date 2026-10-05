CREATE TABLE IF NOT EXISTS business_profiles (
  organization_id BIGINT UNSIGNED PRIMARY KEY,
  profile JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_business_profile_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ad_strategies (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  status ENUM('draft', 'approved', 'archived') NOT NULL DEFAULT 'draft',
  profile_snapshot JSON NOT NULL,
  metrics_snapshot JSON NULL,
  strategy JSON NOT NULL,
  model VARCHAR(120) NULL,
  created_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_strategy_version (organization_id, version),
  KEY idx_strategy_org_status (organization_id, status),
  CONSTRAINT fk_strategy_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
