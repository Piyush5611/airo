ALTER TABLE ad_metrics_daily
  ADD COLUMN campaign_external_id VARCHAR(80) NULL AFTER name,
  ADD COLUMN adset_external_id VARCHAR(80) NULL AFTER campaign_external_id,
  ADD KEY idx_ad_metric_adset (organization_id, level, adset_external_id, metric_date);
