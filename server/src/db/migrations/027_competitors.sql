CREATE TABLE IF NOT EXISTS competitors (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  website VARCHAR(500) NULL,
  facebook VARCHAR(300) NULL,
  instagram VARCHAR(120) NULL,
  city VARCHAR(120) NULL,
  notes VARCHAR(1000) NULL,
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  last_analyzed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_competitor_name (organization_id, name),
  CONSTRAINT fk_competitor_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS competitor_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  competitor_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ready', 'failed') NOT NULL,
  website JSON NULL,
  keywords JSON NULL,
  analysis JSON NULL,
  notes JSON NULL,
  model VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_competitor_report (organization_id, competitor_id, created_at),
  CONSTRAINT fk_competitor_report_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_competitor_report_comp FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE
) ENGINE=InnoDB;
