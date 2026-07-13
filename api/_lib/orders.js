// أدوات مشتركة للطلبات في لوحة التحكم
const ORDER_STATUSES = [
  "new", "under_review", "awaiting_confirmation", "design_confirmed",
  "in_production", "ready", "shipped", "completed", "cancelled",
];
const FOLLOWING = ["under_review", "awaiting_confirmation", "design_confirmed", "in_production", "ready", "shipped"];

// يضيف ملخص المنتجات وعدد المرفقات وحقول توافقية للطلبات
async function attachSummary(sql, rows) {
  if (!rows || !rows.length) return;
  const ids = rows.map((r) => r.id);
  const items = await sql`SELECT order_id, product_name, quantity FROM order_items WHERE order_id = ANY(${ids})`;
  const atts = await sql`SELECT order_id, COUNT(*)::int AS c FROM order_attachments WHERE order_id = ANY(${ids}) GROUP BY order_id`;
  const byOrder = {}, attByOrder = {};
  items.forEach((it) => { (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it); });
  atts.forEach((a) => { attByOrder[a.order_id] = a.c; });
  rows.forEach((o) => {
    const list = byOrder[o.id] || [];
    o.products_summary = list.map((it) => `${it.product_name} × ${it.quantity}`).join("، ");
    o.images_count = attByOrder[o.id] || 0;
    o.total_price = Number(o.total);
    o.customer_notes = o.printing_instructions || o.customer_notes || "";
  });
}

module.exports = { ORDER_STATUSES, FOLLOWING, attachSummary };
