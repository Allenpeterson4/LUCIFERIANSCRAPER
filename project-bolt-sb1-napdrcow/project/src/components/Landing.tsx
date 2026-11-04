import {
  Mail,
  Search,
  Layers,
  Shield,
  Zap,
  Globe,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { View } from "@/components/Header";

interface LandingProps {
  onNavigate: (v: View) => void;
}

export function Landing({ onNavigate }: LandingProps) {
  const { user } = useAuth();

  const startScraping = () => {
    if (user) {
      onNavigate("scrape");
    } else {
      onNavigate("signup");
    }
  };

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative overflow-hidden bg-grid">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-white/80 to-neutral-50 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 lg:pt-28 lg:pb-32">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary-50 border border-primary-100 text-primary-700 text-sm font-medium mb-6 animate-fade-up">
              <Sparkles size={15} />
              Intelligent email extraction at scale
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-balance mb-6 animate-fade-up">
              Find every email address
              <br />
              <span className="text-primary-600">behind any domain</span>
            </h1>
            <p className="text-lg text-neutral-600 max-w-2xl mx-auto mb-10 text-balance animate-fade-up">
              MailHarvest scans websites intelligently — crawling contact pages, about
              sections, and hidden links to surface every reachable email address. One
              domain or a hundred, your results are organized and ready.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up">
              <button
                onClick={startScraping}
                className="group flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium px-7 py-3.5 rounded-xl transition-all shadow-glow hover:scale-[1.02]"
              >
                <Search size={20} />
                Start scraping
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={() => document.getElementById("services")?.scrollIntoView({ behavior: "smooth" })}
                className="flex items-center gap-2 text-neutral-700 hover:text-neutral-950 font-medium px-7 py-3.5 rounded-xl border border-neutral-200 hover:border-neutral-300 bg-white transition-all"
              >
                Learn how it works
              </button>
            </div>
          </div>

          {/* Preview card */}
          <div className="mt-16 max-w-4xl mx-auto animate-fade-up">
            <div className="rounded-2xl border border-neutral-200 bg-white shadow-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100 bg-neutral-50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-neutral-300" />
                  <div className="w-3 h-3 rounded-full bg-neutral-300" />
                  <div className="w-3 h-3 rounded-full bg-neutral-300" />
                </div>
                <span className="ml-2 text-xs text-neutral-400 font-mono">mailharvest.app/scrape</span>
              </div>
              <div className="p-6 text-left">
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 px-4 py-3 rounded-lg bg-neutral-50 border border-neutral-200 font-mono text-sm text-neutral-700">
                    example.com
                  </div>
                  <div className="bg-primary-600 text-white px-5 py-3 rounded-lg text-sm font-medium flex items-center gap-2">
                    <Mail size={16} />
                    Extract
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {["hello@example.com", "support@example.com", "info@example.com", "contact@example.com"].map((e) => (
                    <div
                      key={e}
                      className="flex items-center gap-2 px-4 py-3 rounded-lg bg-accent-50 border border-accent-100 animate-fade-in"
                    >
                      <CheckCircle2 size={16} className="text-accent-600 shrink-0" />
                      <span className="font-mono text-sm text-neutral-800 truncate">{e}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-neutral-400">
                  <BarChart3 size={15} />
                  4 emails found across 3 pages
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { icon: <Globe size={22} />, value: "Any domain", label: "Input a website and go" },
            { icon: <Layers size={22} />, value: "Bulk mode", label: "Process hundreds at once" },
            { icon: <Zap size={22} />, value: "Fast", label: "Results in seconds" },
            { icon: <Shield size={22} />, value: "Private", label: "Your data, your account" },
          ].map((s, i) => (
            <div key={i} className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-50 text-primary-600 mb-3">
                {s.icon}
              </div>
              <div className="font-bold text-lg">{s.value}</div>
              <div className="text-sm text-neutral-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Services / How it works */}
      <section id="services" className="py-24 bg-neutral-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              How MailHarvest works
            </h2>
            <p className="text-neutral-600">
              Three straightforward steps from a domain to a clean list of contact emails.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Enter a domain",
                desc: "Type a single website or paste a list of domains for bulk processing. We normalize and validate each one.",
                icon: <Globe size={24} />,
              },
              {
                step: "02",
                title: "We crawl intelligently",
                desc: "Our engine fetches the homepage, then prioritizes contact, about, team, and staff pages to extract every email address.",
                icon: <Search size={24} />,
              },
              {
                step: "03",
                title: "Get organized results",
                desc: "Every scraped domain returns a clean list of emails, the number of pages scanned, and full history tied to your account.",
                icon: <Mail size={24} />,
              },
            ].map((s) => (
              <div
                key={s.step}
                className="relative bg-white rounded-2xl border border-neutral-200 p-7 hover:shadow-lg hover:border-primary-200 transition-all group"
              >
                <span className="absolute top-6 right-6 text-5xl font-bold text-neutral-100 group-hover:text-primary-100 transition-colors">
                  {s.step}
                </span>
                <div className="w-12 h-12 rounded-xl bg-primary-600 text-white flex items-center justify-center mb-5">
                  {s.icon}
                </div>
                <h3 className="text-xl font-semibold mb-2">{s.title}</h3>
                <p className="text-neutral-600 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Service details / Features */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Built for scale and clarity
            </h2>
            <p className="text-neutral-600">
              Everything you need to extract contact information efficiently, with a
              polished interface that keeps results organized.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: "Single domain scraping",
                desc: "Enter one domain and instantly see every email the site exposes — from the homepage to buried contact pages.",
                icon: <Search size={22} />,
              },
              {
                title: "Bulk domain processing",
                desc: "Paste multiple domains at once. Each is processed individually, and results are grouped by domain for easy review.",
                icon: <Layers size={22} />,
              },
              {
                title: "Smart page discovery",
                desc: "We automatically find and crawl the pages most likely to contain contact info — contact, about, team, legal, and more.",
                icon: <Globe size={22} />,
              },
              {
                title: "Scraping history",
                desc: "Every run is saved to your account. Revisit past results, check how many emails were found, and track your activity.",
                icon: <RefreshCw size={22} />,
              },
              {
                title: "Clean, organized output",
                desc: "No duplicates, no junk. Emails are deduplicated and presented in a clear, copyable format per domain.",
                icon: <CheckCircle2 size={22} />,
              },
              {
                title: "Account-secured",
                desc: "Your scraping history is tied to your private account. Sign in from anywhere and pick up where you left off.",
                icon: <Shield size={22} />,
              },
            ].map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-xl border border-neutral-200 hover:border-primary-200 hover:shadow-md transition-all"
              >
                <div className="w-11 h-11 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center mb-4">
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-neutral-600 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-neutral-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-3xl bg-primary-600 overflow-hidden p-10 sm:p-16 text-center">
            <div className="absolute top-0 right-0 w-72 h-72 bg-primary-400/30 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-800/40 rounded-full blur-3xl" />
            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                Ready to start scraping?
              </h2>
              <p className="text-primary-100 text-lg mb-8 max-w-xl mx-auto">
                Create a free account and extract emails from any domain in seconds. Your
                scraping history is saved automatically.
              </p>
              <button
                onClick={startScraping}
                className="inline-flex items-center gap-2 bg-white text-primary-700 hover:bg-primary-50 font-semibold px-8 py-4 rounded-xl transition-all hover:scale-[1.02] shadow-lg"
              >
                <Search size={20} />
                Begin scraping
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <Mail className="text-white" size={16} />
            </div>
            <span className="font-bold">MailHarvest</span>
          </div>
          <p className="text-sm text-neutral-400">
            Intelligent email scraping platform. Use responsibly and in compliance with
            applicable laws.
          </p>
        </div>
      </footer>

    </div>
  );
}
