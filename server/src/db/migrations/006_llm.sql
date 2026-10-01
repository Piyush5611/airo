CREATE TABLE IF NOT EXISTS llm_connection (
  id TINYINT UNSIGNED PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  model_name VARCHAR(120) NOT NULL,
  base_url VARCHAR(300) NULL,
  status ENUM('connected', 'pending') NOT NULL DEFAULT 'pending',
  credential_ciphertext TEXT NULL,
  key_preview VARCHAR(12) NULL,
  connected_at DATETIME NULL,
  note VARCHAR(400) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
