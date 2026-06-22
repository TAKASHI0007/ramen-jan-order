// Cloudflare Worker（静的ファイル配信 + 注文APIを1つにまとめたスクリプト）
// リポジトリのルート直下にこのまま "worker.js" として置いてください。

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

async function handleOrdersApi(request, env) {
  // GET /api/orders -> 全注文の取得
  if (request.method === "GET") {
    const state = await loadState(env);
    return json(state);
  }

  // POST /api/orders -> 新規注文の作成
  if (request.method === "POST") {
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
      items: body.items,    // {itemId, variantId, protein, spice, price, qty} の配列（言語非依存）
      notes: body.notes || "",
      total: body.total || 0,
      status: "new",         // new -> cooking -> served（調理の進み具合）
      paid: false,           // 会計は調理状況とは独立して管理
      servedAt: null,        // 提供完了になった時刻（提供までの時間の計測用）
      paidAt: null,          // 会計済みになった時刻（会計までの時間の計測用）
      archived: false,
      createdAt: Date.now(),
    };
    state.orders.push(order);
    await saveState(env, state);
    return json(order);
  }

  // PATCH /api/orders -> ステータス更新・会計・アーカイブ（互いに独立して更新可能）
  if (request.method === "PATCH") {
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
    if (body.status) {
      order.status = body.status;
      if (body.status === "served" && !order.servedAt) {
        order.servedAt = Date.now();
      }
    }
    if (typeof body.paid === "boolean") {
      order.paid = body.paid;
      if (body.paid && !order.paidAt) order.paidAt = Date.now();
      if (!body.paid) order.paidAt = null; // 取り消したら次回正しく計測できるようリセット
    }
    if (typeof body.archived === "boolean") order.archived = body.archived;
    await saveState(env, state);
    return json(order);
  }

  // DELETE /api/orders -> 全注文データの削除
  if (request.method === "DELETE") {
    await saveState(env, { seq: 0, orders: [] });
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/orders") {
      return handleOrdersApi(request, env);
    }

    // それ以外のリクエストは静的ファイル（public フォルダの中身）を返す
    return env.ASSETS.fetch(request);
  },
};
