import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Card, EmptyState, Spinner } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { LoginPage, RecoverPage, RegisterPage, ResetPasswordPage } from '@/features/auth/AuthPages';
import { AuthProvider, RequireAuth, RequireGuest } from '@/features/auth/AuthProvider';
import { AiUsageSettingsPage } from '@/features/ai/AiUsagePage';
import { PlanSettingsPage } from '@/features/billing/PlanSettingsPage';
import { DriveSettingsPage } from '@/features/drive/DriveSettingsPage';
import { InvitationPage } from '@/features/invitations/InvitationPage';
import { BrandLayout, OrgLayout, RootRedirect } from '@/features/orgs/layouts';
import { OrgHomePage } from '@/features/orgs/OrgHomePage';
import {
  ActivitySettingsPage,
  GeneralSettingsPage,
  SettingsLayout,
  TeamSettingsPage,
} from '@/features/orgs/SettingsPages';
import { WelcomePage } from '@/features/orgs/WelcomePage';
import { ThemeProvider, useTheme } from '@/layout/theme';
import { supabaseConfigured } from '@/lib/supabase';

// Las pantallas grandes se cargan cuando se visitan.
const BrandHomePage = lazy(() => import('@/features/brand/BrandHomePage').then((m) => ({ default: m.BrandHomePage })));
const BrandProfilePage = lazy(() =>
  import('@/features/brand/BrandProfilePage').then((m) => ({ default: m.BrandProfilePage })),
);
const BrandWizardPage = lazy(() =>
  import('@/features/brand/BrandWizardPage').then((m) => ({ default: m.BrandWizardPage })),
);
const ContentListPage = lazy(() =>
  import('@/features/content/ContentListPage').then((m) => ({ default: m.ContentListPage })),
);
const ContentEditorPage = lazy(() =>
  import('@/features/content/ContentEditorPage').then((m) => ({ default: m.ContentEditorPage })),
);
const RequestListPage = lazy(() =>
  import('@/features/requests/RequestListPage').then((m) => ({ default: m.RequestListPage })),
);
const RequestDetailPage = lazy(() =>
  import('@/features/requests/RequestDetailPage').then((m) => ({ default: m.RequestDetailPage })),
);
const CalendarPage = lazy(() => import('@/features/social/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const CampaignListPage = lazy(() =>
  import('@/features/campaigns/CampaignListPage').then((m) => ({ default: m.CampaignListPage })),
);
const CampaignDetailPage = lazy(() =>
  import('@/features/campaigns/CampaignDetailPage').then((m) => ({ default: m.CampaignDetailPage })),
);
const AnalyticsPage = lazy(() =>
  import('@/features/analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const LibraryPage = lazy(() => import('@/features/library/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const ReelsPage = lazy(() => import('@/features/reels/ReelsPage').then((m) => ({ default: m.ReelsPage })));
const PlatformPage = lazy(() => import('@/features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })));
const BrandTeamPage = lazy(() => import('@/features/team/BrandTeamPage').then((m) => ({ default: m.BrandTeamPage })));
// RGPD: páginas legales públicas, «Mi cuenta» y los datos de la organización.
const LegalPage = lazy(() => import('@/features/legal/LegalPage').then((m) => ({ default: m.LegalPage })));
const AccountPage = lazy(() => import('@/features/privacy/AccountPage').then((m) => ({ default: m.AccountPage })));
const OrganizationDataPage = lazy(() =>
  import('@/features/privacy/OrganizationDataPage').then((m) => ({ default: m.OrganizationDataPage })),
);

function MissingConfig() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4" data-testid="missing-config">
      <Card className="max-w-lg">
        <EmptyState
          icon={Settings2}
          title={`Falta configurar ${APP_NAME}`}
          description="La aplicación no sabe a qué proyecto de Supabase conectarse. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (en .env.local o en las variables del despliegue) y vuelve a arrancarla."
        />
      </Card>
    </main>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

function ThemedToaster() {
  const { choice } = useTheme();
  return <Toaster position="top-center" richColors closeButton theme={choice} />;
}

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      }),
  );

  if (!supabaseConfigured) {
    return (
      <ThemeProvider>
        <MissingConfig />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<Spinner className="min-h-dvh" />}>
              <Routes>
                <Route element={<RequireGuest />}>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/registro" element={<RegisterPage />} />
                  <Route path="/recuperar" element={<RecoverPage />} />
                </Route>
                <Route path="/restablecer" element={<ResetPasswordPage />} />
                <Route path="/invitacion/:token" element={<InvitationPage />} />
                <Route path="/legal/:slug" element={<LegalPage />} />

                <Route element={<RequireAuth />}>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/bienvenida" element={<WelcomePage />} />
                  <Route path="/plataforma" element={<PlatformPage />} />
                  <Route path="/cuenta" element={<AccountPage />} />
                  <Route path="/o/:orgId" element={<OrgLayout />}>
                    <Route index element={<OrgHomePage />} />
                    <Route path="marcas/nueva" element={<BrandWizardPage />} />
                    <Route path="ajustes" element={<SettingsLayout />}>
                      <Route index element={<Navigate to="general" replace />} />
                      <Route path="general" element={<GeneralSettingsPage />} />
                      <Route path="equipo" element={<TeamSettingsPage />} />
                      <Route path="actividad" element={<ActivitySettingsPage />} />
                      <Route path="ia" element={<AiUsageSettingsPage />} />
                      <Route path="plan" element={<PlanSettingsPage />} />
                      <Route path="datos" element={<OrganizationDataPage />} />
                      <Route path="drive" element={<DriveSettingsPage />} />
                    </Route>
                    <Route path="m/:brandId" element={<BrandLayout />}>
                      <Route index element={<Navigate to="inicio" replace />} />
                      <Route path="inicio" element={<BrandHomePage />} />
                      <Route path="contenidos" element={<ContentListPage />} />
                      <Route path="contenidos/:contentId" element={<ContentEditorPage />} />
                      <Route path="encargos" element={<RequestListPage />} />
                      <Route path="encargos/:requestId" element={<RequestDetailPage />} />
                      <Route path="calendario" element={<CalendarPage />} />
                      {/* Sin IA de texto y fuera del modo agencia, la lista vuelve al inicio. */}
                      <Route path="campanas" element={<CampaignListPage />} />
                      <Route path="campanas/:campaignId" element={<CampaignDetailPage />} />
                      <Route path="analitica" element={<AnalyticsPage />} />
                      <Route path="biblioteca" element={<LibraryPage />} />
                      {/* Sin trabajador de medios desplegado, la pantalla vuelve a la biblioteca. */}
                      <Route path="biblioteca/reels" element={<ReelsPage />} />
                      <Route path="marca" element={<BrandProfilePage />} />
                      <Route path="equipo" element={<BrandTeamPage />} />
                    </Route>
                  </Route>
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <ThemedToaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
