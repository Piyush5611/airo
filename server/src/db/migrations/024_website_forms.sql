ALTER TABLE offerings
  ADD COLUMN form_token CHAR(64) NULL,
  ADD COLUMN form_leads INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN form_last_at DATETIME NULL,
  ADD UNIQUE KEY uq_offering_form_token (form_token);

ALTER TABLE ad_lead_imports
  ADD COLUMN channel VARCHAR(20) NOT NULL DEFAULT 'lead_form';
