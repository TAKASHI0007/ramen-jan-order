// Cloudflare Pages Function
// このファイルが /api/orders へのリクエストを処理します。
// 「ORDERS_KV」という名前でKVネームスペースをこのPagesプロジェクトに
// バインドしてください（手順はREADME.mdを参照）。

const KEY = "orders-state";

async function loadState(env) {
  const raw = await env.ORDERS_KV.get(KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      // 壊れたデータの場合は初期化して続行
    }
  }
  return { seq: 0, orders: [] };
}

async function saveState(env, state) {
  await env.ORDERS_KV.put(KEY, JSON.stringify(state));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// GET /api/orders -> 全注文の取得（客側のステータス確認・スタッフ側の一覧表示の両方で使用）
export async function onRequestGet({ env }) {
  const state = await loadState(env);
  return json(state);
}

// POST /api/orders -> 新規注文の作成（客側の注文確定時）
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid json" }, 400);
  }
  if (!body.table || !Array.isArray(body.items) || body.items.length === 0) {
    return json({ error: "table and items are required" }, 400);
  }

  const state = await loadState(env);
  state.seq += 1;
  const order = {
    id: state.seq,
    table: body.table,
    items: body.items,
    notes: body.notes || "",
    total: body.total || 0,
    status: "new",
    archived: false,
    createdAt: Date.now(),
  };
  state.orders.push(order);
  await saveState(env, state);
  return json(order);
}

// PATCH /api/orders -> ステータス更新・アーカイブ（スタッフ側のボタン操作）
// body: { id, status? , archived? }
export async function onRequestPatch({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid json" }, 400);
  }
  if (typeof body.id !== "number") {
    return json({ error: "id is required" }, 400);
  }

  const state = await loadState(env);
  const order = state.orders.find((o) => o.id === body.id);
  if (!order) {
    return json({ error: "not found" }, 404);
  }
  if (body.status) order.status = body.status;
  if (typeof body.archived === "boolean") order.archived = body.archived;
  await saveState(env, state);
  return json(order);
}

// DELETE /api/orders -> 全注文データの削除（スタッフ側「全注文をクリア」ボタン）
export async function onRequestDelete({ env }) {
  await saveState(env, { seq: 0, orders: [] });
  return json({ ok: true });
}
