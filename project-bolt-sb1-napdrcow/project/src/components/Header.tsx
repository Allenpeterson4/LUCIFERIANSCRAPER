import { useEffect, useState } from "react";
import { Coins, Mail, Menu, X, LogOut, Search, Globe, Settings, Moon, Sun, Users, MapPin, FileText, UserRound, Info, Target, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { usePwaInstall } from "@/lib/use-pwa-install";

export type View = "home" | "about" | "mission" | "services" | "how-it-works" | "credits" | "settings" | "reset-password" | "scrape" | "domains" | "lists" | "messages" | "smtp" | "maps" | "login" | "signup";

interface HeaderProps {
  view: View;
  onNavigate: (v: View) => void;
}

export function Header({ view, onNavigate }: HeaderProps) {
  const { user, signOut } = useAuth();
  const { isInstalled, installApp } = usePwaInstall();
  const userId = user?.id;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [installHint, setInstallHint] = useState(false);
  const [creditBalance, setCreditBalance] = useState<{ daily_remaining: number; purchased_credits: number; subscription_remaining: number; total_remaining: number; resets_at: string } | null>(null);
  const [blackTheme, setBlackTheme] = useState(
    () => localStorage.getItem("mailharvest-theme") === "black"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("theme-black", blackTheme);
    localStorage.setItem("mailharvest-theme", blackTheme ? "black" : "light");
  }, [blackTheme]);

  useEffect(() => {
    if (!userId) {
      setCreditBalance(null);
      return;
    }
    let active = true;
    const loadCredits = async () => {
      const [balanceResult, subscriptionResult] = await Promise.all([
        supabase.rpc("get_my_credit_balance"),
        supabase.from("credit_subscriptions").select("credits_remaining")
          .lte("starts_at", new Date().toISOString()).gt("expires_at", new Date().toISOString()),
      ]);
      const result = Array.isArray(balanceResult.data) ? balanceResult.data[0] : balanceResult.data;
      if (active && result) {
        const subscriptionRemaining = (subscriptionResult.data ?? []).reduce((total, item) => total + Number(item.credits_remaining), 0);
        setCreditBalance({
          daily_remaining: Number(result.daily_remaining),
          purchased_credits: Number(result.purchased_credits),
          subscription_remaining: subscriptionRemaining,
          total_remaining: Number(result.total_remaining),
          resets_at: result.resets_at,
        });
      }
    };
    void loadCredits();
    const onCreditsUpdated = () => void loadCredits();
    window.addEventListener("credits-updated", onCreditsUpdated);
    const interval = window.setInterval(loadCredits, 30000);
    return () => {
      active = false;
      window.removeEventListener("credits-updated", onCreditsUpdated);
      window.clearInterval(interval);
    };
  }, [userId]);

  const themeToggle = (
    <button
      onClick={() => setBlackTheme((current) => !current)}
      className="p-2 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
      aria-label={`Switch to ${blackTheme ? "light" : "black"} theme`}
      title={`Switch to ${blackTheme ? "light" : "black"} theme`}
    >
      {blackTheme ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );

  const handleInstall = async () => {
    const result = await installApp();
    setInstallHint(result === "unavailable");
  };

  const navItem = (label: string, target: View, icon: React.ReactNode) => (
    <button
      onClick={() => {
        onNavigate(target);
        setMobileOpen(false);
      }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        view === target
          ? "text-primary-700 bg-primary-50"
          : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const showHeader = view !== "login" && view !== "signup";

  if (!showHeader) return null;

  return (
    <header className="sticky top-0 z-40 glass border-b border-neutral-200/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <button
            onClick={() => onNavigate(user ? "scrape" : "home")}
            className="flex items-center gap-2 group"
          >
            <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center group-hover:bg-primary-700 transition-colors">
              <Mail className="text-white" size={18} />
            </div>
            <span className="font-bold text-lg tracking-tight">MailHarvest</span>
          </button>

              {user ? (
                <nav className="hidden xl:flex items-center gap-0.5 whitespace-nowrap">
                  {navItem("Maps", "maps", <MapPin size={15} />)}
                  {navItem("Domain Scraping", "domains", <Globe size={15} />)}
                  {navItem("Email Scraping", "scrape", <Mail size={15} />)}
                  {navItem("Email Lists", "lists", <Users size={15} />)}
                  {navItem("Messages", "messages", <FileText size={15} />)}
                  {navItem("SMTPs", "smtp", <Settings size={15} />)}
                  {navItem("Credit Balance", "credits", <Coins size={15} />)}
                </nav>
          ) : (
            <nav className="hidden md:flex items-center gap-1">
              {navItem("Home", "home", <Search size={16} />)}
              {navItem("About Us", "about", <Info size={16} />)}
              {navItem("Our Mission", "mission", <Target size={16} />)}
              {navItem("Our Services", "services", <Globe size={16} />)}
              {navItem("How It Works", "how-it-works", <FileText size={16} />)}
            </nav>
          )}

          <div className="hidden xl:flex items-center gap-3">
            {themeToggle}
            {!isInstalled && <button onClick={() => void handleInstall()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-700"><Download size={15} />Install App</button>}
            {!user && (
              <>
                <button
                  onClick={() => onNavigate("login")}
                  className="text-sm font-medium text-neutral-600 hover:text-neutral-900 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors"
                >
                  Sign in
                </button>
                <button
                  onClick={() => onNavigate("signup")}
                  className="text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg transition-colors"
                >
                  Get started
                </button>
              </>
            )}
          </div>

          {user && (
            <div className="relative">
              <button
                onClick={() => setProfileOpen((open) => !open)}
                className="p-2 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                aria-label="Account profile"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                title="Account profile"
              >
                <UserRound size={20} />
              </button>
              {profileOpen && (
                <div role="menu" className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
                  <p className="px-2 py-1 text-sm font-medium text-neutral-800 truncate">{String(user.user_metadata?.username ?? "Account")}</p>
                  <p className="px-2 py-1 text-xs text-neutral-500 break-all">{user.email}</p>
                  <button
                    role="menuitem"
                    onClick={() => { onNavigate("settings"); setProfileOpen(false); setMobileOpen(false); }}
                    className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-100"
                  >
                    <Settings size={16} />Settings
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      void signOut();
                      setProfileOpen(false);
                    }}
                    className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  >
                    <LogOut size={16} />
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="xl:hidden p-2 rounded-lg hover:bg-neutral-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="xl:hidden border-t border-neutral-200/60 bg-white px-4 py-3 space-y-1 animate-slide-in max-h-[calc(100vh-4rem)] overflow-y-auto">
          {user ? (
            <>
              {navItem("Maps", "maps", <MapPin size={16} />)}
              {navItem("Domain Scraping", "domains", <Globe size={16} />)}
              {navItem("Email Scraping", "scrape", <Mail size={16} />)}
              {navItem("Email Lists", "lists", <Users size={16} />)}
              {navItem("Messages", "messages", <FileText size={16} />)}
              {navItem("SMTPs", "smtp", <Settings size={16} />)}
              {navItem("Credit Balance", "credits", <Coins size={16} />)}
            </>
          ) : (
            <>
              {navItem("Home", "home", <Search size={16} />)}
              {navItem("About Us", "about", <Info size={16} />)}
              {navItem("Our Mission", "mission", <Target size={16} />)}
              {navItem("Our Services", "services", <Globe size={16} />)}
              {navItem("How It Works", "how-it-works", <FileText size={16} />)}
            </>
          )}
          <div className="px-3 py-1 flex items-center justify-between gap-3">
            {themeToggle}
            {user && creditBalance && <span title={`${creditBalance.daily_remaining.toLocaleString()} daily + ${creditBalance.subscription_remaining.toLocaleString()} subscription + ${creditBalance.purchased_credits.toLocaleString()} purchased. Resets ${new Date(creditBalance.resets_at).toLocaleString()}.`} className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600"><Coins size={14} className="text-primary-600" />{creditBalance.total_remaining.toLocaleString()} credits</span>}
          </div>
          <div className="pt-2 border-t border-neutral-100 flex flex-col gap-2">
            {!isInstalled && <button onClick={() => void handleInstall()} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700"><Download size={16} />Install App</button>}
            {installHint && <p role="status" className="px-3 text-xs text-neutral-500">Use your browser’s Install app or Add to Home Screen menu.</p>}
            {!user && (
              <>
                <button
                  onClick={() => {
                    onNavigate("login");
                    setMobileOpen(false);
                  }}
                  className="text-left text-sm font-medium text-neutral-600 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors"
                >
                  Sign in
                </button>
                <button
                  onClick={() => {
                    onNavigate("signup");
                    setMobileOpen(false);
                  }}
                  className="text-left text-sm font-medium text-white bg-primary-600 px-4 py-2 rounded-lg transition-colors"
                >
                  Get started
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {installHint && !mobileOpen && <p role="status" className="border-t border-neutral-100 px-6 py-2 text-right text-xs text-neutral-500">Use your browser's Install app or Add to Home Screen menu.</p>}
    </header>
  );
}
