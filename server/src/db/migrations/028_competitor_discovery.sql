INSERT IGNORE INTO integration_providers (category, provider_key, name, description, availability)
VALUES ('research', 'apify', 'Apify', 'Finds competitors from Google search, Meta ads and Google Maps. Uses your Apify token and credit.', 'available');

CREATE TABLE IF NOT EXISTS competitor_discovery_runs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  trigger_type ENUM('manual', 'weekly') NOT NULL DEFAULT 'manual',
  status ENUM('running', 'ready', 'failed') NOT NULL DEFAULT 'running',
  plan JSON NULL,
  counts JSON NULL,
  notes JSON NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  KEY idx_discovery_org (organization_id, id),
  CONSTRAINT fk_discovery_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS competitor_suggestions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  match_key VARCHAR(200) NOT NULL,
  name VARCHAR(160) NOT NULL,
  website VARCHAR(500) NULL,
  facebook VARCHAR(300) NULL,
  city VARCHAR(120) NULL,
  category VARCHAR(160) NULL,
  sources JSON NULL,
  score INT NOT NULL DEFAULT 0,
  verdict ENUM('direct', 'indirect', 'unclear') NOT NULL DEFAULT 'unclear',
  reason VARCHAR(400) NULL,
  status ENUM('new', 'added', 'ignored') NOT NULL DEFAULT 'new',
  competitor_id BIGINT UNSIGNED NULL,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_suggestion (organization_id, match_key),
  KEY idx_suggestion_status (organization_id, status, score),
  CONSTRAINT fk_suggestion_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
