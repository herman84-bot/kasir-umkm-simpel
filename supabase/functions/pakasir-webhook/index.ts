// =====================================================================
// Pakasir Webhook → aktivasi langganan OTOMATIS
// Deploy:  supabase functions deploy pakasir-webhook --no-verify-jwt
// Secrets: supabase secrets set PAKASIR_API_KEY=xxx PAKASIR_SLUG=kasir-umkm-simpel
// Lalu set Webhook URL proyek Pakasir ke:
//   https://<project-ref>.supabase.co/functions/v1/pakasir-webhook
//
// Alur: Pakasir kirim POST {order_id, amount, status, ...} saat dana masuk.
// Fungsi ini memverifikasi ulang ke Pakasir Transaction Detail API (pakai
// API Key rahasia di server), lalu mengaktifkan premium_until/business_until.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAKASIR_API_KEY = Deno.env.get("PAKASIR_API_KEY")!;
const PAKASIR_SLUG = Deno.env.get("PAKASIR_SLUG") ?? "kasir-umkm-simpel";
const PAKASIR_BASE = "https://app.pakasir.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Tambah 30 hari dari titik terjauh antara sekarang dan masa aktif lama.
const extend30Days = (current: string | null): string => {
  const base = current && new Date(current) > new Date() ? new Date(current) : new Date();
  base.setDate(base.getDate() + 30);
  return base.toISOString();
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: { order_id?: string; amount?: number; status?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const { order_id, amount, status } = body;
  if (!order_id || !amount) return new Response("Missing fields", { status: 400 });
  if (status && status !== "completed") return new Response("Ignored (not completed)", { status: 200 });

  // 1) Cari order di sistem kita.
  const { data: order, error: oErr } = await admin
    .from("subscription_orders")
    .select("order_id, store_id, tier, amount, status")
    .eq("order_id", order_id)
    .maybeSingle();

  if (oErr) return new Response("DB error", { status: 500 });
  if (!order) return new Response("Order not found", { status: 404 });
  if (order.status === "completed") return new Response("Already completed", { status: 200 });
  if (Number(order.amount) !== Number(amount)) return new Response("Amount mismatch", { status: 400 });

  // 2) Verifikasi ulang ke Pakasir (sumber kebenaran) sebelum mengaktifkan.
  const detailUrl =
    `${PAKASIR_BASE}/api/transactiondetail?project=${PAKASIR_SLUG}` +
    `&amount=${order.amount}&order_id=${order_id}&api_key=${PAKASIR_API_KEY}`;
  const dRes = await fetch(detailUrl);
  if (!dRes.ok) return new Response("Verify failed", { status: 502 });
  const detail = await dRes.json();
  if (detail?.transaction?.status !== "completed") {
    return new Response("Not paid yet", { status: 409 });
  }

  // 3) Aktifkan langganan pada toko (penambat = toko ini, biasanya toko utama).
  const col = order.tier === "business" ? "business_until" : "premium_until";
  const { data: store, error: sErr } = await admin
    .from("stores")
    .select(`id, ${col}`)
    .eq("id", order.store_id)
    .single();
  if (sErr || !store) return new Response("Store not found", { status: 404 });

  const newExpiry = extend30Days((store as Record<string, string | null>)[col]);
  const { error: uErr } = await admin
    .from("stores")
    .update({ [col]: newExpiry })
    .eq("id", order.store_id);
  if (uErr) return new Response("Activation failed", { status: 500 });

  // 4) Tandai order selesai.
  await admin
    .from("subscription_orders")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("order_id", order_id);

  return new Response(JSON.stringify({ ok: true, [col]: newExpiry }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
