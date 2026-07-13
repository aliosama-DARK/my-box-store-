const { getSql, ensureSchema } = require("../_lib/db");
const { sendJSON } = require("../_lib/util");
const { publicProduct } = require("../_lib/serialize");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });
  try {
    await ensureSchema();
    const sql = getSql();
    const cat = String(req.query.cat || "");
    const offers = String(req.query.offers || "") === "1";
    const rows = await sql`
      SELECT p.*, c.key AS category_key, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_visible = true
      ORDER BY p.display_order ASC, p.id ASC`;
    let list = rows.map(publicProduct);
    if (cat && cat !== "all") list = list.filter((p) => p.category_key === cat);
    if (offers) list = list.filter((p) => p.offer_active);
    sendJSON(res, 200, { products: list });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر تحميل المنتجات" });
  }
};
