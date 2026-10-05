CREATE TABLE IF NOT EXISTS call_team_heads (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  connection_id BIGINT UNSIGNED NOT NULL,
  head_employee_id VARCHAR(40) NOT NULL,
  head_name VARCHAR(160) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_call_head (connection_id, head_employee_id),
  CONSTRAINT fk_call_head_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_call_head_conn FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS call_team_members (
  connection_id BIGINT UNSIGNED NOT NULL,
  employee_id VARCHAR(40) NOT NULL,
  team_head_id BIGINT UNSIGNED NOT NULL,
  employee_name VARCHAR(160) NOT NULL,
  PRIMARY KEY (connection_id, employee_id),
  KEY idx_call_member_head (team_head_id),
  CONSTRAINT fk_call_member_head FOREIGN KEY (team_head_id) REFERENCES call_team_heads(id) ON DELETE CASCADE,
  CONSTRAINT fk_call_member_conn FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
) ENGINE=InnoDB;
