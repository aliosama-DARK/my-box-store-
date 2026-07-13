// إنشاء طلب من الموقع — الأسعار تُحسب من قاعدة البيانات (أمان) + حفظ المرفقات
const { getSql, getPool, ensureSchema, getSetting, resolveShipping } = require("../_lib/db");
const { sendJSON, readJson, cleanStr, normalizePhone, makeRateLimiter, clientIp } = require("../_lib/util");
const { offerActive, isOrderable, num } = require("../_lib/serialize");

const limiter = makeRateLimiter(10, 10 * 60 * 1000);
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_ATTACH = 10;

function validAttachment(a) {
  if (!a || typeof a !== "object") return null;
  const url = cleanStr(a.url, 600);
  const pathname = cleanStr(a.pathname, 400);
  const mime = cleanStr(a.mime, 40);
  const size = Number(a.size) || 0;
  const name = cleanStr(a.name, 160);
  if (!/^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(url)) return null;
  if (!pathname) return null;
  if (!ALLOWED_MIME.includes(mime)) return null;
  if (size <= 0 || size > 8 * 1024 * 1024) return null;
  return { url, pathname, mime, size, name: name || "reference" };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJSON(res, 405, { error: "method not allowed" });
  if (limiter(clientIp(req))) return sendJSON(res, 429, { error: "تم استلام طلبات كثيرة — انتظر قليلاً" });
  try {
    await ensureSchema();
    const body = await readJson(req, 512 * 1024);

    // Honeypot
    if (cleanStr(body.website, 50)) return sendJSON(res, 400, { error: "طلب غير صالح" });

    const customer_name = cleanStr(body.customer_name, 120);
    const phone = normalizePhone(cleanStr(body.phone, 30));
    const email = cleanStr(body.email, 160);
    const city = cleanStr(body.city, 80);
    const address = cleanStr(body.address, 500);
    const printing = cleanStr(body.customer_notes || body.printing_instructions, 2000);

    if (!customer_name || customer_name.length < 2) return sendJSON(res, 400, { error: "الاسم مطلوب" });
    if (!/^[0-9]{10,15}$/.test(phone)) return sendJSON(res, 400, { error: "رقم الهاتف غير صحيح" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJSON(res, 400, { error: "البريد الإلكتروني غير صحيح" });
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50)
      return sendJSON(res, 400, { error: "سلة الطلب فارغة" });

    // المرفقات (تأتي كروابط Blob بعد رفعها مسبقًا)
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .map(validAttachment).filter(Boolean).slice(0, MAX_ATTACH);

    const wa = (await getSetting("whatsapp_order_enabled", "1")) === "1";
    const source = body.source === "whatsapp" && wa ? "whatsapp" : "website";

    // حساب الأسعار من قاعدة البيانات
    const sql = getSql();
    const items = [];
    for (const raw of body.items) {
      const pid = Number(raw && raw.product_id);
      const qty = Math.max(1, Math.min(999, Number(raw && raw.qty) || 1));
      if (!Number.isInteger(pid)) return sendJSON(res, 400, { error: "منتج غير صالح" });
      const p = (await sql`SELECT * FROM products WHERE id = ${pid}`)[0];
      if (!p || !isOrderable(p)) return sendJSON(res, 400, { error: `منتج غير متوفر حاليًا: ${p ? p.name : "#" + pid}` });
      const unit = offerActive(p) ? num(p.sale_price) : num(p.price);
      items.push({ id: p.id, name: p.name, qty, unit });
    }

    const subtotal = items.reduce((s, it) => s + it.unit * it.qty, 0);
    // رسوم الشحن حسب المحافظة (snapshot يُحفظ في الطلب)
    const ship = await resolveShipping(city, subtotal);
    if (ship.disabled) return sendJSON(res, 400, { error: `التوصيل غير متاح حالياً لمحافظة ${city}` });
    const shipping = ship.fee;
    const total = subtotal + shipping;

    // كتابة الطلب داخل معاملة
    const pool = getPool();
    const client = await pool.connect();
    let orderId, orderNumber;
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO orders (customer_name, phone, email, city, address, printing_instructions,
           subtotal, delivery_cost, discount, total, payment_method, payment_status, status, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'cod','unpaid','new',$10) RETURNING id`,
        [customer_name, phone, email || null, city || null, address || null, printing || null,
         subtotal, shipping, total, source]
      );
      orderId = ins.rows[0].id;
      orderNumber = "MB-" + (1000 + orderId);
      await client.query(`UPDATE orders SET order_number = $1 WHERE id = $2`, [orderNumber, orderId]);
      for (const it of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, it.id, it.name, it.qty, it.unit, it.unit * it.qty]
        );
      }
      for (const a of attachments) {
        await client.query(
          `INSERT INTO order_attachments (order_id, original_filename, storage_path, url, mime_type, file_size)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, a.name, a.pathname, a.url, a.mime, a.size]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw e;
    } finally {
      client.release();
      await pool.end();
    }

    sendJSON(res, 201, {
      ok: true, id: orderId, order_number: orderNumber,
      total, shipping, images_saved: attachments.length,
    });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر حفظ الطلب — حاول مرة أخرى" });
  }
};
