import { useState } from "react";
import { Mail, Menu, X, LogOut, History, Search, Globe, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth";

export type View = "home" | "scrape" | "history" | "domains" | "login" | "signup" | "smtp";

interface HeaderProps {
  view: View;
  onNavigate: (v: View) => void;
}

export function Header({ view, onNavigate }: HeaderProps) {
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

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
            <nav className="hidden md:flex items-center gap-1">
              {navItem("Email Scraper", "scrape", <Mail size={16} />)}
              {navItem("Domain Scraping", "domains", <Globe size={16} />)}
              {navItem("History", "history", <History size={16} />)}
              {navItem("SMTP & Messages", "smtp", <Settings size={16} />)}
            </nav>
          ) : (
            <nav className="hidden md:flex items-center gap-1">
              {navItem("Home", "home", <Search size={16} />)}
            </nav>
          )}

          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-neutral-500 max-w-[180px] truncate">
                  {user.email}
                </span>
                <button
                  onClick={signOut}
                  className="flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </>
            ) : (
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

          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="md:hidden p-2 rounded-lg hover:bg-neutral-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-neutral-200/60 bg-white px-4 py-3 space-y-1 animate-slide-in">
          {user ? (
            <>
              {navItem("Email Scraper", "scrape", <Mail size={16} />)}
              {navItem("Domain Scraping", "domains", <Globe size={16} />)}
              {navItem("History", "history", <History size={16} />)}
              {navItem("SMTP & Messages", "smtp", <Settings size={16} />)}
            </>
          ) : (
            navItem("Home", "home", <Search size={16} />)
          )}
          <div className="pt-2 border-t border-neutral-100 flex flex-col gap-2">
            {user ? (
              <>
                <span className="text-sm text-neutral-500 px-3 py-1 truncate">{user.email}</span>
                <button
                  onClick={() => {
                    signOut();
                    setMobileOpen(false);
                  }}
                  className="flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </>
            ) : (
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
    </header>
  );
}
