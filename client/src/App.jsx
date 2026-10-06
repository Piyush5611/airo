import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { clientNav, platformNav, Shell } from './shell.jsx';
import { Login, ResetPassword } from './pages/Login.jsx';
import { Privacy } from './pages/Privacy.jsx';
import { CommandCenter, Insights } from './pages/Command.jsx';
import { CampaignDetail, Campaigns, LeadDetail, Leads, Sources } from './pages/Growth.jsx';
import { Activities, CallDetail, Calls, Opportunity, Pipeline } from './pages/Sales.jsx';
import { Analytics, Reports, ReportView } from './pages/Intel.jsx';
import { ConnectionDetail, Connections } from './pages/Connections.jsx';
import { AdsAgent } from './pages/AdsAgent.jsx';
import { Offerings } from './pages/Offerings.jsx';
import { Assistant, Monitoring, Recommendations } from './pages/Ai.jsx';
import { AssistantPage } from './pages/AssistantChat.jsx';
import { Settings, Team } from './pages/Workspace.jsx';
import {
  OrganizationDetail, Organizations, PlatformAi, PlatformAnalytics, PlatformFinance, PlatformHome,
  PlatformIntegrations, PlatformModeration, PlatformSales, PlatformSecurity, PlatformSettings,
  PlatformSupport, PlatformUsers
} from './pages/Platform.jsx';
import { PlatformWhatsapp, WorkspaceWhatsapp } from './pages/Whatsapp.jsx';

function Loading() {
  return <div className="content"><div className="skeleton-block" aria-label="Loading AIRO" /></div>;
}

function Require({ realm, children }) {
  const { user, loading } = useAuth();
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
  );
}
