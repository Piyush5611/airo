ALTER TABLE whatsapp_bot
  ADD COLUMN provider_name VARCHAR(80) NULL,
  ADD COLUMN credential_ciphertext TEXT NULL,
  ADD COLUMN connected_at DATETIME NULL;
