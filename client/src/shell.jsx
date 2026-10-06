import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { when } from './format.js';
import { providerLogo } from './providerLogos.js';
import { AccountSetup } from './pages/AccountSetup.jsx';

function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M6 26 L16 5 L26 26 H21.2 L16 14.2 L10.8 26 Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function NavIcon({ name }) {
  const paths = {
    Overview: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
    'AI insights': 'M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2z',
    Campaigns: 'M4 18V6h6v12M11 18V9h5v9M17 18V4h5v14',
    'Lead sources': 'M5 7h14M5 12h14M5 17h9',
    Leads: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M4 19c0-2.2 1.8-4 4-4s4 1.8 4 4M16 8h5M16 12h5M16 16h3',
    Pipeline: 'M4 6h6v4H4zM14 10h6v4h-6zM4 14h6v4H4z',
    Calls: 'M8 5h3l1 3-2 1a12 12 0 0 0 5 5l1-2 3 1v3a2 2 0 0 1-2 2A14 14 0 0 1 6 7a2 2 0 0 1 2-2z',
    Activities: 'M6 5h12v14H6zM9 9h6M9 13h6',
    Reports: 'M6 4h8l4 4v12H6zM14 4v4h4',
    Analytics: 'M5 19V10M10 19V5M15 19v-6M20 19V8',
    Connections: 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 12h2a4 4 0 1 1 0 8h-2',
    Assistant: 'M12 4 13.6 8.4 18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z',
    Recommendations: 'M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2zM6 18h12',
    Monitoring: 'M4 12a8 8 0 0 1 16 0M8 12a4 4 0 0 1 8 0M12 12h.01',
    'AI Monitoring': 'M4 12a8 8 0 0 1 16 0M8 12a4 4 0 0 1 8 0M12 12h.01',
    'AI Assistant': 'M12 4 13.6 8.4 18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z',
    'AI Recommendations': 'M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2zM6 18h12',
    'Platform Overview': 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
    'Platform Users & Access': 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3.5 19c.4-2.4 2.2-4 4.5-4s4.1 1.6 4.5 4M16 8h5M16 12h4',
    'Platform Sales': 'M4 16l4-5 3 3 5-7 4 4',
    'Customer Support': 'M5 12a7 7 0 0 1 14 0v4H5zM8 16v2h8v-2',
    'Finance & Billing': 'M5 7h14v10H5zM5 11h14',
    'Content & Moderation': 'M12 3 5 6v5c0 4.5 3 7 7 8 4-1 7-3.5 7-8V6z',
    'Platform Analytics': 'M5 19V10M10 19V5M15 19v-6M20 19V8',
    'Integrations & Technical': 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 12h2a4 4 0 1 1 0 8h-2',
    WhatsApp: 'M5 16.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H9l-4 3z',
    'WhatsApp Chatbot': 'M5 16.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H9l-4 3z',
    'Platform AI': 'M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2z',
    'Security & Audit': 'M12 3 5 6v5c0 4.5 3 7 7 8 4-1 7-3.5 7-8V6z',
    'Platform Settings': 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M12 3.5v2M12 18.5v2M4.8 6.2l1.4 1.4M17.8 16.4l1.4 1.4M3.5 12h2M18.5 12h2M4.8 17.8l1.4-1.4M17.8 7.6l1.4-1.4',
    Team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M3.5 19c.4-2.4 2.2-4 4.5-4s4.1 1.6 4.5 4M14 15.2c1.2-.4 2.4-.2 3.4.6 1 .8 1.6 2 1.8 3.2',
    Settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M12 3.5v2M12 18.5v2M4.8 6.2l1.4 1.4M17.8 16.4l1.4 1.4M3.5 12h2M18.5 12h2M4.8 17.8l1.4-1.4M17.8 7.6l1.4-1.4',
    Organizations: 'M4 20V6l8-3 8 3v14M9 20v-6h6v6',
    'Users & access': 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3.5 19c.4-2.4 2.2-4 4.5-4s4.1 1.6 4.5 4M16 8h5M16 12h4',
    Sales: 'M4 16l4-5 3 3 5-7 4 4',
    Support: 'M5 12a7 7 0 0 1 14 0v4H5zM8 16v2h8v-2',
    Finance: 'M5 7h14v10H5zM5 11h14',
    Moderation: 'M12 3 5 6v5c0 4.5 3 7 7 8 4-1 7-3.5 7-8V6z',
    Integrations: 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 12h2a4 4 0 1 1 0 8h-2',
    AI: 'M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2z',
    Security: 'M12 3 5 6v5c0 4.5 3 7 7 8 4-1 7-3.5 7-8V6z'
  };
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || 'M5 12h14'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function initials(name) {
  return String(name || 'A')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function Shell({ kicker, nav, home }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tools, setTools] = useState([]);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [notes, setNotes] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (user?.realm !== 'client') return undefined;
    let gone = false;
    function load() {
      api.get('/api/connections').then((data) => {
        if (!gone) setTools((data.connections || []).filter((item) => item.linked));
      }).catch(() => { if (!gone) setTools([]); });
    }
    load();
    window.addEventListener('airo:connections', load);
    return () => {
      gone = true;
      window.removeEventListener('airo:connections', load);
    };
  }, [user?.realm, user?.organization?.id, location.pathname]);

  const visible = nav.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => !item.permission || can(item.permission))
      .flatMap((item) => {
        if (item.to !== '/app/connections') return [item];
        return [
          { ...item, end: true },
          ...tools.map((tool) => ({
            to: `/app/connections/${tool.id}`,
            label: tools.filter((item) => item.providerKey === tool.providerKey).length > 1 && tool.accountLabel
              ? `${tool.name} · ${tool.accountLabel}`
              : tool.name,
            logo: providerLogo(tool.providerKey),
            nested: true,
            end: true
          }))
        ];
      })
  })).filter((group) => group.items.length);

  const commands = useMemo(() => visible.flatMap((group) => group.items.map((item) => ({
    label: item.label,
    detail: group.label,
    path: item.to
  }))), [visible]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === 'Escape') {
        setPalette(false);
        setNotes(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const path = user?.realm === 'platform' ? '/api/admin/search' : '/api/search';
    if (!palette || query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.get(`${path}?q=${encodeURIComponent(query)}`).then((data) => setResults(data.groups || [])).catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [palette, query, user?.realm]);

  async function loadNotes() {
    if (user?.realm !== 'client') return;
    const data = await api.get('/api/notifications');
    setNotifications(data);
    setNotes((value) => !value);
  }

  async function signOut() {
    const where = await logout();
    navigate(where === 'platform' ? '/platform' : '/login');
  }

  const filtered = commands.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  const unread = notifications.filter((item) => !item.readAt).length;

  return (
    <div className="shell">
      {open ? <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand">
          <Mark />
          <div className="brand-copy">
            <div className="brand-name">AIRO</div>
            <div className="brand-kicker">{kicker === 'Workspace' ? 'Intelligence Platform' : 'Platform'}</div>
          </div>
        </div>
        <div className="identity">
          <span className="org-mark" aria-hidden="true">{initials(user?.organization?.name || 'AI')}</span>
          <span>
            <strong>{user?.organization?.name || 'AIRO Internal'}</strong>
            <em>{user?.organization ? 'Workspace' : user?.roleName || 'Internal'}</em>
          </span>
        </div>
        <nav className="nav" aria-label="Primary">
          {visible.map((group) => (
            <div key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${item.nested ? 'is-nested' : ''} ${isActive ? 'is-active' : ''}`} onClick={() => setOpen(false)}>
                  {item.logo ? <img className="nav-logo" src={item.logo} alt="" /> : item.nested ? null : <NavIcon name={item.label} />}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="ask-chip" onClick={() => setPalette(true)}>
            <Mark />
            <span><strong>AIRO AI</strong><em>Ask anything...</em></span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="user-row">
            <span className="avatar" aria-hidden="true">{initials(user?.name)}</span>
            <span>
              <strong>{user?.name}</strong>
              <em>{user?.roleName || user?.role}</em>
            </span>
            <button className="btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        {user?.supportAccess ? (
          <div className="support-banner">
            <span>Read-only support access · {user.organization?.name}. Changes are blocked.</span>
            <button className="btn" onClick={signOut}>Leave support</button>
          </div>
        ) : null}
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}>☰</button>
          <button className="search-trigger" onClick={() => setPalette(true)}>
            <span className="search-copy">Search leads, campaigns, or ask AI...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="top-actions">
            <button className="btn-primary ask" aria-label="Ask AIRO" onClick={() => navigate(user?.realm === 'platform' ? '/platform/assistant' : '/app/assistant')}>Ask AI</button>
            {user?.realm === 'client' ? (
              <button className="icon-btn" aria-label="Notifications" onClick={loadNotes}>
                {unread ? <span className="dot" /> : null}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              </button>
            ) : null}
            <div className="profile-chip" title={user?.name}>
              <span className="avatar" aria-hidden="true">{initials(user?.name)}</span>
            </div>
          </div>
        </header>
        {notes ? (
          <div className="note-pop" role="dialog" aria-label="Notifications">
            <div className="row-actions" style={{ justifyContent: 'space-between', padding: '8px' }}>
              <strong>Notifications</strong>
              <button className="btn-ghost" onClick={() => api.post('/api/notifications/read-all').then(() => setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() }))))}>Mark read</button>
            </div>
            {notifications.length === 0 ? <p className="quiet" style={{ padding: 12 }}>Nothing needs attention.</p> : notifications.map((item) => (
              <article key={item.id}>
                <strong>{item.title}</strong>
                <p className="quiet">{item.body}</p>
                <div className="row-actions">
                  <span className="quiet">{when(item.createdAt)}</span>
                  {item.actionPath ? <button className="btn-ghost" onClick={() => { setNotes(false); navigate(item.actionPath); }}>Open</button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
        <main className="content">
          <Outlet />
        </main>
        <AccountSetup />
      </div>
      {palette ? (
        <div className="overlay" onClick={() => setPalette(false)}>
          <div className="palette" role="dialog" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
            <input autoFocus placeholder="Search or jump" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Command palette search" />
            <div className="palette-group">
              <p>Navigate</p>
              {filtered.slice(0, 8).map((item) => (
                <button key={item.path} onClick={() => { setPalette(false); navigate(item.path); }}>
                  {item.label} <span className="quiet">{item.detail}</span>
                </button>
              ))}
              <button onClick={() => { setPalette(false); navigate(home === '/platform' ? '/platform/assistant' : '/app/assistant'); }}>Ask AIRO</button>
              {results.map((group) => (
                <div key={group.label}>
                  <p>{group.label}</p>
                  {group.items.map((item) => (
                    <button key={`${group.label}-${item.id}`} onClick={() => { setPalette(false); navigate(item.path); }}>
                      {item.label} <span className="quiet">{item.detail}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const clientNav = [
  { label: 'Command center', items: [
    { to: '/app', label: 'Overview', end: true, permission: 'command.view' },
    { to: '/app/insights', label: 'AI insights', permission: 'ai.use' }
  ]},
  { label: 'Growth', items: [
    { to: '/app/growth/campaigns', label: 'Campaigns', permission: 'campaigns.view' },
    { to: '/app/growth/ads-agent', label: 'AI Ads Agent', permission: 'campaigns.view' },
    { to: '/app/growth/offerings', label: 'Products & Projects', permission: 'campaigns.view' },
    { to: '/app/growth/sources', label: 'Lead sources', permission: 'sources.view' },
    { to: '/app/growth/leads', label: 'Leads', permission: 'leads.view' },
    { to: '/app/whatsapp', label: 'WhatsApp', permission: 'leads.view' }
  ]},
  { label: 'Sales', items: [
    { to: '/app/sales/pipeline', label: 'Pipeline', permission: 'pipeline.view' },
    { to: '/app/sales/calls', label: 'Calls', permission: 'calls.view' },
    { to: '/app/sales/activities', label: 'Activities', permission: 'activities.view' }
  ]},
  { label: 'Intelligence', items: [
    { to: '/app/intelligence/reports', label: 'Reports', permission: 'reports.view' },
    { to: '/app/intelligence/analytics', label: 'Analytics', permission: 'analytics.view' }
  ]},
  { label: 'Integrations', items: [
    { to: '/app/connections', label: 'Connections', permission: 'connections.view' }
  ]},
  { label: 'AI Workspace', items: [
    { to: '/app/assistant', label: 'Assistant', end: true },
    { to: '/app/ai', label: 'AI Assistant', end: true, permission: 'ai.use' },
    { to: '/app/ai/recommendations', label: 'AI Recommendations', permission: 'ai.use' },
    { to: '/app/ai/monitoring', label: 'AI Monitoring', permission: 'ai.use' }
  ]},
  { label: 'Workspace', items: [
    { to: '/app/workspace/team', label: 'Team', permission: 'users.view' },
    { to: '/app/workspace/settings', label: 'Settings', permission: 'settings.view' }
  ]}
];

export const platformNav = [
  { label: 'Platform', items: [
    { to: '/platform/assistant', label: 'Assistant', end: true },
    { to: '/platform', label: 'Platform Overview', end: true, permission: 'platform.overview.view' },
    { to: '/platform/organizations', label: 'Organizations', permission: 'organizations.view' },
    { to: '/platform/users', label: 'Platform Users & Access', permission: 'platform_users.view' }
  ]},
  { label: 'Operations', items: [
    { to: '/platform/sales', label: 'Platform Sales', permission: 'platform_sales.view' },
    { to: '/platform/support', label: 'Customer Support', permission: 'support.view' },
    { to: '/platform/finance', label: 'Finance & Billing', permission: 'finance.view' },
    { to: '/platform/moderation', label: 'Content & Moderation', permission: 'moderation.view' }
  ]},
  { label: 'System', items: [
    { to: '/platform/analytics', label: 'Platform Analytics', permission: 'platform_analytics.view' },
    { to: '/platform/integrations', label: 'Integrations & Technical', permission: 'platform_integrations.view' },
    { to: '/platform/whatsapp', label: 'WhatsApp Chatbot', permission: 'whatsapp_bot.manage' },
    { to: '/platform/ai', label: 'Platform AI', permission: 'platform_ai.view' },
    { to: '/platform/security', label: 'Security & Audit', permission: 'security.view' },
    { to: '/platform/settings', label: 'Platform Settings', permission: 'platform_settings.view' }
  ]}
];
