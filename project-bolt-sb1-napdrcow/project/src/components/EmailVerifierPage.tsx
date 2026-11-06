import { useEffect, useState } from "react";
import { AlertCircle, BadgeCheck, FileUp, Loader2, ListFilter, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface SavedList {
  id: string;
  name: string;
}

interface VerificationResult {
  email: string;
  status: "syntax_valid" | "invalid" | "duplicate";
  reason: string | null;
}

interface VerificationResponse {
  results: VerificationResult[];
  summary: {
    totalProcessed: number;
    syntaxValidCount: number;
    invalidCount: number;
    duplicateCount: number;
  };
}

type InputMode = "manual" | "csv" | "list";

function splitCandidates(value: string) {
  return value.split(/[\r\n,;]+/)
    .map((candidate) => candidate.trim().replace(/^.*<([^<>]+)>.*$/, "$1").replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean);
}

export function EmailVerifierPage() {
  const [mode, setMode] = useState<InputMode>("manual");
  const [input, setInput] = useState("");
  const [lists, setLists] = useState<SavedList[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<VerificationResponse | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.from("email_lists").select("id,name").order("name").then(({ data, error: listError }) => {
      if (!active) return;
      if (listError) setError(listError.message);
      setLists((data as SavedList[]) ?? []);
    });
    return () => { active = false; };
  }, []);

  const uploadCsv = async (file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");
    setReport(null);
    try {
      setInput(await file.text());
      setNotice(`Loaded ${file.name}. Review the addresses before checking.`);
    } catch {
      setError("Could not read this file.");
    }
  };

  const loadList = async () => {
    if (!selectedList) return;
    setLoadingList(true);
    setError("");
    setNotice("");
    setReport(null);
    try {
      const contactIds: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error: relationError } = await supabase.from("email_list_contacts")
          .select("contact_id").eq("list_id", selectedList)
          .order("contact_id").range(offset, offset + 999);
        if (relationError) throw relationError;
        const batch = data ?? [];
        contactIds.push(...batch.map((row) => row.contact_id));
        if (batch.length < 1000) break;
      }

      const emails: string[] = [];
      for (let offset = 0; offset < contactIds.length; offset += 200) {
        const { data, error: contactsError } = await supabase.from("email_contacts").select("email")
          .in("id", contactIds.slice(offset, offset + 200));
        if (contactsError) throw contactsError;
        emails.push(...(data ?? []).map((contact) => contact.email));
      }
      setInput(emails.join("\n"));
      setNotice(`Loaded ${emails.length.toLocaleString()} addresses for review. The saved list was not changed.`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this list.");
    }
    setLoadingList(false);
  };

  const verify = async () => {
    const emails = splitCandidates(input);
    if (emails.length === 0) {
      setError("Add email addresses or load a CSV or saved list first.");
      return;
    }
    if (emails.length > 2000) {
      setError("Check up to 2,000 addresses at a time.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<VerificationResponse>("email-verifier", {
        body: { emails },
      });
      if (invokeError) throw invokeError;
      if (!data) throw new Error("The verifier returned no results.");
      setReport(data);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Could not check these addresses.");
    }
    setBusy(false);
  };

  const updateInput = (value: string) => {
    setInput(value);
    setReport(null);
    setError("");
    setNotice("");
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 animate-fade-in">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Contact quality</p>
          <h1 className="mb-2 text-3xl font-bold">Email Verifier</h1>
          <p className="max-w-2xl text-neutral-600">Review address formatting and duplicates without changing your saved contacts.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
          <ShieldCheck size={17} className="text-primary-700" /> Read-only review
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <div className="border-b border-neutral-200" role="tablist" aria-label="Address source">
            {([ ["manual", "Paste addresses"], ["csv", "Import CSV"], ["list", "Saved list"] ] as const).map(([target, label]) => (
              <button key={target} role="tab" aria-selected={mode === target} onClick={() => { setMode(target); setError(""); setNotice(""); }}
                className={`mr-4 border-b-2 px-1 py-3 text-sm font-medium ${mode === target ? "border-primary-600 text-primary-700" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
                {label}
              </button>
            ))}
          </div>

          {mode === "manual" && <label className="block text-sm font-medium">Email addresses<textarea value={input} onChange={(event) => updateInput(event.target.value)} rows={11} placeholder={"name@example.com\nsecond@example.org"} className="mt-2 w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-3 font-mono text-sm" /></label>}

          {mode === "csv" && <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 px-4 text-center hover:border-primary-400">
              <FileUp size={23} className="mb-2 text-primary-700" />
              <span className="text-sm font-medium">Choose a CSV file</span>
              <span className="mt-1 text-xs text-neutral-500">CSV text is read locally; review it before checking.</span>
              <input type="file" accept=".csv,text/csv" onChange={(event) => { void uploadCsv(event.target.files?.[0]); event.currentTarget.value = ""; }} className="sr-only" />
            </label>
            <label className="mt-4 block text-sm font-medium">Imported CSV contents<textarea value={input} onChange={(event) => updateInput(event.target.value)} rows={7} placeholder="Choose a CSV or paste CSV rows" className="mt-2 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2.5 font-mono text-sm" /></label>
          </section>}

          {mode === "list" && <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <label className="block text-sm font-medium">Saved email list<select value={selectedList} onChange={(event) => setSelectedList(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
              <option value="">Choose a list</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select></label>
            <button onClick={() => void loadList()} disabled={!selectedList || loadingList} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium disabled:opacity-50">
              {loadingList ? <Loader2 size={16} className="animate-spin" /> : <ListFilter size={16} />}Load list for review
            </button>
            <label className="mt-4 block text-sm font-medium">Loaded addresses<textarea value={input} onChange={(event) => updateInput(event.target.value)} rows={8} placeholder="Choose a saved list to load its addresses" className="mt-2 w-full resize-y rounded-lg border border-neutral-200 px-3 py-2.5 font-mono text-sm" /></label>
          </section>}

          {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

          <button onClick={() => void verify()} disabled={busy || loadingList || !input.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <BadgeCheck size={17} />}Check address format
          </button>
        </div>

        <aside className="h-fit rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-950">Scope of this check</h2>
          <p className="mt-2 text-sm text-amber-900">Results describe syntax and duplicates only. They do not confirm mailbox existence, delivery, consent, or campaign eligibility.</p>
          <p className="mt-3 text-sm text-amber-900">Use addresses only when you have permission to contact them. This review never changes saved lists or sends messages.</p>
        </aside>
      </section>

      {report && <section className="mt-8" aria-live="polite">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Processed", report.summary.totalProcessed], ["Syntax valid", report.summary.syntaxValidCount], ["Invalid format", report.summary.invalidCount], ["Duplicates", report.summary.duplicateCount]].map(([label, count]) => (
            <div key={label} className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs text-neutral-500">{label}</p><p className="mt-1 text-xl font-semibold">{Number(count).toLocaleString()}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3">Address</th><th className="p-3">Result</th><th className="p-3">Details</th></tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {report.results.map((result, index) => <tr key={`${result.email}-${index}`}>
                <td className="break-all p-3 font-mono text-xs">{result.email}</td>
                <td className={`whitespace-nowrap p-3 text-xs font-medium ${result.status === "syntax_valid" ? "text-green-700" : result.status === "duplicate" ? "text-amber-700" : "text-red-700"}`}>{result.status === "syntax_valid" ? "Syntax valid" : result.status === "duplicate" ? "Duplicate" : "Invalid format"}</td>
                <td className="p-3 text-xs text-neutral-500">{result.reason ?? "Address format accepted."}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}
