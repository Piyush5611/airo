ALTER TABLE integration_connections
  ADD COLUMN webhook_token VARCHAR(64) NULL AFTER mode,
  ADD UNIQUE KEY uq_connection_hook (webhook_token);
