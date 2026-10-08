ALTER TABLE competitors
  ADD COLUMN competitor_type ENUM('direct', 'indirect', 'market', 'emerging') NULL AFTER notes,
  ADD COLUMN confidence TINYINT UNSIGNED NULL AFTER competitor_type,
  ADD COLUMN source VARCHAR(80) NULL AFTER confidence,
  ADD COLUMN reason VARCHAR(500) NULL AFTER source,
  ADD COLUMN verified_at DATETIME NULL AFTER reason;

CREATE TABLE IF NOT EXISTS competitor_ads (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  competitor_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('meta', 'google') NOT NULL,
  external_id VARCHAR(80) NOT NULL,
  advertiser VARCHAR(160) NULL,
  format VARCHAR(20) NULL,
  headline VARCHAR(200) NULL,
  body TEXT NULL,
  cta VARCHAR(60) NULL,
  link VARCHAR(500) NULL,
  image_url VARCHAR(1000) NULL,
  placements JSON NULL,
  versions SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  first_shown DATE NULL,
  last_shown DATE NULL,
  source VARCHAR(80) NOT NULL,
  source_url VARCHAR(500) NULL,
  content_hash CHAR(64) NOT NULL,
  first_observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  analysis JSON NULL,
  analysis_hash CHAR(64) NULL,
  analysis_model VARCHAR(120) NULL,
  analysis_version SMALLINT UNSIGNED NULL,
  analyzed_at DATETIME NULL,
  UNIQUE KEY uq_competitor_ad (organization_id, competitor_id, platform, external_id),
  KEY idx_competitor_ad_hash (organization_id, content_hash),
  KEY idx_competitor_ad_pending (organization_id, analyzed_at),
  CONSTRAINT fk_competitor_ad_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_competitor_ad_comp FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS competitor_ad_snapshots (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  ad_id BIGINT UNSIGNED NOT NULL,
  check_id BIGINT UNSIGNED NULL,
  change_type ENUM('new', 'changed', 'stopped', 'restarted') NOT NULL,
  content_hash CHAR(64) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL,
  payload JSON NOT NULL,
  observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_competitor_ad_snapshot (organization_id, ad_id, id),
  CONSTRAINT fk_competitor_snapshot_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_competitor_snapshot_ad FOREIGN KEY (ad_id) REFERENCES competitor_ads(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS competitor_insights (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  competitor_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  kind ENUM('strategy') NOT NULL,
  input_hash CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  model VARCHAR(120) NULL,
  version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_competitor_insight (organization_id, competitor_id, kind, id),
  CONSTRAINT fk_competitor_insight_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
