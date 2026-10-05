CREATE TABLE IF NOT EXISTS ads_agent_settings (
  organization_id BIGINT UNSIGNED PRIMARY KEY,
  mode ENUM('off', 'recommend', 'approve', 'auto') NOT NULL DEFAULT 'recommend',
  daily_spend_cap DECIMAL(14, 2) NULL,
  monthly_spend_cap DECIMAL(14, 2) NULL,
  max_budget_change_pct TINYINT UNSIGNED NOT NULL DEFAULT 20,
  max_actions_per_day TINYINT UNSIGNED NOT NULL DEFAULT 5,
  min_spend_for_decision DECIMAL(14, 2) NOT NULL DEFAULT 500,
  kill_switch TINYINT(1) NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_settings_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ad_metrics_daily (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  connection_id BIGINT UNSIGNED NOT NULL,
  platform ENUM('meta', 'google') NOT NULL,
  level ENUM('campaign', 'adset', 'ad') NOT NULL,
  external_id VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  metric_date DATE NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT '',
  spend DECIMAL(14, 2) NOT NULL DEFAULT 0,
  impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
  leads DECIMAL(12, 2) NULL,
  conversions DECIMAL(12, 2) NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ad_metric (connection_id, level, external_id, metric_date),
  KEY idx_ad_metric_org_date (organization_id, metric_date),
  CONSTRAINT fk_ad_metric_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_metric_conn FOREIGN KEY (connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_decisions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  connection_id BIGINT UNSIGNED NULL,
  platform VARCHAR(16) NULL,
  decision_type VARCHAR(40) NOT NULL,
  target_level VARCHAR(16) NULL,
  target_external_id VARCHAR(80) NULL,
  target_name VARCHAR(180) NULL,
  reason VARCHAR(600) NOT NULL,
  evidence JSON NULL,
  proposed_change JSON NULL,
  guardrail JSON NULL,
  mode VARCHAR(16) NOT NULL,
  status ENUM('proposed', 'approved', 'applied', 'rejected', 'blocked', 'failed') NOT NULL DEFAULT 'proposed',
  error VARCHAR(300) NULL,
  outcome JSON NULL,
  decided_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_decision_org (organization_id, status, created_at),
  CONSTRAINT fk_decision_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_jobs (
  job_key VARCHAR(60) PRIMARY KEY,
  locked_until DATETIME NULL,
  last_started_at DATETIME NULL,
  last_finished_at DATETIME NULL,
  last_status VARCHAR(16) NULL,
  last_summary VARCHAR(300) NULL,
  last_error VARCHAR(300) NULL
) ENGINE=InnoDB;
