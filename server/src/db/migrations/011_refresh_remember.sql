ALTER TABLE refresh_tokens
  ADD COLUMN remember TINYINT(1) NOT NULL DEFAULT 1 AFTER expires_at;
