import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { clientNav, platformNav, Shell } from './shell.jsx';
import { Login, ResetPassword } from './pages/Login.jsx';

const pages = {
  privacy: () => import('./pages/Privacy.jsx'),
  command: () => import('./pages/Command.jsx'),
  growth: () => import('./pages/Growth.jsx'),
  sales: () => import('./pages/Sales.jsx'),
  intel: () => import('./pages/Intel.jsx'),
  connections: () => import('./pages/Connections.jsx'),
  adsAgent: () => import('./pages/AdsAgent.jsx'),
  offerings: () => import('./pages/Offerings.jsx'),
  competitors: () => import('./pages/Competitors.jsx'),
  ai: () => import('./pages/Ai.jsx'),
  assistant: () => import('./pages/AssistantChat.jsx'),
  workspace: () => import('./pages/Workspace.jsx'),
  platform: () => import('./pages/Platform.jsx'),
  whatsapp: () => import('./pages/Whatsapp.jsx')
};

const RELOAD_KEY = 'airo_chunk_reload';

function page(group, name) {
  return lazy(() => pages[group]()
    .then((module) => {
      sessionStorage.removeItem(RELOAD_KEY);
      return { default: module[name] };
    })
    .catch((error) => {
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    }));
}

export function preloadPages(realm) {
  const groups = realm === 'platform'
    ? ['platform', 'assistant', 'whatsapp']
    : ['command', 'growth', 'sales', 'intel', 'connections', 'adsAgent', 'offerings', 'competitors', 'ai', 'assistant', 'workspace', 'whatsapp'];
  for (const group of groups) pages[group]().catch(() => null);
}

const Privacy = page('privacy', 'Privacy');
const CommandCenter = page('command', 'CommandCenter');
const Insights = page('command', 'Insights');
const CampaignDetail = page('growth', 'CampaignDetail');
const Campaigns = page('growth', 'Campaigns');
const LeadDetail = page('growth', 'LeadDetail');
const Leads = page('growth', 'Leads');
const Sources = page('growth', 'Sources');
const Activities = page('sales', 'Activities');
const CallDetail = page('sales', 'CallDetail');
const Calls = page('sales', 'Calls');
const Opportunity = page('sales', 'Opportunity');
const Pipeline = page('sales', 'Pipeline');
const Analytics = page('intel', 'Analytics');
const Reports = page('intel', 'Reports');
const ReportView = page('intel', 'ReportView');
const ConnectionDetail = page('connections', 'ConnectionDetail');
const Connections = page('connections', 'Connections');
const AdsAgent = page('adsAgent', 'AdsAgent');
const Offerings = page('offerings', 'Offerings');
const Competitors = page('competitors', 'Competitors');
const Assistant = page('ai', 'Assistant');
const Monitoring = page('ai', 'Monitoring');
const Recommendations = page('ai', 'Recommendations');
const AssistantPage = page('assistant', 'AssistantPage');
const Settings = page('workspace', 'Settings');
const Team = page('workspace', 'Team');
const OrganizationDetail = page('platform', 'OrganizationDetail');
const Organizations = page('platform', 'Organizations');
const PlatformAi = page('platform', 'PlatformAi');
const PlatformAnalytics = page('platform', 'PlatformAnalytics');
const PlatformFinance = page('platform', 'PlatformFinance');
const PlatformHome = page('platform', 'PlatformHome');
const PlatformIntegrations = page('platform', 'PlatformIntegrations');
const PlatformModeration = page('platform', 'PlatformModeration');
const PlatformSales = page('platform', 'PlatformSales');
const PlatformSecurity = page('platform', 'PlatformSecurity');
const PlatformSettings = page('platform', 'PlatformSettings');
const PlatformSupport = page('platform', 'PlatformSupport');
const PlatformUsers = page('platform', 'PlatformUsers');
const PlatformWhatsapp = page('whatsapp', 'PlatformWhatsapp');
const WorkspaceWhatsapp = page('whatsapp', 'WorkspaceWhatsapp');

function Loading() {
  return <div className="content"><div className="skeleton-block" aria-label="Loading AIRO" /></div>;
}

function Require({ realm, children }) {
  const { user, loading } = useAuth();
  const userRealm = user?.realm;
  useEffect(() => {
    if (userRealm !== realm) return undefined;
    const idle = window.requestIdleCallback || ((run) => window.setTimeout(run, 1500));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const handle = idle(() => preloadPages(realm));
    return () => cancel(handle);
  }, [userRealm, realm]);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.realm !== realm) return <Navigate to={user.realm === 'platform' ? '/platform' : '/app'} replace />;
  return children;
}

function Guest({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to={user.realm === 'platform' ? '/platform' : '/app'} replace />;
  return children;
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Guest><Login /></Guest>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/app" element={<Require realm="client"><Shell kicker="Workspace" nav={clientNav} home="/app" /></Require>}>
          <Route index element={<CommandCenter />} />
          <Route path="insights" element={<Insights />} />
          <Route path="growth/campaigns" element={<Campaigns />} />
          <Route path="growth/campaigns/:id" element={<CampaignDetail />} />
          <Route path="growth/ads-agent" element={<AdsAgent />} />
          <Route path="growth/offerings" element={<Offerings />} />
          <Route path="growth/competitors" element={<Competitors />} />
          <Route path="growth/competitors/:id" element={<Competitors />} />
          <Route path="growth/sources" element={<Sources />} />
          <Route path="growth/leads" element={<Leads />} />
          <Route path="growth/leads/:id" element={<LeadDetail />} />
          <Route path="whatsapp" element={<WorkspaceWhatsapp />} />
          <Route path="sales/pipeline" element={<Pipeline />} />
          <Route path="sales/pipeline/:id" element={<Opportunity />} />
          <Route path="sales/calls" element={<Calls />} />
          <Route path="sales/calls/:id" element={<CallDetail />} />
          <Route path="sales/activities" element={<Activities />} />
          <Route path="intelligence/reports" element={<Reports />} />
          <Route path="intelligence/reports/:slug" element={<ReportView />} />
          <Route path="intelligence/analytics" element={<Analytics />} />
          <Route path="connections" element={<Connections />} />
          <Route path="connections/:id" element={<ConnectionDetail />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="ai" element={<Assistant />} />
          <Route path="ai/recommendations" element={<Recommendations />} />
          <Route path="ai/monitoring" element={<Monitoring />} />
          <Route path="workspace/team" element={<Team />} />
          <Route path="workspace/settings" element={<Settings />} />
        </Route>
        <Route path="/platform" element={<Require realm="platform"><Shell kicker="Platform" nav={platformNav} home="/platform" /></Require>}>
          <Route index element={<PlatformHome />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="organizations/:id" element={<OrganizationDetail />} />
          <Route path="users" element={<PlatformUsers />} />
          <Route path="sales" element={<PlatformSales />} />
          <Route path="support" element={<PlatformSupport />} />
          <Route path="finance" element={<PlatformFinance />} />
          <Route path="moderation" element={<PlatformModeration />} />
          <Route path="analytics" element={<PlatformAnalytics />} />
          <Route path="integrations" element={<PlatformIntegrations />} />
          <Route path="whatsapp" element={<PlatformWhatsapp />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="ai" element={<PlatformAi />} />
          <Route path="security" element={<PlatformSecurity />} />
          <Route path="settings" element={<PlatformSettings />} />
        </Route>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
