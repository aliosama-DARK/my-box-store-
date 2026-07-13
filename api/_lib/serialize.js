// تحويل صفوف المنتجات إلى صيغة عامة/إدارية + منطق العروض
function num(v) { return v === null || v === undefined ? null : Number(v); }
function today() { return new Date().toISOString().slice(0, 10); }

function offerActive(p) {
  const price = num(p.price), sale = num(p.sale_price);
  if (!sale || sale <= 0 || !price || sale >= price) return false;
  const t = today();
  if (p.offer_start_date && String(p.offer_start_date).slice(0, 10) > t) return false;
  if (p.offer_end_date && String(p.offer_end_date).slice(0, 10) < t) return false;
  return true;
}
function discountPercent(p) {
  if (!offerActive(p)) return 0;
  return Math.round((1 - num(p.sale_price) / num(p.price)) * 100);
}
function isOrderable(p) {
  return !!p.is_visible && p.stock_status === "in_stock";
}
function availabilityLabel(p) {
  if (p.stock_status === "out_of_stock") return "نفدت الكمية";
  if (!p.is_visible) return "غير متوفر حاليًا";
  return "";
}
function asArray(v) { return Array.isArray(v) ? v : (v ? (typeof v === "string" ? safeJson(v) : v) : []); }
function safeJson(s) { try { return JSON.parse(s); } catch { return []; } }

function publicProduct(p) {
  const active = offerActive(p);
  const images = asArray(p.images);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    image: images[0] || "images/logo.jpeg",
    images,
    short_description: p.short_description,
    description: p.full_description,
    details: asArray(p.specifications),
    variations: asArray(p.variations),
    category_key: p.category_key || null,
    category_name: p.category_name || null,
    regular_price: num(p.price),
    sale_price: active ? num(p.sale_price) : null,
    price: active ? num(p.sale_price) : num(p.price),
    offer_active: active,
    discount_percent: discountPercent(p),
    stock_status: p.stock_status,
    is_featured: !!p.is_featured,
    orderable: isOrderable(p),
    availability_label: availabilityLabel(p),
  };
}
function adminProduct(p) {
  return {
    ...p,
    price: num(p.price),
    sale_price: num(p.sale_price),
    quantity: p.quantity === null ? null : Number(p.quantity),
    images: asArray(p.images),
    specifications: asArray(p.specifications),
    variations: asArray(p.variations),
    is_visible: !!p.is_visible,
    is_featured: !!p.is_featured,
    offer_active: offerActive(p),
    discount_percent: discountPercent(p),
    orderable: isOrderable(p),
  };
}

module.exports = { num, offerActive, discountPercent, isOrderable, availabilityLabel, publicProduct, adminProduct, asArray };
