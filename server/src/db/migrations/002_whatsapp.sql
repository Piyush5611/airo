CREATE TABLE IF NOT EXISTS whatsapp_bot (
  id TINYINT UNSIGNED PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  phone_label VARCHAR(40) NOT NULL,
  status ENUM('connected', 'pending', 'paused') NOT NULL DEFAULT 'pending',
  mode ENUM('development', 'live') NOT NULL DEFAULT 'development',
  webhook_path VARCHAR(180) NOT NULL,
  note VARCHAR(400) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_businesses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  business_label VARCHAR(160) NOT NULL,
  UNIQUE KEY uq_wa_org (organization_id),
  CONSTRAINT fk_wa_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  contact_name VARCHAR(160) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  topic VARCHAR(80) NOT NULL,
  status ENUM('open', 'waiting', 'closed') NOT NULL DEFAULT 'open',
  last_message_at DATETIME NOT NULL,
  KEY ix_wac_org (organization_id, last_message_at),
  CONSTRAINT fk_wac_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  direction ENUM('inbound', 'outbound') NOT NULL,
  body TEXT NOT NULL,
  action_taken VARCHAR(180) NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_wam_conv FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB;
