ALTER TABLE offerings
  ADD COLUMN usps TEXT NULL AFTER details,
  ADD COLUMN offer VARCHAR(300) NULL AFTER usps;

CREATE TABLE IF NOT EXISTS offering_media (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  offering_id BIGINT UNSIGNED NULL,
  kind ENUM('photo', 'logo') NOT NULL DEFAULT 'photo',
  mime VARCHAR(40) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  bytes MEDIUMBLOB NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_media_offering (organization_id, offering_id),
  KEY idx_media_logo (organization_id, kind),
  CONSTRAINT fk_media_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_media_offering FOREIGN KEY (offering_id) REFERENCES offerings(id) ON DELETE CASCADE
) ENGINE=InnoDB;
