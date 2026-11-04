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
      "user_credit_accounts", "user_credit_transactions", "wallet_payments",
    ] as const;
    const counts = await Promise.all(tables.map(async (table) => {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) throw error;
      return [table, count ?? 0] as const;
    }));
    const [usersResult, runsResult, auditResult, settingsResult] = await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 100 }),
      supabase.from("scraping_runs").select("id,user_id,domain,status,total_emails,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("admin_audit_log").select("id,actor_id,target_user_id,action,details,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("system_settings").select("allow_signups,maintenance_mode,max_domains_per_run,daily_free_credits,web_search_enabled,updated_at").eq("id", 1).single(),
    ]);
    if (usersResult.error || runsResult.error || auditResult.error || settingsResult.error) throw new Error("Could not load admin overview.");
    const userIds = usersResult.data.users.map((user) => user.id);
    const [rolesResult, creditAccountsResult] = userIds.length
      ? await Promise.all([
          supabase.from("user_roles").select("user_id,role").in("user_id", userIds),
          supabase.from("user_credit_accounts").select("user_id,daily_remaining,purchased_credits,daily_reset_date").in("user_id", userIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (rolesResult.error || creditAccountsResult.error) throw new Error("Could not load user balances.");

    return response({
      counts: Object.fromEntries(counts),
      users: usersResult.data.users.map((user) => ({
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        roles: (rolesResult.data ?? []).filter((role) => role.user_id === user.id).map((role) => role.role),
        credit_balance: (creditAccountsResult.data ?? []).find((account) => account.user_id === user.id) ?? null,
      })),
      recent_runs: runsResult.data,
      audit_log: auditResult.data,
      system_settings: settingsResult.data,
    });
  } catch (error) {
    console.error("Admin console request failed:", error);
    return response({ error: "Admin request failed. Check the function logs." }, 500);
  }
});