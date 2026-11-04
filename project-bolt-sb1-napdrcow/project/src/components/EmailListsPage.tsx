import { useCallback, useEffect, useState } from "react";
import { Download, FolderPlus, Loader2, Mail, Plus, Printer, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

interface Contact {
  id: string;
  email: string;
  domain: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_sent_at: string | null;
  suppressed_at: string | null;
}

interface EmailList {
  id: string;
  name: string;
  created_at: string;
}

const PAGE_SIZE = 50;

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function EmailListsPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<EmailList[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<"email" | "newest" | "oldest">("newest");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [newListName, setNewListName] = useState("");
  const [targetList, setTargetList] = useState("");
  const [notice, setNotice] = useState("");

  const makeQuery = useCallback(() => {
    let query = supabase.from("email_contacts").select(
      "id,email,domain,first_seen_at,last_seen_at,last_sent_at,suppressed_at",
      { count: "exact" }
    );
    if (search.trim()) query = query.or(`email.ilike.%${search.trim()}%,domain.ilike.%${search.trim()}%`);
    if (fromDate) query = query.gte("last_seen_at", new Date(`${fromDate}T00:00:00`).toISOString());
    if (toDate) query = query.lte("last_seen_at", new Date(`${toDate}T23:59:59.999`).toISOString());
    if (sort === "email") query = query.order("email", { ascending: true });
    else query = query.order("last_seen_at", { ascending: sort === "oldest" });
    return query;
  }, [search, fromDate, toDate, sort]);

  const loadLists = async () => {
    const { data } = await supabase.from("email_lists").select("id,name,created_at").order("name");
    setLists((data as EmailList[]) ?? []);
  };

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, count, error: loadError } = await makeQuery().range(
      page * PAGE_SIZE,
      (page + 1) * PAGE_SIZE - 1
    );
    if (loadError) setError(loadError.message);
    setContacts((data as Contact[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, makeQuery]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    void loadLists();
  }, []);

  const toggleContact = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = contacts.every((contact) => next.has(contact.id));
      contacts.forEach((contact) => allSelected ? next.delete(contact.id) : next.add(contact.id));
      return next;
    });
  };

  const createList = async () => {
    if (!user || !newListName.trim()) return;
    setBusy(true);
    setNotice("");
    const { data, error: createError } = await supabase
      .from("email_lists")
      .insert({ user_id: user.id, name: newListName.trim() })
      .select("id,name,created_at")
      .single();
    setBusy(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setLists((current) => [...current, data as EmailList].sort((a, b) => a.name.localeCompare(b.name)));
    setTargetList(data.id);
    setNewListName("");
    setNotice("List created.");
  };

  const addSelectedToList = async () => {
    if (!user || !targetList || selected.size === 0) return;
    setBusy(true);
    const rows = [...selected].map((contact_id) => ({ user_id: user.id, list_id: targetList, contact_id }));
    const { error: addError } = await supabase
      .from("email_list_contacts")
      .upsert(rows, { onConflict: "list_id,contact_id", ignoreDuplicates: true });
    setBusy(false);
    if (addError) setError(addError.message);
    else setNotice(`Added ${rows.length} contact${rows.length === 1 ? "" : "s"} to the list.`);
  };

  const exportRows = async () => {
    const rows: Contact[] = [];
    for (let offset = 0; offset < total; offset += 1000) {
      const { data, error: exportError } = await makeQuery().range(offset, offset + 999);
      if (exportError) throw exportError;
      rows.push(...((data as Contact[]) ?? []));
    }
    return rows;
  };

  const exportCsv = async () => {
    setBusy(true);
    setError("");
    try {
      const rows = await exportRows();
      const csv = [
        ["Email", "Domain", "First seen", "Last seen", "Last sent", "Suppressed"].map(escapeCsv).join(","),
        ...rows.map((contact) => [
          contact.email, contact.domain ?? "", contact.first_seen_at, contact.last_seen_at,
          contact.last_sent_at ?? "", contact.suppressed_at ?? "",
        ].map(escapeCsv).join(",")),
      ].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `mailharvest-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export contacts.");
    }
    setBusy(false);
  };

  const exportPdf = async () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Allow pop-ups to print this list as a PDF.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rows = await exportRows();
      printWindow.document.write(`<!doctype html><title>MailHarvest email list</title><style>body{font:12px Arial,sans-serif;color:#111;padding:24px}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{background:#f2f2f2}@media print{body{padding:0}}</style><h1>Email contacts (${rows.length})</h1><table><thead><tr><th>Email</th><th>Domain</th><th>Last seen</th></tr></thead><tbody>${rows.map((contact) => `<tr><td>${escapeHtml(contact.email)}</td><td>${escapeHtml(contact.domain ?? "")}</td><td>${escapeHtml(new Date(contact.last_seen_at).toLocaleString())}</td></tr>`).join("")}</tbody></table>`);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (exportError) {
      printWindow.close();
      setError(exportError instanceof Error ? exportError.message : "Could not prepare PDF export.");
    }
    setBusy(false);
  };

  const deleteList = async (id: string) => {
    const { error: deleteError } = await supabase.from("email_lists").delete().eq("id", id);
    if (deleteError) setError(deleteError.message);
    else setLists((current) => current.filter((list) => list.id !== id));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Email lists</h1>
          <p className="text-neutral-600">A searchable directory of {total.toLocaleString()} unique scraped contacts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCsv} disabled={busy || total === 0} className="inline-flex items-center gap-2 px-4 py-2.5 border border-neutral-200 bg-white rounded-lg text-sm font-medium disabled:opacity-50">
            <Download size={16} /> CSV
          </button>
          <button onClick={exportPdf} disabled={busy || total === 0} className="inline-flex items-center gap-2 px-4 py-2.5 border border-neutral-200 bg-white rounded-lg text-sm font-medium disabled:opacity-50">
            <Printer size={16} /> PDF
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 p-3 border border-red-300 bg-red-50 text-red-700 rounded-lg text-sm">{error}</p>}
      {notice && <p role="status" className="mb-4 p-3 border border-green-300 bg-green-50 text-green-800 rounded-lg text-sm">{notice}</p>}

      <section className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-3 mb-4">
            <label className="relative flex-1 min-w-56">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search email or domain" className="w-full pl-9 pr-3 py-2.5 border border-neutral-200 rounded-lg text-sm" />
            </label>
            <label className="text-xs text-neutral-500">From <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} className="block mt-1 px-2 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-800" /></label>
            <label className="text-xs text-neutral-500">Through <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} className="block mt-1 px-2 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-800" /></label>
            <label className="text-xs text-neutral-500">Sort
              <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(0); }} className="block mt-1 px-3 py-2 border border-neutral-200 rounded-lg bg-white text-sm text-neutral-800">
                <option value="newest">Recently scraped</option><option value="oldest">Oldest first</option><option value="email">A to Z</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-600"><input type="checkbox" checked={contacts.length > 0 && contacts.every((contact) => selected.has(contact.id))} onChange={selectVisible} /> Select page</label>
            <span className="text-sm text-neutral-500">{selected.size} selected</span>
          </div>

          <div className="overflow-x-auto border border-neutral-200 rounded-lg bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3 w-10"></th><th className="p-3">Email</th><th className="p-3">Domain</th><th className="p-3">Last scraped</th><th className="p-3">Delivery</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {loading ? <tr><td colSpan={5} className="p-10 text-center text-neutral-500"><Loader2 size={20} className="animate-spin mx-auto mb-2" />Loading contacts</td></tr>
                  : contacts.length === 0 ? <tr><td colSpan={5} className="p-10 text-center text-neutral-500">No contacts match these filters.</td></tr>
                  : contacts.map((contact) => <tr key={contact.id} className="hover:bg-neutral-50">
                    <td className="p-3"><input aria-label={`Select ${contact.email}`} type="checkbox" checked={selected.has(contact.id)} onChange={() => toggleContact(contact.id)} /></td>
                    <td className="p-3 font-mono text-neutral-800">{contact.email}</td>
                    <td className="p-3 text-neutral-600">{contact.domain ?? "-"}</td>
                    <td className="p-3 text-neutral-600 whitespace-nowrap">{new Date(contact.last_seen_at).toLocaleDateString()}</td>
                    <td className="p-3 text-xs">{contact.suppressed_at ? <span className="text-red-600">Suppressed</span> : contact.last_sent_at ? <span className="text-neutral-500">Previously sent</span> : <span className="text-green-700">Not sent</span>}</td>
                  </tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm text-neutral-500">
            <span>{total === 0 ? "0" : `${(page * PAGE_SIZE + 1).toLocaleString()}-${Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()}`} of {total.toLocaleString()}</span>
            <div className="flex gap-2"><button disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)} className="px-3 py-1.5 border border-neutral-200 rounded disabled:opacity-40">Previous</button><button disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((value) => value + 1)} className="px-3 py-1.5 border border-neutral-200 rounded disabled:opacity-40">Next</button></div>
          </div>
        </div>

        <aside className="border border-neutral-200 bg-white rounded-lg p-5">
          <h2 className="font-semibold flex items-center gap-2"><Mail size={17} /> Saved lists</h2>
          <p className="text-sm text-neutral-500 mt-1 mb-4">Save selected contacts into reusable lists.</p>
          <div className="flex gap-2 mb-3">
            <input value={newListName} onChange={(event) => setNewListName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void createList()} placeholder="New list name" className="min-w-0 flex-1 px-3 py-2 border border-neutral-200 rounded-lg text-sm" />
            <button onClick={createList} disabled={busy || !newListName.trim()} title="Create list" aria-label="Create list" className="p-2.5 bg-primary-600 text-white rounded-lg disabled:opacity-50"><Plus size={18} /></button>
          </div>
          <div className="flex gap-2 mb-5">
            <select value={targetList} onChange={(event) => setTargetList(event.target.value)} className="min-w-0 flex-1 px-3 py-2 border border-neutral-200 rounded-lg bg-white text-sm">
              <option value="">Choose a list</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
            <button onClick={addSelectedToList} disabled={busy || selected.size === 0 || !targetList} title="Add selected contacts" aria-label="Add selected contacts" className="p-2.5 border border-neutral-200 rounded-lg disabled:opacity-50"><FolderPlus size={18} /></button>
          </div>
          {busy && <p className="text-xs text-neutral-500 mb-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Working...</p>}
          <div className="divide-y divide-neutral-100">
            {lists.map((list) => <div key={list.id} className="py-3 flex items-center gap-2">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{list.name}</p><p className="text-xs text-neutral-400">Created {new Date(list.created_at).toLocaleDateString()}</p></div>
              <button onClick={() => void deleteList(list.id)} title={`Delete ${list.name}`} aria-label={`Delete ${list.name}`} className="p-2 text-neutral-400 hover:text-red-600"><Trash2 size={15} /></button>
            </div>)}
            {lists.length === 0 && <p className="py-3 text-sm text-neutral-400">No saved lists yet.</p>}
          </div>
        </aside>
      </section>
    </div>
  );
}