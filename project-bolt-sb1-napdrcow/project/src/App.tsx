import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Header, type View } from "@/components/Header";
import { Landing } from "@/components/Landing";
import { ScrapeTool } from "@/components/ScrapeTool";
import { HistoryView } from "@/components/HistoryView";
import { DomainScraping } from "@/components/DomainScraping";
import { LoginPage } from "@/components/LoginPage";
import { SignupPage } from "@/components/SignupPage";
import { SmtpPage } from "@/components/SmtpPage";

function AppContent() {
  const { user, loading, justSignedUp, clearJustSignedUp } = useAuth();
  const [view, setView] = useState<View>("home");
  const [pendingDomains, setPendingDomains] = useState<string[]>([]);

  useEffect(() => {
    if (justSignedUp && user) {
      setView("scrape");
      clearJustSignedUp();
    }
  }, [justSignedUp, user, clearJustSignedUp]);

  useEffect(() => {
    if (user && (view === "home" || view === "login" || view === "signup")) {
      setView("scrape");
    }
    if (!user && (view === "scrape" || view === "history" || view === "domains" || view === "smtp")) {
      setView("home");
    }
  }, [user, view]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Loader2 size={32} className="animate-spin text-primary-600" />
      </div>
    );
  }

  const navigate = (v: View) => {
    if ((v === "scrape" || v === "history" || v === "domains" || v === "smtp") && !user) {
      setView("home");
      return;
    }
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sendDomainsToScraper = (domains: string[]) => {
    setPendingDomains(domains);
    setView("scrape");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isAuthPage = view === "login" || view === "signup";

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
        {view === "login" && !user && <LoginPage onNavigate={navigate} />}
        {view === "signup" && !user && <SignupPage onNavigate={navigate} />}
        {view === "scrape" &&
          (user ? (
            <ScrapeTool
              onNavigate={navigate}
              pendingDomains={pendingDomains}
              onPendingConsumed={() => setPendingDomains([])}
            />
          ) : lockedView)}
        {view === "domains" &&
          (user ? (
            <DomainScraping onNavigate={navigate} onSendToScraper={sendDomainsToScraper} />
          ) : lockedView)}
        {view === "history" &&
          (user ? <HistoryView onNavigate={navigate} /> : lockedView)}
        {view === "smtp" &&
          (user ? <SmtpPage onNavigate={navigate} /> : lockedView)}
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
