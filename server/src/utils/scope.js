export function leadScope(auth) {
  if (auth.supportAccess || auth.role === 'owner' || auth.role === 'admin') {
    return { sql: '', params: [] };
  }
  const scope = auth.dataScopes?.leads || 'all';
  if (scope === 'assigned') {
    return { sql: ' AND l.assigned_user_id = ?', params: [auth.userId] };
  }
  if (scope === 'team') {
    return {
      sql: ` AND l.assigned_user_id IN (
        SELECT tm.user_id FROM team_members tm
        INNER JOIN team_members mine ON mine.team_id = tm.team_id AND mine.user_id = ?
      )`,
      params: [auth.userId]
    };
  }
  return { sql: '', params: [] };
}
