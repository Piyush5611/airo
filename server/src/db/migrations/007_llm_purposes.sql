ALTER TABLE llm_connection
  MODIFY id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD COLUMN purpose VARCHAR(40) NOT NULL DEFAULT 'assistant' AFTER id,
  ADD UNIQUE KEY llm_connection_purpose (purpose);
