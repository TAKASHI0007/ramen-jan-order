const KEY = "orders-state";

async function loadState(env) {
  const raw = await env.ORDERS_KV.get(KEY);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return { seq: 0, orders: [] };
}
async function saveState(env, state) {
  await env.ORDERS_KV.put(KEY, JSON.stringify(state));
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

async function handleOrdersApi(request, env) {
  if (request.method === "GET") {
    return json(await loadState(env));
  }
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid json" }, 400); }
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
      status: "new",          // new → cooking → cooked → served
      paid: false,
      paymentMethod: null,    // "cash-receipt" | "cash-no-receipt" | "card" | null
      cookedAt: null,
      servedAt: null,
      paidAt: null,
      archived: false,
      createdAt: Date.now(),
    };
    state.orders.push(order);
    await saveState(env, state);
    return json(order);
  }
  if (request.method === "PATCH") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "invalid json" }, 400); }
    if (typeof body.id !== "number") { return json({ error: "id is required" }, 400); }
    const state = await loadState(env);
    const order = state.orders.find((o) => o.id === body.id);
    if (!order) { return json({ error: "not found" }, 404); }
    if (body.status) {
      order.status = body.status;
      if (body.status === "cooked"  && !order.cookedAt) order.cookedAt = Date.now();
      if (body.status === "served"  && !order.servedAt) order.servedAt = Date.now();
    }
    // paymentMethod での会計（新方式）
    if ("paymentMethod" in body) {
      order.paymentMethod = body.paymentMethod;
      order.paid = !!body.paymentMethod;
      if (body.paymentMethod && !order.paidAt) order.paidAt = Date.now();
      if (!body.paymentMethod) { order.paidAt = null; }
    // 旧方式（paid boolean）との後方互換
    } else if (typeof body.paid === "boolean") {
      order.paid = body.paid;
      if (!body.paid) { order.paymentMethod = null; order.paidAt = null; }
      else if (body.paid && !order.paidAt) order.paidAt = Date.now();
    }
    if (typeof body.archived === "boolean") order.archived = body.archived;
    await saveState(env, state);
    return json(order);
  }
  if (request.method === "DELETE") {
    await saveState(env, { seq: 0, orders: [] });
    return json({ ok: true });
  }
  return json({ error: "method not allowed" }, 405);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/orders") return handleOrdersApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
