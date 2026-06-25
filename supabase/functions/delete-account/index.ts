// =====================================================================
// Delete Account — Kasir UMKM Simpel
// Deploy:  supabase functions deploy delete-account --no-verify-jwt
// Alur:
//   1) Verifikasi JWT pengguna via supabase.auth.getUser()
//   2) Hapus baris admin_users (jika ada) — aman dari conflict FK
//   3) Hapus user dari auth.users → PostgreSQL CASCADE ke stores,
//      products, transactions, cashiers, debts, subscription_orders, dll
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

  // Verifikasi JWT: buat client user-scoped dan panggil getUser()
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user?.id) return new Response("Unauthorized", { status: 401 });

  const uid = user.id;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Hapus admin_users (jika ada) sebelum deleteUser agar FK tidak conflict
  await admin.from("admin_users").delete().eq("user_id", uid);

  // Hapus user dari auth → PostgreSQL CASCADE otomatis membersihkan semua tabel turunan
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) {
    if (deleteError.message?.toLowerCase().includes("not found")) {
      return new Response("User not found", { status: 403 });
    }
    return new Response("Delete failed: " + deleteError.message, { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
