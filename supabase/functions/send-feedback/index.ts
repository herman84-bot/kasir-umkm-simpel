// Supabase Edge Function: send-feedback
// Receives bug reports and feature requests, stores in DB, sends email to admin.
//
// Deploy: supabase functions deploy send-feedback
// Env: RESEND_API_KEY (optional — without it, feedback still saves to DB)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { type, subject, message } = await req.json();

    // Validate input
    if (!type || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "type, subject, dan message wajib diisi." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["bug", "feature"].includes(type)) {
      return new Response(
        JSON.stringify({ error: "type harus 'bug' atau 'feature'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth: get user from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get store info
    const { data: store } = await supabase
      .from("stores")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();

    // Insert feedback
    const { error: insertError } = await supabase.from("feedback").insert({
      user_id: user.id,
      store_id: store?.id || null,
      type,
      subject,
      message,
      user_email: user.email || "",
      store_name: store?.name || "",
      app_version: "1.2.0",
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Gagal menyimpan feedback." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email notification via Resend (optional)
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try {
        const emoji = type === "bug" ? "🐛" : "💡";
        const typeLabel = type === "bug" ? "Lapor Bug" : "Saran Fitur";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Kasir UMKM Simpel <onboarding@resend.dev>",
            to: "sppgcurugsukabakti@gmail.com",  // Ganti ke tokocuandigital@gmail.com setelah verifikasi domain di Resend
            subject: `${emoji} ${typeLabel}: ${subject}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a;">${emoji} ${typeLabel}</h2>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                  <tr><td style="padding: 8px 12px; color: #666; font-weight: bold;">Tipe</td><td style="padding: 8px 12px;">${typeLabel}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #666; font-weight: bold;">Subjek</td><td style="padding: 8px 12px;">${subject}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #666; font-weight: bold;">Email</td><td style="padding: 8px 12px;">${user.email || "-"}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #666; font-weight: bold;">Toko</td><td style="padding: 8px 12px;">${store?.name || "-"}</td></tr>
                  <tr><td style="padding: 8px 12px; color: #666; font-weight: bold;">Versi</td><td style="padding: 8px 12px;">1.2.0</td></tr>
                </table>
                <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
                  <p style="color: #666; font-size: 12px; margin: 0 0 4px 0; font-weight: bold;">Pesan:</p>
                  <p style="margin: 0; white-space: pre-wrap;">${message}</p>
                </div>
              </div>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("Email send failed (non-critical):", emailErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "Feedback terkirim! Terima kasih." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Function error:", err);
    return new Response(
      JSON.stringify({ error: "Terjadi kesalahan. Coba lagi." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
