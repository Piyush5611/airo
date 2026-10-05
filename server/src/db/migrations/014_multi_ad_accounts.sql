ALTER TABLE integration_connections
  ADD KEY idx_conn_org_provider (organization_id, provider_id),
  DROP INDEX uq_org_provider;
