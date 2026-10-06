import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { inr, label, when } from '../format.js';
import { Badge, Page, State, Subnav, Table, useSection } from '../ui.jsx';
import { OrganizationForm } from './AccountSetup.jsx';

const TEAM_SECTIONS = ['Members', 'Teams', 'Invitations', 'Roles', 'Permissions', 'Data Scope', 'User Activity'];
const SETTING_SECTIONS = ['Organization', 'Workspace', 'Branding', 'Notifications', 'AI Settings', 'Integrations', 'Security', 'Billing', 'Audit Logs'];

export function Team() {
  const { data, loading, error, reload } = useResource('/api/team');
  const { can } = useAuth();
  const [form, setForm] = useState({ fullName: '', email: '', role: 'member', dataScope: 'assigned' });
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useSection(TEAM_SECTIONS);

  async function invite(event) {
    event.preventDefault();
    const result = await api.post('/api/team/invite', form);
    setNotice(result.developmentResetPath ? `Invited. Development reset: ${result.developmentResetPath}` : 'Invitation recorded.');
    reload();
  }

  return (
    <Page eyebrow="Workspace" title="Team" lede="Access is role, team, permissions, and data scope. There is no default Sales Manager role.">
      <Subnav items={TEAM_SECTIONS} value={tab} onChange={setTab} />
      <State loading={loading} error={error} onRetry={reload}>
        {data && (tab === 'Members' || tab === 'Invitations') ? (
          <div className="stack">
            <Table columns={[
              { key: 'fullName', label: 'Member' },
              { key: 'email', label: 'Email' },
              { key: 'roleName', label: 'Role' },
              { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }
            ]} rows={data.members} />
            {can('users.invite') ? (
              <form className="form-grid panel" onSubmit={invite}>
                <h2>Invite</h2>
                <input placeholder="Name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required />
                <input type="email" placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
                <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <select value={form.dataScope} onChange={(event) => setForm({ ...form, dataScope: event.target.value })} aria-label="Lead data scope">
                  <option value="all">All leads</option>
                  <option value="team">Team leads</option>
                  <option value="assigned">Assigned leads</option>
                </select>
                <button className="btn-primary" type="submit">Send invite</button>
                {notice ? <p>{notice}</p> : null}
              </form>
            ) : null}
          </div>
        ) : null}
        {data && tab === 'Teams' ? <Table columns={[{ key: 'name', label: 'Team' }, { key: 'description', label: 'Purpose' }, { key: 'memberNames', label: 'Members' }]} rows={data.teams} /> : null}
        {data && (tab === 'Roles' || tab === 'Permissions') ? (
          <div className="stack">{data.roles.map((role) => <article className="panel" key={role.roleKey}><header><h2>{role.name}</h2></header><p className="quiet">{role.permissions.join(' · ')}</p></article>)}</div>
        ) : null}
        {data && tab === 'Data Scope' ? <Table columns={[{ key: 'fullName', label: 'Member' }, { key: 'resourceName', label: 'Resource' }, { key: 'scopeType', label: 'Scope', render: (row) => label(row.scopeType) }]} rows={data.scopes} /> : null}
        {data && tab === 'User Activity' ? <ul className="alert-list">{data.activity.map((item, index) => <li key={index}><strong>{item.action}</strong><span>{item.actorName} · {when(item.createdAt)}</span></li>)}</ul> : null}
      </State>
    </Page>
  );
}

export function Settings() {
  const { data, loading, error, reload } = useResource('/api/settings');
  const audit = useResource('/api/audit');
  const { can, user, refreshUser } = useAuth();
  const [tab, setTab] = useSection(SETTING_SECTIONS);
  const [displayName, setDisplayName] = useState('');
  const [saved, setSaved] = useState('');

  async function save(event) {
    event.preventDefault();
    await api.patch('/api/settings', { key: 'branding', value: { ...(data.values.branding || {}), displayName } });
    setSaved('Branding saved.');
    reload();
  }

  return (
    <Page eyebrow="Workspace" title="Settings" lede="Organization, notifications, AI, security, and billing. Billing figures come from the subscription record.">
      <Subnav items={SETTING_SECTIONS} value={tab} onChange={setTab} />
      <State loading={loading} error={error} onRetry={reload}>
        {data && tab === 'Organization' ? (
          <OrganizationForm data={data} canEdit={can('settings.manage') && !user?.supportAccess} onSaved={() => { reload(); refreshUser(); }} />
        ) : null}
        {data && tab === 'Workspace' ? <section className="panel"><h2>{data.organization.name}</h2><p>{data.organization.city} · {label(data.organization.status)}</p><p className="quiet">{JSON.stringify(data.values.workspace || {})}</p></section> : null}
        {data && tab === 'Integrations' ? <p className="quiet">Provider connections live in Connections. Advertising and portals are not settings modules.</p> : null}
        {data && tab === 'Branding' ? (
          <form className="form-grid panel" onSubmit={save}>
            <label className="stack-field">Display name
              <input value={displayName || data.values.branding?.displayName || ''} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            {can('settings.manage') ? <button className="btn-primary" type="submit">Save</button> : <p className="quiet">You can view branding. Saving needs settings management.</p>}
            {saved ? <p>{saved}</p> : null}
          </form>
        ) : null}
        {data && tab === 'Notifications' ? <pre className="panel">{JSON.stringify(data.values.notifications, null, 2)}</pre> : null}
        {data && tab === 'AI Settings' ? <pre className="panel">{JSON.stringify(data.values.ai, null, 2)}</pre> : null}
        {data && tab === 'Security' ? <pre className="panel">{JSON.stringify(data.values.security, null, 2)}</pre> : null}
        {data && tab === 'Billing' ? (
          <section className="panel">
            <h2>{data.billing?.planName || 'No plan'}</h2>
            <p>{data.billing ? `${inr(data.billing.monthlyInr)} / month · ${label(data.billing.status)} · renews ${data.billing.periodEnd}` : ''}</p>
            <Table columns={[
              { key: 'invoiceNumber', label: 'Invoice' },
              { key: 'amountInr', label: 'Amount', render: (row) => inr(row.amountInr) },
              { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }
            ]} rows={data.invoices} />
          </section>
        ) : null}
        {tab === 'Audit Logs' ? (
          <State loading={audit.loading} error={audit.error} onRetry={audit.reload}>
            <ul className="alert-list">{(audit.data || []).map((item, index) => <li key={index}><strong>{item.action}</strong><span>{item.actorName} · {item.resourceName} · {when(item.createdAt)}</span></li>)}</ul>
          </State>
        ) : null}
      </State>
    </Page>
  );
}
