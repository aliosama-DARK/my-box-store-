const { getSql, ensureSchema } = require("../_lib/db");
const { sendJSON } = require("../_lib/util");
const { publicProduct } = require("../_lib/serialize");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return sendJSON(res, 400, { error: "معرّف غير صالح" });
  try {
    await ensureSchema();
    const sql = getSql();
    const row = (await sql`
      SELECT p.*, c.key AS category_key, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ${id} AND p.is_visible = true`)[0];
    if (!row) return sendJSON(res, 404, { error: "المنتج غير موجود" });
    sendJSON(res, 200, { product: publicProduct(row) });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر تحميل المنتج" });
  }
};
