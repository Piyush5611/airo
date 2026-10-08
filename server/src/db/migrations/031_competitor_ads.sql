CREATE TABLE IF NOT EXISTS competitor_ad_checks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  competitor_id BIGINT UNSIGNED NOT NULL,
  status ENUM('running', 'ready', 'failed') NOT NULL DEFAULT 'running',
  meta JSON NULL,
  google JSON NULL,
  notes JSON NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  KEY idx_competitor_ad_check (organization_id, competitor_id, id),
  CONSTRAINT fk_competitor_ad_check_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_competitor_ad_check_comp FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE
) ENGINE=InnoDB;
