import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Header, type View } from "@/components/Header";
import { Landing } from "@/components/Landing";
import { ScrapeTool } from "@/components/ScrapeTool";
import { DomainScraping } from "@/components/DomainScraping";
import { LoginPage } from "@/components/LoginPage";
import { SignupPage } from "@/components/SignupPage";
import { SmtpSettingsPage } from "@/components/SmtpSettingsPage";
import { MessageManager } from "@/components/MessageManager";
import { EmailListsPage } from "@/components/EmailListsPage";
import { MapsScraperPage } from "@/components/MapsScraperPage";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AboutUsPage, HowItWorksPage, OurMissionPage, OurServicesPage } from "@/components/PublicInfoPages";
import { CreditWalletPage } from "@/components/CreditWalletPage";
import { AccountSettingsPage } from "@/components/AccountSettingsPage";
import { ResetPasswordPage } from "@/components/ResetPasswordPage";
import type { ScrapeCampaignBatch } from "@/lib/types";

const routeViews: Record<string, View> = {
  "/": "home",
  "/about": "about",
  "/our-mission": "mission",
  "/our-services": "services",
  "/how-it-works": "how-it-works",
  "/credits": "credits",
  "/settings": "settings",
  "/reset-password": "reset-password",
  "/scrape": "scrape",
  "/domain-scraping": "domains",
  "/email-lists": "lists",
  "/messages": "messages",
  "/smtp": "smtp",
  "/maps": "maps",
  "/login": "login",
  "/signup": "signup",
};

const viewPaths: Partial<Record<View, string>> = Object.fromEntries(
  Object.entries(routeViews).map(([path, view]) => [view, path])
);

function initialView(): View {
  if (new URLSearchParams(window.location.search).has("wallet_reference")) return "credits";
  return routeViews[window.location.pathname] ?? "home";
}

