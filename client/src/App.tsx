import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Spinner } from './components/ui';
import { missingEnv } from './lib/env';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import DashboardPage from './pages/DashboardPage';
import LandingPage from './pages/LandingPage';
import { ConfigMissingPage, NotFoundPage, UnauthorizedPage } from './pages/StatusPages';

// The call screen pulls in socket.io + WebRTC code, so load it only when needed.
const RoomPage = lazy(() => import('./pages/RoomPage'));
const CreateMeetingPage = lazy(() => import('./pages/CreateMeetingPage'));
const JoinMeetingPage = lazy(() => import('./pages/JoinMeetingPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export default function App() {
  if (missingEnv.length > 0) return <ConfigMissingPage />;
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/room/:code" element={<RoomPage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/meetings/new" element={<CreateMeetingPage />} />
            <Route path="/join" element={<JoinMeetingPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
