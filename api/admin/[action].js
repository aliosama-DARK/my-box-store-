// معالج موحّد لكل مسارات /api/admin/* (مقطع واحد + معرّف عبر ?id=) لتناسب حد خطة Hobby
const { getSql, getPool, ensureSchema, getSetting, setSetting } = require("../_lib/db");
const { sendJSON, readJson, cleanStr, toBool, normalizePhone, makeRateLimiter, clientIp, slugify } = require("../_lib/util");
const auth = require("../_lib/auth");
const { adminProduct } = require("../_lib/serialize");
const { validateProductBody } = require("../_lib/product_input");
const { ORDER_STATUSES, FOLLOWING, attachSummary } = require("../_lib/orders");
const { decodeImageDataURL, uploadImageBuffer, deleteByUrl } = require("../_lib/blob");

const loginLimiter = makeRateLimiter(8, 10 * 60 * 1000);

module.exports = async (req, res) => {
  const method = req.method;
  let action = "";
  let id = null;
  try {
    const u = new URL(req.url, "http://localhost");
    const parts = u.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
    action = decodeURIComponent(parts[0] || req.query.action || "");
    if (parts[1]) id = Number(parts[1]);
    else if (req.query.id) id = Number(req.query.id);
  } catch (_) {
    action = String(req.query.action || "");
    if (req.query.id) id = Number(req.query.id);
  }

  try {
    await ensureSchema();
    const sql = getSql();

    // ---------- تسجيل الدخول / الخروج ----------
    if (action === "login") {
      if (method !== "POST") return sendJSON(res, 405, { error: "method not allowed" });
      if (loginLimiter(clientIp(req))) return sendJSON(res, 429, { error: "محاولات كثيرة — انتظر 10 دقائق" });
      const body = await readJson(req);
      const email = cleanStr(body.email || body.username, 160).toLowerCase();
      const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
      if (!email || !password) return sendJSON(res, 400, { error: "أدخل البريد وكلمة السر" });
      const a = (await sql`SELECT * FROM admins WHERE email = ${email}`)[0];
      if (!a || !auth.verifyPassword(password, a.password_hash))
        return sendJSON(res, 401, { error: "بيانات الدخول غير صحيحة" });
      auth.setSessionCookie(res, auth.createSessionToken(a));
      return sendJSON(res, 200, { ok: true, name: a.name, email: a.email });
    }
    if (action === "logout") {
      auth.clearSessionCookie(res);
      return sendJSON(res, 200, { ok: true });
    }

    // ---------- ما بعده يتطلب جلسة أدمن ----------
    const admin = auth.requireAdmin(req, res);
    if (!admin) return;

    if (action === "me") return sendJSON(res, 200, { ok: true, name: admin.name, email: admin.email });

    if (action === "categories") {
      if (id !== null) {
        if (!Number.isInteger(id)) return sendJSON(res, 400, { error: "معرّف غير صالح" });
        if (method === "PATCH") {
          const b = await readJson(req);
          const sets = [], params = [];
          let i = 1;
          const set = (c, v) => { sets.push(`${c} = $${i}`); params.push(v); i++; };
          if (b.name !== undefined) { const n = cleanStr(b.name, 80); if (!n) return sendJSON(res, 400, { error: "اسم الفئة مطلوب" }); set("name", n); }
          if (b.description !== undefined) set("description", cleanStr(b.description, 500));
          if (b.image !== undefined) set("image", cleanStr(b.image, 500) || null);
          if (b.background_image !== undefined) set("background_image", cleanStr(b.background_image, 500) || null);
          if (b.seo_title !== undefined) set("seo_title", cleanStr(b.seo_title, 120));
          if (b.seo_description !== undefined) set("seo_description", cleanStr(b.seo_description, 300));
          if (b.display_order !== undefined) set("display_order", Math.floor(Number(b.display_order)) || 0);
          if (b.is_visible !== undefined) set("is_visible", toBool(b.is_visible));
          if (!sets.length) return sendJSON(res, 400, { error: "لا يوجد ما يتم تحديثه" });
          sets.push("updated_at = now()");
          params.push(id);
          const pool = getPool();
          try { await pool.query(`UPDATE categories SET ${sets.join(", ")} WHERE id = $${i}`, params); }
          finally { await pool.end(); }
          return sendJSON(res, 200, { ok: true, category: (await sql`SELECT * FROM categories WHERE id = ${id}`)[0] });
        }
        if (method === "DELETE") {
          await sql`DELETE FROM categories WHERE id = ${id}`; // منتجاتها تصبح بلا فئة (FK SET NULL)
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 405, { error: "method not allowed" });
      }
      if (method === "GET")
        return sendJSON(res, 200, { categories: await sql`SELECT * FROM categories ORDER BY display_order ASC, id ASC` });
      if (method === "POST") {
        const b = await readJson(req);
        const name = cleanStr(b.name, 80);
        if (!name) return sendJSON(res, 400, { error: "اسم الفئة مطلوب" });
        let baseKey = slugify(name) || "cat-" + name.length;
        let key = baseKey, n = 1;
        while ((await sql`SELECT id FROM categories WHERE key = ${key}`)[0]) key = `${baseKey}-${++n}`;
        const maxo = (await sql`SELECT COALESCE(MAX(display_order),0)::int AS m FROM categories`)[0].m;
        const row = (await sql`INSERT INTO categories
          (key,name,slug,description,image,background_image,seo_title,seo_description,display_order,is_visible,created_at,updated_at)
          VALUES (${key}, ${name}, ${key}, ${cleanStr(b.description || "", 500)},
            ${cleanStr(b.image || "", 500) || null}, ${cleanStr(b.background_image || "", 500) || null},
            ${cleanStr(b.seo_title || "", 120)}, ${cleanStr(b.seo_description || "", 300)},
            ${maxo + 1}, ${b.is_visible === undefined ? true : toBool(b.is_visible)}, now(), now())
          RETURNING *`)[0];
        return sendJSON(res, 201, { ok: true, category: row });
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }

    if (action === "stats") {
      const statusRows = await sql`SELECT status, COUNT(*)::int AS c FROM orders GROUP BY status`;
      const map = {}; statusRows.forEach((r) => (map[r.status] = r.c));
      const orders = {
        new: map.new || 0, following: FOLLOWING.reduce((s, k) => s + (map[k] || 0), 0),
        completed: map.completed || 0, cancelled: map.cancelled || 0, total: statusRows.reduce((s, r) => s + r.c, 0),
      };
      const products = (await sql`SELECT
        COUNT(*) FILTER (WHERE is_visible AND stock_status='in_stock')::int AS available,
        COUNT(*) FILTER (WHERE is_visible AND stock_status='out_of_stock')::int AS unavailable,
        COUNT(*) FILTER (WHERE NOT is_visible)::int AS hidden,
        COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price>0 AND sale_price<price)::int AS offers,
        COUNT(*)::int AS total FROM products`)[0];
      const recent = await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT 6`;
      await attachSummary(sql, recent);
      return sendJSON(res, 200, { orders, products, recent });
    }

    if (action === "settings") {
      const cur = async () => ({
        whatsapp_order_enabled: (await getSetting("whatsapp_order_enabled", "1")) === "1",
        shipping_fee: Number(await getSetting("shipping_fee", "50")),
        store_phone: await getSetting("store_phone", ""),
      });
      if (method === "GET") return sendJSON(res, 200, await cur());
      if (method === "PATCH") {
        const body = await readJson(req);
        if (body.whatsapp_order_enabled !== undefined)
          await setSetting("whatsapp_order_enabled", toBool(body.whatsapp_order_enabled) ? "1" : "0");
        if (body.shipping_fee !== undefined) {
          const fee = Number(body.shipping_fee);
          if (!(fee >= 0)) return sendJSON(res, 400, { error: "مصاريف الشحن غير صالحة" });
          await setSetting("shipping_fee", String(fee));
        }
        if (body.store_phone !== undefined) {
          const ph = normalizePhone(body.store_phone);
          if (!/^[0-9]{10,15}$/.test(ph)) return sendJSON(res, 400, { error: "رقم واتساب غير صحيح" });
          await setSetting("store_phone", ph);
        }
        return sendJSON(res, 200, await cur());
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }

    if (action === "upload") {
      if (method !== "POST") return sendJSON(res, 405, { error: "method not allowed" });
      const body = await readJson(req, 4 * 1024 * 1024);
      const dec = decodeImageDataURL(body.data, 4 * 1024 * 1024);
      if (!dec) return sendJSON(res, 400, { error: "صيغة الصورة غير مدعومة (PNG/JPG/WebP حتى ~3.5MB)" });
      const up = await uploadImageBuffer(dec.buf, dec.ext, dec.mime, "products");
      return sendJSON(res, 201, { ok: true, path: up.url, url: up.url });
    }

    // ---------- الطلبات ----------
    if (action === "orders") {
      if (id !== null) {
        if (!Number.isInteger(id)) return sendJSON(res, 400, { error: "معرّف غير صالح" });
        if (method === "GET") {
          const order = (await sql`SELECT * FROM orders WHERE id = ${id}`)[0];
          if (!order) return sendJSON(res, 404, { error: "الطلب غير موجود" });
          order.items = await sql`SELECT * FROM order_items WHERE order_id = ${id} ORDER BY id ASC`;
          const atts = await sql`SELECT id, original_filename, url, mime_type, file_size FROM order_attachments WHERE order_id = ${id} ORDER BY id ASC`;
          order.images = atts.map((a) => ({ id: a.id, url: a.url, orig_name: a.original_filename, mime: a.mime_type, size: a.file_size }));
          await attachSummary(sql, [order]);
          return sendJSON(res, 200, { order });
        }
        if (method === "PATCH") {
          const body = await readJson(req);
          let touched = false;
          if (body.status !== undefined) {
            if (!ORDER_STATUSES.includes(body.status)) return sendJSON(res, 400, { error: "حالة غير صالحة" });
            await sql`UPDATE orders SET status = ${body.status}, updated_at = now() WHERE id = ${id}`; touched = true;
          }
          if (body.internal_notes !== undefined) {
            await sql`UPDATE orders SET internal_notes = ${cleanStr(body.internal_notes, 5000)}, updated_at = now() WHERE id = ${id}`; touched = true;
          }
          if (body.payment_status !== undefined && ["unpaid", "paid"].includes(body.payment_status)) {
            await sql`UPDATE orders SET payment_status = ${body.payment_status}, updated_at = now() WHERE id = ${id}`; touched = true;
          }
          if (!touched) return sendJSON(res, 400, { error: "لا يوجد ما يتم تحديثه" });
          const order = (await sql`SELECT * FROM orders WHERE id = ${id}`)[0];
          await attachSummary(sql, [order]);
          return sendJSON(res, 200, { ok: true, order });
        }
        if (method === "DELETE") {
          const atts = await sql`SELECT url FROM order_attachments WHERE order_id = ${id}`;
          for (const a of atts) await deleteByUrl(a.url);
          await sql`DELETE FROM orders WHERE id = ${id}`;
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 405, { error: "method not allowed" });
      }
      // قائمة الطلبات
      if (method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });
      const q = req.query, where = [], params = [];
      let i = 1;
      const search = cleanStr(q.search || "", 100), status = cleanStr(q.status || "", 30);
      const from = cleanStr(q.from || "", 10), to = cleanStr(q.to || "", 10);
      if (search) { where.push(`(customer_name ILIKE $${i} OR phone ILIKE $${i} OR order_number ILIKE $${i})`); params.push(`%${search}%`); i++; }
      if (status && ORDER_STATUSES.includes(status)) { where.push(`status = $${i++}`); params.push(status); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push(`created_at >= $${i++}`); params.push(from); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push(`created_at <= ($${i++}::date + interval '1 day')`); params.push(to); }
      const text = `SELECT * FROM orders ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 500`;
      const pool = getPool();
      let rows;
      try { rows = (await pool.query(text, params)).rows; } finally { await pool.end(); }
      await attachSummary(sql, rows);
      return sendJSON(res, 200, { orders: rows });
    }

    // ---------- المنتجات ----------
    if (action === "products") {
      if (id !== null) {
        if (!Number.isInteger(id)) return sendJSON(res, 400, { error: "معرّف غير صالح" });
        const existing = (await sql`SELECT id FROM products WHERE id = ${id}`)[0];
        if (!existing) return sendJSON(res, 404, { error: "المنتج غير موجود" });
        if (method === "PATCH") {
          const body = await readJson(req);
          const { out, errors } = validateProductBody(body, true);
          if (errors.length) return sendJSON(res, 400, { error: errors.join("، ") });
          const cols = [], params = [];
          let i = 1;
          const set = (c, v, cast = "") => { cols.push(`${c} = $${i}${cast}`); params.push(v); i++; };
          if (out.name !== undefined) { set("name", out.name); set("slug", out.slug); }
          if (out.price !== undefined) set("price", out.price);
          if (out.sale_price !== undefined) set("sale_price", out.sale_price);
          if (out.category_id !== undefined) set("category_id", out.category_id);
          if (out.short_description !== undefined) set("short_description", out.short_description);
          if (out.full_description !== undefined) set("full_description", out.full_description);
          if (out.internal_notes !== undefined) set("internal_notes", out.internal_notes);
          if (out.offer_start_date !== undefined) set("offer_start_date", out.offer_start_date);
          if (out.offer_end_date !== undefined) set("offer_end_date", out.offer_end_date);
          if (out.stock_status !== undefined) set("stock_status", out.stock_status);
          if (out.quantity !== undefined) set("quantity", out.quantity);
          if (out.images !== undefined) set("images", JSON.stringify(out.images), "::jsonb");
          if (out.specifications !== undefined) set("specifications", JSON.stringify(out.specifications), "::jsonb");
          if (out.variations !== undefined) set("variations", JSON.stringify(out.variations), "::jsonb");
          if (out.sizes !== undefined) set("sizes", JSON.stringify(out.sizes), "::jsonb");
          if (out.materials !== undefined) set("materials", JSON.stringify(out.materials), "::jsonb");
          if (out.bg_color !== undefined) set("bg_color", out.bg_color);
          if (out.is_visible !== undefined) set("is_visible", out.is_visible);
          if (out.is_featured !== undefined) set("is_featured", out.is_featured);
          if (out.display_order !== undefined) set("display_order", out.display_order);
          if (!cols.length) return sendJSON(res, 400, { error: "لا يوجد ما يتم تحديثه" });
          cols.push("updated_at = now()");
          params.push(id);
          const pool = getPool();
          try { await pool.query(`UPDATE products SET ${cols.join(", ")} WHERE id = $${i}`, params); }
          finally { await pool.end(); }
          const full = (await sql`SELECT p.*, c.key AS category_key, c.name AS category_name
            FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ${id}`)[0];
          return sendJSON(res, 200, { ok: true, product: adminProduct(full) });
        }
        if (method === "DELETE") {
          await sql`DELETE FROM products WHERE id = ${id}`;
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 405, { error: "method not allowed" });
      }
      // قائمة/إنشاء
      if (method === "GET") {
        const rows = await sql`SELECT p.*, c.key AS category_key, c.name AS category_name
          FROM products p LEFT JOIN categories c ON c.id = p.category_id
          ORDER BY p.display_order ASC, p.id ASC`;
        let list = rows.map(adminProduct);
        const search = cleanStr(req.query.search || "", 100), cat = cleanStr(req.query.cat || "", 40), filter = cleanStr(req.query.filter || "", 30);
        if (search) list = list.filter((p) => (p.name || "").includes(search));
        if (cat && cat !== "all") list = list.filter((p) => p.category_key === cat);
        if (filter === "available") list = list.filter((p) => p.orderable);
        else if (filter === "unavailable") list = list.filter((p) => p.is_visible && p.stock_status === "out_of_stock");
        else if (filter === "hidden") list = list.filter((p) => !p.is_visible);
        else if (filter === "offer") list = list.filter((p) => p.offer_active);
        else if (filter === "featured") list = list.filter((p) => p.is_featured);
        return sendJSON(res, 200, { products: list });
      }
      if (method === "POST") {
        const body = await readJson(req);
        const { out, errors } = validateProductBody(body, false);
        if (errors.length) return sendJSON(res, 400, { error: errors.join("، ") });
        const maxSort = (await sql`SELECT COALESCE(MAX(display_order),0)::int AS m FROM products`)[0].m;
        const row = (await sql`INSERT INTO products
          (category_id,name,slug,short_description,full_description,price,sale_price,offer_start_date,offer_end_date,
           stock_status,quantity,images,specifications,variations,sizes,materials,is_visible,is_featured,internal_notes,display_order,created_at,updated_at)
          VALUES (${out.category_id || null}, ${out.name}, ${out.slug}, ${out.short_description || null}, ${out.full_description || null},
           ${out.price}, ${out.sale_price ?? null}, ${out.offer_start_date || null}, ${out.offer_end_date || null},
           ${out.stock_status || "in_stock"}, ${out.quantity ?? null}, ${JSON.stringify(out.images || [])}::jsonb,
           ${JSON.stringify(out.specifications || [])}::jsonb, ${JSON.stringify(out.variations || [])}::jsonb,
           ${JSON.stringify(out.sizes || [])}::jsonb, ${JSON.stringify(out.materials || [])}::jsonb,
           ${out.is_visible ?? true}, ${out.is_featured ?? false}, ${out.internal_notes || ""}, ${out.display_order ?? maxSort + 1}, now(), now())
          RETURNING id`)[0];
        if (out.bg_color !== undefined) await sql`UPDATE products SET bg_color = ${out.bg_color} WHERE id = ${row.id}`;
        const full = (await sql`SELECT p.*, c.key AS category_key, c.name AS category_name
          FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ${row.id}`)[0];
        return sendJSON(res, 201, { ok: true, product: adminProduct(full) });
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }

    // ---------- مناطق الشحن ----------
    if (action === "shipping") {
      if (id !== null) {
        if (!Number.isInteger(id)) return sendJSON(res, 400, { error: "معرّف غير صالح" });
        if (method === "PATCH") {
          const b = await readJson(req);
          const sets = [], params = [];
          let i = 1;
          const set = (c, v) => { sets.push(`${c} = $${i}`); params.push(v); i++; };
          if (b.name !== undefined) { const n = cleanStr(b.name, 80); if (!n) return sendJSON(res, 400, { error: "اسم المنطقة مطلوب" }); set("name", n); }
          if (b.fee !== undefined) { const f = Number(b.fee); if (!(f >= 0)) return sendJSON(res, 400, { error: "سعر شحن غير صالح" }); set("fee", f); }
          if (b.delivery_time !== undefined) set("delivery_time", cleanStr(b.delivery_time, 60));
          if (b.enabled !== undefined) set("enabled", toBool(b.enabled));
          if (b.free_threshold !== undefined) {
            const t = b.free_threshold === null || b.free_threshold === "" ? null : Number(b.free_threshold);
            if (t !== null && !(t >= 0)) return sendJSON(res, 400, { error: "حد الشحن المجاني غير صالح" });
            set("free_threshold", t);
          }
          if (b.notes !== undefined) set("notes", cleanStr(b.notes, 300));
          if (b.internal_notes !== undefined) set("internal_notes", cleanStr(b.internal_notes, 500));
          if (b.display_order !== undefined) set("display_order", Math.floor(Number(b.display_order)) || 0);
          if (!sets.length) return sendJSON(res, 400, { error: "لا يوجد ما يتم تحديثه" });
          sets.push("updated_at = now()");
          params.push(id);
          const pool = getPool();
          try { await pool.query(`UPDATE shipping_zones SET ${sets.join(", ")} WHERE id = $${i}`, params); }
          catch (e) { return sendJSON(res, 400, { error: "تعذّر التحديث (ربما الاسم مكرر)" }); }
          finally { await pool.end(); }
          const z = (await sql`SELECT * FROM shipping_zones WHERE id = ${id}`)[0];
          return sendJSON(res, 200, { ok: true, zone: z });
        }
        if (method === "DELETE") {
          await sql`DELETE FROM shipping_zones WHERE id = ${id}`;
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 405, { error: "method not allowed" });
      }
      if (method === "GET")
        return sendJSON(res, 200, { zones: await sql`SELECT * FROM shipping_zones ORDER BY display_order ASC, id ASC` });
      if (method === "POST") {
        const b = await readJson(req);
        const name = cleanStr(b.name, 80);
        if (!name) return sendJSON(res, 400, { error: "اسم المنطقة مطلوب" });
        const fee = Number(b.fee) || 0;
        if (!(fee >= 0)) return sendJSON(res, 400, { error: "سعر شحن غير صالح" });
        const dt = cleanStr(b.delivery_time || "2 – 4 أيام عمل", 60);
        const enabled = b.enabled === undefined ? true : toBool(b.enabled);
        const thr = b.free_threshold === null || b.free_threshold === undefined || b.free_threshold === "" ? null : Number(b.free_threshold);
        const notes = cleanStr(b.notes || "", 300);
        const maxo = (await sql`SELECT COALESCE(MAX(display_order),0)::int AS m FROM shipping_zones`)[0].m;
        try {
          const z = (await sql`INSERT INTO shipping_zones (name,fee,delivery_time,enabled,free_threshold,notes,display_order,created_at,updated_at)
            VALUES (${name}, ${fee}, ${dt}, ${enabled}, ${thr}, ${notes}, ${maxo + 1}, now(), now()) RETURNING *`)[0];
          return sendJSON(res, 201, { ok: true, zone: z });
        } catch (e) { return sendJSON(res, 400, { error: "تعذّر الإضافة (ربما الاسم مكرر)" }); }
      }
      return sendJSON(res, 405, { error: "method not allowed" });
    }

    return sendJSON(res, 404, { error: "غير موجود" });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر تنفيذ العملية" });
  }
};
