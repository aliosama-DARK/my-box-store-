// قائمة الفئات المرئية للعامة (لأزرار الفلترة في المتجر)
const { getSql, ensureSchema } = require("../_lib/db");
const { sendJSON } = require("../_lib/util");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });
  try {
    await ensureSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT key, name, description, image, background_image
      FROM categories WHERE is_visible = true
      ORDER BY display_order ASC, id ASC`;
    sendJSON(res, 200, { categories: rows });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر تحميل الفئات" });
  }
};
