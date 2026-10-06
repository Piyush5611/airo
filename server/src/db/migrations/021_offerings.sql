CREATE TABLE IF NOT EXISTS offerings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('product', 'project', 'service', 'course', 'package', 'other') NOT NULL DEFAULT 'product',
  name VARCHAR(160) NOT NULL,
  details TEXT NULL,
  price_text VARCHAR(160) NULL,
  locations VARCHAR(400) NULL,
  website VARCHAR(500) NULL,
  source ENUM('manual', 'whatsapp', 'ad_chat') NOT NULL DEFAULT 'manual',
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  times_used INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_offering_name (organization_id, name),
  KEY idx_offering_org_status (organization_id, status),
  CONSTRAINT fk_offering_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
