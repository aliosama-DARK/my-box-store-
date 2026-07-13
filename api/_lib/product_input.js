// التحقق من مدخلات المنتج في لوحة التحكم
const { cleanStr, toBool, slugify } = require("./util");

const STOCK = ["in_stock", "out_of_stock"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateProductBody(body, partial = false) {
  const errors = [], out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has("name")) {
    out.name = cleanStr(body.name, 150);
    if (!out.name || out.name.length < 2) errors.push("اسم المنتج مطلوب");
  }
  if (!partial || has("price")) {
    out.price = Number(body.price);
    if (!(out.price > 0)) errors.push("السعر يجب أن يكون أكبر من صفر");
  }
  if (has("sale_price")) {
    out.sale_price = body.sale_price === null || body.sale_price === "" ? null : Number(body.sale_price);
    if (out.sale_price !== null && !(out.sale_price > 0)) errors.push("سعر العرض غير صالح");
  }
  if (has("category_id")) {
    out.category_id = Number(body.category_id) || null;
  }
  if (has("short_description")) out.short_description = cleanStr(body.short_description, 300);
  if (has("full_description")) out.full_description = cleanStr(body.full_description, 3000);
  if (has("internal_notes")) out.internal_notes = cleanStr(body.internal_notes, 2000);
  if (has("offer_start_date")) {
    out.offer_start_date = cleanStr(body.offer_start_date, 10) || null;
    if (out.offer_start_date && !DATE_RE.test(out.offer_start_date)) errors.push("تاريخ بداية العرض غير صالح");
  }
  if (has("offer_end_date")) {
    out.offer_end_date = cleanStr(body.offer_end_date, 10) || null;
    if (out.offer_end_date && !DATE_RE.test(out.offer_end_date)) errors.push("تاريخ نهاية العرض غير صالح");
  }
  if (has("stock_status")) {
    if (!STOCK.includes(body.stock_status)) errors.push("حالة المخزون غير صالحة");
    else out.stock_status = body.stock_status;
  }
  if (has("quantity")) {
    out.quantity = body.quantity === null || body.quantity === "" ? null : Math.max(0, Math.floor(Number(body.quantity)));
    if (out.quantity !== null && Number.isNaN(out.quantity)) errors.push("الكمية غير صالحة");
  }
  if (has("images")) {
    const imgs = Array.isArray(body.images) ? body.images : [];
    out.images = imgs
      .map((s) => cleanStr(s, 500))
      .filter((s) => /^https?:\/\//.test(s) || /^images\/[\w\-./]+$/.test(s))
      .slice(0, 8);
  }
  if (has("specifications")) {
    const arr = Array.isArray(body.specifications) ? body.specifications : [];
    out.specifications = arr.slice(0, 20)
      .map((r) => [cleanStr(r && r[0], 60), cleanStr(r && r[1], 200)])
      .filter((r) => r[0]);
  }
  if (has("variations")) {
    const arr = Array.isArray(body.variations) ? body.variations : [];
    out.variations = arr.slice(0, 30).map((v) => cleanStr(v, 60)).filter(Boolean);
  }
  if (has("sizes")) {
    const arr = Array.isArray(body.sizes) ? body.sizes : [];
    out.sizes = arr.slice(0, 40).map((s) => ({
      name: cleanStr(s && s.name, 60),
      price_delta: Number(s && s.price_delta) || 0,
      available: !(s && s.available === false),
    })).filter((s) => s.name);
  }
  if (has("materials")) {
    const arr = Array.isArray(body.materials) ? body.materials : [];
    out.materials = arr.slice(0, 40).map((m) => ({
      name: cleanStr(m && m.name, 60),
      price_delta: Number(m && m.price_delta) || 0,
      available: !(m && m.available === false),
      desc: cleanStr(m && m.desc, 160),
    })).filter((m) => m.name);
  }
  if (has("bg_color")) {
    const c = cleanStr(body.bg_color, 30);
    out.bg_color = /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;
  }
  if (has("is_visible")) out.is_visible = toBool(body.is_visible);
  if (has("is_featured")) out.is_featured = toBool(body.is_featured);
  if (has("display_order")) out.display_order = Math.floor(Number(body.display_order)) || 0;

  if (out.name) out.slug = slugify(out.name);
  return { out, errors };
}

module.exports = { validateProductBody };
