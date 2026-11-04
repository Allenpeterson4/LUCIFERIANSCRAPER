import { ArrowRight, Compass, Globe, ListChecks, Mail, MapPin, MessageSquareText, Search, ShieldCheck, Target } from "lucide-react";
import type { View } from "@/components/Header";
import { useAuth } from "@/lib/auth";

export function AboutUsPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { user } = useAuth();
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">About MailHarvest</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold text-neutral-900">A focused workspace for contact discovery and delivery.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-neutral-600">MailHarvest brings domain discovery, email extraction, list management, message templates, and SMTP delivery into one organized workflow.</p>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          <section className="border border-neutral-200 bg-white rounded-lg p-5">
            <Compass size={21} className="text-primary-700" />
            <h2 className="mt-4 font-semibold">One clear workflow</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">Move from relevant websites to organized contacts, reviewable lists, and message campaigns without losing track of each step.</p>
          </section>
          <section className="border border-neutral-200 bg-white rounded-lg p-5">
            <ShieldCheck size={21} className="text-primary-700" />
            <h2 className="mt-4 font-semibold">Account-aware controls</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">Keep activity associated with your account, use suppression and bounce review tools, and pace delivery according to provider responses.</p>
          </section>
          <section className="border border-neutral-200 bg-white rounded-lg p-5">
            <Target size={21} className="text-primary-700" />
            <h2 className="mt-4 font-semibold">Built for practical work</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">Search for relevant sources, inspect results, and decide what to process before sending anything into the next stage.</p>
          </section>
        </div>
        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-neutral-200 pt-8">
          <div><h2 className="font-semibold">Explore the platform</h2><p className="mt-1 text-sm text-neutral-600">Start with a domain or review how we approach the work.</p></div>
          <div className="flex gap-2">
            <button onClick={() => onNavigate("mission")} className="px-4 py-2 border border-neutral-200 bg-white rounded-lg text-sm font-medium">Our mission</button>
            <button onClick={() => onNavigate(user ? "scrape" : "signup")} className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium">{user ? "Open platform" : "Get started"}<ArrowRight size={15} /></button>
          </div>
        </section>
      </main>
    </div>
  );
}

export function OurMissionPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { user } = useAuth();
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Our mission</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold text-neutral-900">Make contact workflows more deliberate, clear, and accountable.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-neutral-600">We aim to give teams the tools to find relevant business sources, organize contact data, and manage delivery with visibility into usage and provider limits.</p>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <section className="grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)] items-start">
          <div>
            <h2 className="text-xl font-semibold">How we put that into practice</h2>
            <div className="mt-5 divide-y divide-neutral-200 border-y border-neutral-200">
              <article className="py-4"><h3 className="font-medium">Relevance before extraction</h3><p className="mt-1 text-sm leading-relaxed text-neutral-600">Directory discovery checks page and URL signals before processing exhibitor, participant, vendor, seller, or distributor listings.</p></article>
              <article className="py-4"><h3 className="font-medium">Visibility before dispatch</h3><p className="mt-1 text-sm leading-relaxed text-neutral-600">Review audiences, saved templates, delivery history, and bounce entries as part of a managed process.</p></article>
              <article className="py-4"><h3 className="font-medium">Controls that scale</h3><p className="mt-1 text-sm leading-relaxed text-neutral-600">Daily credits, auditable top-ups, and adaptive SMTP pacing help make resource use and delivery behavior visible.</p></article>
            </div>
          </div>
          <aside className="border border-neutral-200 bg-white rounded-lg p-5">
            <ShieldCheck size={22} className="text-primary-700" />
            <h2 className="mt-3 font-semibold">Responsible use</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">Users are responsible for having an appropriate basis to collect and contact recipients and for following applicable privacy, anti-spam, and provider policies. Suppression and bounce controls should be honored.</p>
          </aside>
        </section>
        <button onClick={() => onNavigate(user ? "scrape" : "signup")} className="mt-10 inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium">{user ? "Explore MailHarvest" : "Create an account"}<ArrowRight size={15} /></button>
      </main>
    </div>
  );
}

export function OurServicesPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { user } = useAuth();
  const services = [
    { title: "Directory discovery", description: "Find exhibitor, participant, vendor, seller, supplier, and distributor listings from relevant trade-show and B2B websites.", icon: <Search size={20} />, view: "domains" as View },
    { title: "Email scraping", description: "Inspect one or more domains, extract reachable email addresses, and organize results with run history.", icon: <Globe size={20} />, view: "scrape" as View },
    { title: "Contact lists", description: "Review saved contacts, manage lists, and control suppression status before campaign use.", icon: <ListChecks size={20} />, view: "lists" as View },
    { title: "Message management", description: "Create plain-text or HTML templates, review delivery activity, and schedule campaigns through adaptive SMTP dispatch.", icon: <MessageSquareText size={20} />, view: "messages" as View },
    { title: "Maps search", description: "Find local businesses and move selected website domains into email scraping.", icon: <MapPin size={20} />, view: "maps" as View },
    { title: "SMTP settings", description: "Connect an outgoing mail provider and monitor delivery pacing and provider responses.", icon: <Mail size={20} />, view: "smtp" as View },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white"><div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Our services</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold text-neutral-900">Tools for each step of the contact workflow.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-neutral-600">Discover relevant sources, inspect domains, organize contacts, and manage delivery from one account.</p>
      </div></header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <article key={service.title} className="flex flex-col border border-neutral-200 bg-white rounded-lg p-5">
          <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-700">{service.icon}</span><h2 className="font-semibold">{service.title}</h2></div>
          <p className="mt-4 flex-1 text-sm leading-relaxed text-neutral-600">{service.description}</p>
          <button onClick={() => onNavigate(user ? service.view : "signup")} className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800">{user ? "Open tool" : "Get started"}<ArrowRight size={15} /></button>
        </article>)}</div>
      </main>
    </div>
  );
}

export function HowItWorksPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { user } = useAuth();
  const steps = [
    { number: "01", title: "Find a relevant source", description: "Search for business targets or enter a trade-show/B2B website. Directory pages are checked for matching URL and page-content signals before extraction." },
    { number: "02", title: "Review before processing", description: "Preview the discovered directory and listing count. Confirm before saving domain records, or choose individual search results to populate a scraper." },
    { number: "03", title: "Organize extracted contacts", description: "Scrape selected domains, review extracted addresses, and organize contact records into lists. The platform charges credits for domain and listing work." },
    { number: "04", title: "Prepare and dispatch messages", description: "Create a plain-text or HTML template, select an audience, and queue the campaign. SMTP pacing adapts to provider responses; one credit is used per send attempt." },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white"><div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">How it works</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold text-neutral-900">From source discovery to accountable delivery.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-neutral-600">Each step gives you a chance to review the input, understand the cost, and decide what happens next.</p>
      </div></header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ol className="border-y border-neutral-200 divide-y divide-neutral-200">{steps.map((step) => <li key={step.number} className="grid gap-3 py-6 sm:grid-cols-[72px_minmax(0,1fr)]">
          <span className="text-sm font-semibold text-primary-700">{step.number}</span>
          <div><h2 className="text-lg font-semibold">{step.title}</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-600">{step.description}</p></div>
        </li>)}</ol>
        <button onClick={() => onNavigate(user ? "scrape" : "signup")} className="mt-8 inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium">{user ? "Start with a domain" : "Create an account"}<ArrowRight size={15} /></button>
      </main>
    </div>
  );
}