function AppContent() {
  const { user, loading, justSignedUp, clearJustSignedUp, signOut } = useAuth();
  const [view, setView] = useState<View>(initialView);
  const [adminRoute, setAdminRoute] = useState(() => window.location.pathname === "/admin" || window.location.pathname === "/admin/login");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [pendingDomains, setPendingDomains] = useState<string[]>([]);
  const [pendingCampaign, setPendingCampaign] = useState<ScrapeCampaignBatch | null>(null);

  const redirectFromAdminRoute = useCallback(() => {
    window.history.replaceState(null, "", "/");
    setAdminRoute(false);
    setView(user ? "scrape" : "login");
  }, [user]);

  const refreshSystemSettings = useCallback(async () => {
    const { data } = await supabase.from("system_settings").select("maintenance_mode").eq("id", 1).maybeSingle();
    setMaintenanceMode(Boolean(data?.maintenance_mode));
  }, []);

  useEffect(() => {
    void refreshSystemSettings();
    window.addEventListener("system-settings-updated", refreshSystemSettings);
    return () => window.removeEventListener("system-settings-updated", refreshSystemSettings);
  }, [refreshSystemSettings]);

  useEffect(() => {
    if (loading) return;

    const syncAdminRoute = () => {
      const path = window.location.pathname;
      if (path === "/admin" || path === "/admin/login") {
        setAdminRoute(true);
        if (path === "/admin" && !user) window.history.replaceState(null, "", "/admin/login");
        return;
      }

      setAdminRoute(false);
      if (new URLSearchParams(window.location.search).has("wallet_reference")) {
        setView("credits");
        return;
      }
      const routedView = routeViews[path];
      if (routedView) {
        setView(routedView);
      } else if (path.startsWith("/admin/")) {
        window.history.replaceState(null, "", "/");
        setView(user ? "scrape" : "login");
      } else {
        window.history.replaceState(null, "", "/");
        setView("home");
      }
    };

    syncAdminRoute();
    window.addEventListener("popstate", syncAdminRoute);
    return () => window.removeEventListener("popstate", syncAdminRoute);
  }, [loading, user]);

  useEffect(() => {
    if (justSignedUp && user) {
      setView("scrape");
      window.history.replaceState(null, "", "/scrape");
      clearJustSignedUp();
    }
  }, [justSignedUp, user, clearJustSignedUp]);

  useEffect(() => {
    if (user && (view === "home" || view === "login" || view === "signup")) {
      setView("scrape");
      window.history.replaceState(null, "", "/scrape");
    }
    if (!user && !["home", "about", "mission", "services", "how-it-works", "login", "signup", "reset-password"].includes(view)) {
      setView("home");
      window.history.replaceState(null, "", "/");
    }
  }, [user, view]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Loader2 size={32} className="animate-spin text-primary-600" />
      </div>
    );
  }

  if (adminRoute) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <main>
          {user ? (
            <AdminDashboard onUnauthorized={redirectFromAdminRoute} />
          ) : (
            <LoginPage
              adminLogin
              onNavigate={(target) => {
                window.history.replaceState(null, "", "/");
                setAdminRoute(false);
                navigate(target);
              }}
            />
          )}
        </main>
      </div>
    );
  }

  if (maintenanceMode) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
        <section className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold">Temporarily unavailable</h1>
          <p className="mt-3 text-neutral-600">MailHarvest is in maintenance mode. Please try again later.</p>
          {user && (
            <button onClick={() => void signOut()} className="mt-5 text-sm font-medium text-primary-700 hover:underline">
              Sign out
            </button>
          )}
        </section>
      </main>
    );
  }

  const navigate = (v: View) => {
    if (!user && !["home", "about", "mission", "services", "how-it-works", "login", "signup"].includes(v)) {
      setView("home");
      return;
    }
    setView(v);
    window.history.pushState(null, "", viewPaths[v] ?? "/");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sendDomainsToScraper = (domains: string[]) => {
    setPendingDomains(domains);
    setView("scrape");
    window.history.pushState(null, "", "/scrape");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sendBatchToMessageManager = (batch: ScrapeCampaignBatch) => {
    setPendingCampaign(batch);
    setView("messages");
    window.history.pushState(null, "", "/messages");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isAuthPage = view === "login" || view === "signup" || view === "reset-password";

  const lockedView = (
    <div className="max-w-md mx-auto px-4 py-24 text-center animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center mx-auto mb-4">
        <Lock size={24} />
      </div>
      <h2 className="text-xl font-semibold mb-2">Sign in to continue</h2>
      <p className="text-neutral-500 text-sm">
        You need an account to use this feature and save your history.
      </p>
      <button
        onClick={() => navigate("login")}
        className="mt-5 inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
      >
        Go to sign in
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      {!isAuthPage && <Header view={view} onNavigate={navigate} />}
      <main>
        {view === "home" && !user && <Landing onNavigate={navigate} />}
        {view === "about" && <AboutUsPage onNavigate={navigate} />}
        {view === "mission" && <OurMissionPage onNavigate={navigate} />}
        {view === "services" && <OurServicesPage onNavigate={navigate} />}
        {view === "how-it-works" && <HowItWorksPage onNavigate={navigate} />}
        {view === "credits" && (user ? <CreditWalletPage /> : lockedView)}
        {view === "settings" && (user ? <AccountSettingsPage /> : lockedView)}
        {view === "login" && !user && <LoginPage onNavigate={navigate} />}
        {view === "signup" && !user && <SignupPage onNavigate={navigate} />}
        {view === "reset-password" && <ResetPasswordPage onNavigate={navigate} />}
        {view === "scrape" &&
          (user ? (
            <ScrapeTool
              pendingDomains={pendingDomains}
              onPendingConsumed={() => setPendingDomains([])}
              onSendCampaign={sendBatchToMessageManager}
            />
          ) : lockedView)}
        {view === "domains" &&
          (user ? (
            <DomainScraping onNavigate={navigate} onSendToScraper={sendDomainsToScraper} onSendCampaign={sendBatchToMessageManager} />
          ) : lockedView)}
        {view === "lists" && (user ? <EmailListsPage /> : lockedView)}
        {view === "messages" && (user ? <MessageManager initialBatch={pendingCampaign} onBatchConsumed={() => setPendingCampaign(null)} /> : lockedView)}
        {view === "smtp" && (user ? <SmtpSettingsPage /> : lockedView)}
        {view === "maps" && (user ? <MapsScraperPage onSendCampaign={sendBatchToMessageManager} /> : lockedView)}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
