import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SEARCH_SECRET_NAMES = ["google_maps_api_key", "google_cse_api_key", "google_cse_id"] as const;

async function getSearchServiceStatus() {
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await serviceClient.from("search_service_secrets").select("name").in("name", [...SEARCH_SECRET_NAMES]);
  const configured = new Set((data ?? []).map((item) => item.name));
  const mapsEnvironment = Boolean(Deno.env.get("GOOGLE_MAPS_API_KEY"));
  const cseEnvironment = Boolean(Deno.env.get("GOOGLE_CSE_API_KEY"));
  const cseIdEnvironment = Boolean(Deno.env.get("GOOGLE_CSE_ID"));
  const mapsDatabase = configured.has("google_maps_api_key");
  const cseDatabase = configured.has("google_cse_api_key");
  const cseIdDatabase = configured.has("google_cse_id");
  return {
    google_maps_api_key: mapsDatabase || mapsEnvironment,
    google_cse_api_key: cseDatabase || cseEnvironment,
    google_cse_id: cseIdDatabase || cseIdEnvironment,
    google_maps_api_key_source: mapsDatabase ? "database" : mapsEnvironment ? "environment" : "none",
    google_cse_api_key_source: cseDatabase ? "database" : cseEnvironment ? "environment" : "none",
    google_cse_id_source: cseIdDatabase ? "database" : cseIdEnvironment ? "environment" : "none",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const authorization = req.headers.get("Authorization");
    if (!authorization) return response({ error: "Sign in to continue." }, 401);
    const { data: userData, error: authError } = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (authError || !userData.user) return response({ error: "Your session has expired." }, 401);
    const actorId = userData.user.id;
    const { data: adminRole } = await supabase.from("user_roles")
      .select("user_id").eq("user_id", actorId).eq("role", "admin").maybeSingle();
    if (!adminRole) return response({ error: "Administrator access is required." }, 403);

    const body = await req.json();
    if (body.action === "update_wallet_funding_settings") {
      const bankName = typeof body.bank_name === "string" ? body.bank_name.trim().slice(0, 100) : "";
      const accountNumber = typeof body.account_number === "string" ? body.account_number.replace(/\s+/g, "").slice(0, 34) : "";
      const accountName = typeof body.account_name === "string" ? body.account_name.trim().slice(0, 120) : "";
      if (!bankName || !accountNumber || !accountName || !/^[0-9]{6,34}$/.test(accountNumber)) {
        return response({ error: "Enter a bank name, valid account number, and account name." }, 400);
      }
      const { data: settings, error } = await supabase.from("wallet_funding_settings").upsert({
        id: 1, bank_name: bankName, account_number: accountNumber, account_name: accountName,
        updated_by: actorId, updated_at: new Date().toISOString(),
      }).select("bank_name,account_number,account_name,updated_at").single();
      if (error || !settings) return response({ error: "Could not save manual funding bank details." }, 500);
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        action: "update_wallet_funding_settings",
        details: { bank_name: bankName, account_number_last4: accountNumber.slice(-4) },
      });
      return response({ settings });
    }

    if (body.action === "manual_deposits") {
      const { data: deposits, error } = await supabase.from("wallet_payments")
        .select("reference,user_id,amount_minor,currency,credits,created_at,proof_path")
        .eq("gateway", "manual").eq("status", "pending")
        .order("created_at", { ascending: true }).limit(100);
      if (error) return response({ error: "Could not load manual deposits." }, 500);
      const results = await Promise.all((deposits ?? []).map(async (deposit) => {
        const [{ data: authUser }, proofResult] = await Promise.all([
          supabase.auth.admin.getUserById(deposit.user_id),
          deposit.proof_path
            ? supabase.storage.from("wallet-payment-proofs").createSignedUrl(deposit.proof_path, 600)
            : Promise.resolve({ data: null, error: null }),
        ]);
        return {
          ...deposit,
          user_email: authUser.user?.email ?? "Unknown account",
          proof_url: proofResult.data?.signedUrl ?? null,
        };
      }));
      return response({ deposits: results });
    }

    if (body.action === "review_manual_deposit") {
      const reference = typeof body.reference === "string" ? body.reference : "";
      const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : "";
      const reviewNote = typeof body.review_note === "string" ? body.review_note.trim().slice(0, 500) : "";
      if (!reference || !decision) return response({ error: "A payment reference and decision are required." }, 400);
      const { error } = await supabase.rpc("review_manual_wallet_payment", {
        p_reference: reference,
        p_admin_user_id: actorId,
        p_decision: decision,
        p_review_note: reviewNote || null,
      });
      if (error) return response({ error: "Could not review this manual payment. It may already be resolved." }, 409);
      const { data: payment } = await supabase.from("wallet_payments")
        .select("user_id,credits").eq("reference", reference).maybeSingle();
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        target_user_id: payment?.user_id ?? null,
        action: decision === "approve" ? "approve_manual_wallet_deposit" : "reject_manual_wallet_deposit",
        details: { reference, credits: payment?.credits ?? null, note: reviewNote || null },
      });
      return response({ success: true });
    }

    if (body.action === "update_settings") {
      const { allow_signups, maintenance_mode, max_domains_per_run, daily_free_credits, web_search_enabled } = body.settings ?? {};
      if (typeof allow_signups !== "boolean" || typeof maintenance_mode !== "boolean" ||
          !Number.isInteger(max_domains_per_run) || max_domains_per_run < 1 || max_domains_per_run > 5 ||
          !Number.isInteger(daily_free_credits) || daily_free_credits < 0 || daily_free_credits > 100000 ||
          typeof web_search_enabled !== "boolean") {
        return response({ error: "Invalid system settings." }, 400);
      }
      const { data: settings, error } = await supabase.from("system_settings")
        .update({ allow_signups, maintenance_mode, max_domains_per_run, daily_free_credits, web_search_enabled, updated_at: new Date().toISOString(), updated_by: actorId })
        .eq("id", 1)
        .select("allow_signups,maintenance_mode,max_domains_per_run,daily_free_credits,web_search_enabled,updated_at")
        .single();
      if (error || !settings) return response({ error: "Could not update system settings." }, 500);
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        action: "update_system_settings",
        details: { allow_signups, maintenance_mode, max_domains_per_run, daily_free_credits, web_search_enabled },
      });
      return response({ settings });
    }

    if (body.action === "update_search_keys") {
      const keys = body.keys && typeof body.keys === "object" ? body.keys as Record<string, unknown> : {};
      const clear = body.clear && typeof body.clear === "object" ? body.clear as Record<string, unknown> : {};
      let changed = 0;
      for (const name of SEARCH_SECRET_NAMES) {
        const value = typeof keys[name] === "string" ? (keys[name] as string).trim() : "";
        if (clear[name] === true) {
          const { error } = await supabase.from("search_service_secrets").delete().eq("name", name);
          if (error) return response({ error: "Could not update search provider settings." }, 500);
          changed += 1;
        } else if (value) {
          const { error } = await supabase.from("search_service_secrets").upsert({
            name,
            secret_value: value,
            updated_by: actorId,
            updated_at: new Date().toISOString(),
          });
          if (error) return response({ error: "Could not update search provider settings." }, 500);
          changed += 1;
        }
      }
      if (!changed) return response({ error: "Enter a key or choose a saved key to remove." }, 400);
      const searchServices = await getSearchServiceStatus();
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        action: "update_search_service_keys",
        details: { configured: searchServices },
      });
      return response({ search_services: searchServices });
    }

    if (body.action === "grant_credits") {
      const targetUserId = typeof body.user_id === "string" ? body.user_id : "";
      const amount = body.amount;
      if (!targetUserId || !Number.isInteger(amount) || amount < 1 || amount > 100000000) {
        return response({ error: "Provide a user and a valid credit amount." }, 400);
      }
      const { data: balance, error } = await supabase.rpc("grant_user_credits", {
        p_user_id: targetUserId,
        p_amount: amount,
        p_reason: "admin_credit_grant",
      });
      if (error) return response({ error: "Could not add credits to this account." }, 500);
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        target_user_id: targetUserId,
        action: "grant_credits",
        details: { amount },
      });
      return response({ balance });
    }

    if (body.action === "contacts") {
      const search = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";
      const page = Math.max(0, Math.min(10000, Number.isInteger(body.page) ? body.page : 0));
      let query = supabase.from("email_contacts")
        .select("id,user_id,email,domain,last_seen_at,last_sent_at,suppressed_at", { count: "exact" });
      if (search) query = query.ilike("email", `%${search.replace(/[%_,()]/g, "")}%`);
      const { data: contacts, count, error } = await query
        .order("last_seen_at", { ascending: false })
        .range(page * 50, page * 50 + 49);
      if (error) return response({ error: "Could not load contacts." }, 500);
      return response({ contacts, total: count ?? 0 });
    }

    if (body.action === "suppress_contact") {
      const contactId = typeof body.contact_id === "string" ? body.contact_id : "";
      if (!contactId) return response({ error: "A contact id is required." }, 400);
      const suppressed = body.suppressed !== false;
      const { data: contact, error } = await supabase.from("email_contacts")
        .update({ suppressed_at: suppressed ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("id", contactId)
        .select("id,user_id,email")
        .maybeSingle();
      if (error || !contact) return response({ error: "Could not update contact status." }, 404);
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        target_user_id: contact.user_id,
        action: suppressed ? "suppress_contact" : "unsuppress_contact",
        details: { contact_id: contact.id, email: contact.email },
      });
      return response({ success: true });
    }

    if (body.action === "set_role") {
      const targetUserId = typeof body.user_id === "string" ? body.user_id : "";
      const role = body.role === "admin" ? "admin" : body.role === "user" ? "user" : null;
      if (!targetUserId || !role) return response({ error: "A user id and valid role are required." }, 400);
      if (targetUserId === actorId && role !== "admin") return response({ error: "You cannot remove your own administrator role." }, 400);

      if (role === "admin") {
        const { error } = await supabase.from("user_roles").upsert({ user_id: targetUserId, role }, { onConflict: "user_id,role" });
        if (error) return response({ error: "Could not assign administrator role." }, 500);
      } else {
        const { count } = await supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
        const { data: targetRole } = await supabase.from("user_roles").select("user_id").eq("user_id", targetUserId).eq("role", "admin").maybeSingle();
        if (targetRole && (count ?? 0) <= 1) return response({ error: "The last administrator cannot be removed." }, 400);
        const { error } = await supabase.from("user_roles").delete().eq("user_id", targetUserId).eq("role", "admin");
        if (error) return response({ error: "Could not remove administrator role." }, 500);
      }

      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        target_user_id: targetUserId,
        action: role === "admin" ? "grant_admin" : "revoke_admin",
        details: { role },
      });
      return response({ success: true });
    }

    const tables = [
      "scraping_runs", "scrape_results", "domain_parsing_runs", "domain_parse_results",
      "email_contacts", "email_lists", "email_list_contacts", "email_delivery_log",
      "email_messages", "campaign_queue", "discovery_searches", "user_roles", "admin_audit_log",
      "user_credit_accounts", "user_credit_transactions", "wallet_payments", "credit_subscriptions",
    ] as const;
    const counts = await Promise.all(tables.map(async (table) => {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) throw error;
      return [table, count ?? 0] as const;
    }));
    const [usersResult, runsResult, auditResult, settingsResult, walletFundingResult] = await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 100 }),
      supabase.from("scraping_runs").select("id,user_id,domain,status,total_emails,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("admin_audit_log").select("id,actor_id,target_user_id,action,details,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("system_settings").select("allow_signups,maintenance_mode,max_domains_per_run,daily_free_credits,web_search_enabled,updated_at").eq("id", 1).single(),
      supabase.from("wallet_funding_settings").select("bank_name,account_number,account_name,updated_at").eq("id", 1).maybeSingle(),
    ]);
    if (usersResult.error || runsResult.error || auditResult.error || settingsResult.error || walletFundingResult.error) throw new Error("Could not load admin overview.");
    const userIds = usersResult.data.users.map((user) => user.id);
    const now = new Date().toISOString();
    const [rolesResult, creditAccountsResult, subscriptionsResult] = userIds.length
      ? await Promise.all([
          supabase.from("user_roles").select("user_id,role").in("user_id", userIds),
          supabase.from("user_credit_accounts").select("user_id,daily_remaining,purchased_credits,daily_reset_date").in("user_id", userIds),
          supabase.from("credit_subscriptions").select("user_id,credits_remaining,expires_at")
            .in("user_id", userIds).lte("starts_at", now).gt("expires_at", now),
        ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    if (rolesResult.error || creditAccountsResult.error || subscriptionsResult.error) throw new Error("Could not load user balances.");

    const searchServices = await getSearchServiceStatus();
    return response({
      counts: Object.fromEntries(counts),
      users: usersResult.data.users.map((user) => ({
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        roles: (rolesResult.data ?? []).filter((role) => role.user_id === user.id).map((role) => role.role),
        credit_balance: (() => {
          const account = (creditAccountsResult.data ?? []).find((item) => item.user_id === user.id);
          if (!account) return null;
          const subscriptions = (subscriptionsResult.data ?? []).filter((item) => item.user_id === user.id);
          return {
            ...account,
            subscription_remaining: subscriptions.reduce((total, item) => total + Number(item.credits_remaining), 0),
            subscription_expires_at: subscriptions[0]?.expires_at ?? null,
          };
        })(),
      })),
      recent_runs: runsResult.data,
      audit_log: auditResult.data,
      system_settings: settingsResult.data,
      wallet_funding_settings: walletFundingResult.data,
      search_services: searchServices,
    });
  } catch (error) {
    console.error("Admin console request failed:", error);
    return response({ error: "Admin request failed. Check the function logs." }, 500);
  }
});