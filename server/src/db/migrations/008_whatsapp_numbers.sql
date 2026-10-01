CREATE TABLE IF NOT EXISTS whatsapp_business_numbers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(20) NOT NULL,
  phone_key CHAR(10) NOT NULL,
  label VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wa_phone_key (phone_key),
  KEY ix_wa_num_org (organization_id),
  CONSTRAINT fk_wa_num_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
