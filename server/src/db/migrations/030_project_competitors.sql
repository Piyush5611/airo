CREATE TABLE IF NOT EXISTS competitor_offerings (
  competitor_id BIGINT UNSIGNED NOT NULL,
  offering_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (competitor_id, offering_id),
  KEY idx_competitor_offering (organization_id, offering_id),
  CONSTRAINT fk_comp_offering_comp FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE,
  CONSTRAINT fk_comp_offering_offering FOREIGN KEY (offering_id) REFERENCES offerings(id) ON DELETE CASCADE,
  CONSTRAINT fk_comp_offering_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE competitor_suggestions
  ADD COLUMN offering_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER organization_id,
  DROP INDEX uq_suggestion,
  ADD UNIQUE KEY uq_suggestion (organization_id, offering_id, match_key);

ALTER TABLE competitor_discovery_runs
  ADD COLUMN offering_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER organization_id,
  ADD KEY idx_discovery_scope (organization_id, offering_id, id);
