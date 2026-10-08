UPDATE competitors c
JOIN (
  SELECT organization_id, competitor_id, MAX(id) AS id
  FROM competitor_suggestions
  WHERE competitor_id IS NOT NULL
  GROUP BY organization_id, competitor_id
) latest ON latest.organization_id = c.organization_id AND latest.competitor_id = c.id
JOIN competitor_suggestions s ON s.id = latest.id AND s.organization_id = c.organization_id
SET c.competitor_type = COALESCE(c.competitor_type, CASE s.verdict WHEN 'direct' THEN 'direct' WHEN 'indirect' THEN 'indirect' ELSE NULL END),
    c.confidence = COALESCE(c.confidence, CASE s.verdict WHEN 'direct' THEN 70 WHEN 'indirect' THEN 55 ELSE 40 END),
    c.source = COALESCE(c.source, 'discovery'),
    c.reason = COALESCE(c.reason, LEFT(s.reason, 500));

UPDATE competitors SET source = 'manual' WHERE source IS NULL;
