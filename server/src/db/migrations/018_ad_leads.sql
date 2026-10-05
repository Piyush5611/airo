ALTER TABLE leads ADD COLUMN deal_value_inr DECIMAL(14, 2) NULL AFTER budget_inr;

CREATE TABLE IF NOT EXISTS ad_lead_imports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  connection_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('meta', 'google') NOT NULL,
  external_lead_id VARCHAR(40) NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  campaign_external_id VARCHAR(80) NULL,
  ad_external_id VARCHAR(80) NULL,
  form_external_id VARCHAR(80) NULL,
  outcome ENUM('created', 'matched', 'skipped') NOT NULL DEFAULT 'created',
  submitted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ad_lead (organization_id, platform, external_lead_id),
  KEY idx_ad_lead_campaign (organization_id, campaign_external_id, submitted_at),
  CONSTRAINT fk_ad_lead_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_lead_conn FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_lead_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
) ENGINE=InnoDB;
