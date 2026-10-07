CREATE TABLE IF NOT EXISTS website_form_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  offering_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  channel VARCHAR(20) NOT NULL,
  outcome ENUM('created', 'matched') NOT NULL,
  campaign_name VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_form_entry_offering (organization_id, offering_id, created_at),
  CONSTRAINT fk_form_entry_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_form_entry_offering FOREIGN KEY (offering_id) REFERENCES offerings(id) ON DELETE CASCADE,
  CONSTRAINT fk_form_entry_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
) ENGINE=InnoDB;
