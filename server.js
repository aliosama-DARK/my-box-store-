/* ====================================================
   MY BOX STORE — Backend Server v2
   منتجات + طلبات + عروض + إعدادات — Node.js + SQLite (بدون مكتبات خارجية)
   التشغيل:  node server.js
   تغيير كلمة سر الأدمن:  node server.js --set-password كلمة_السر_الجديدة
   ==================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS_DIR = path.join(ROOT, "images", "uploads");
const SESSION_COOKIE = "mbs_session";
const SESSION_DAYS = 7;
const ADMIN_USERNAME = "admin";
const DEFAULT_PASSWORD = "MyBox@2026";

const ORDER_STATUSES = [
  "new",                   // جديد
  "under_review",          // قيد المراجعة
  "awaiting_confirmation", // في انتظار تأكيد العميل
  "design_confirmed",      // تم تأكيد التصميم
  "in_production",         // قيد التنفيذ
  "ready",                 // تم التجهيز
  "shipped",               // تم الشحن
  "completed",             // مكتمل
  "cancelled",             // ملغي
  // حالات قديمة مقبولة للتوافق مع بيانات سابقة
  "contacted", "pending_confirmation", "in_progress", "prepared", "delivered",
];
const FOLLOWING_STATUSES = [
  "under_review", "awaiting_confirmation", "design_confirmed", "in_production", "ready", "shipped",
  "contacted", "pending_confirmation", "in_progress", "prepared", "delivered",
];
const PRODUCT_STATUSES = ["available", "unavailable"];
const STOCK_STATUSES = ["in_stock", "out_of_stock"];

const ORDER_UPLOADS_DIR = path.join(ROOT, "images", "order_uploads");
const MAX_ORDER_IMAGES = 10;

// ===== قاعدة البيانات =====
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "store.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    key  TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS products (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    slug              TEXT,
    image             TEXT,
    short_description TEXT,
    description       TEXT,
    details_json      TEXT,
    category_id       INTEGER,
    regular_price     REAL NOT NULL DEFAULT 0,
    sale_price        REAL,
    has_offer         INTEGER NOT NULL DEFAULT 0,
    offer_start_date  TEXT,
    offer_end_date    TEXT,
    stock_quantity    INTEGER,
    stock_status      TEXT NOT NULL DEFAULT 'in_stock',
    product_status    TEXT NOT NULL DEFAULT 'available',
    is_featured       INTEGER NOT NULL DEFAULT 0,
    is_hidden         INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    internal_notes    TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ترحيل جدول الطلبات القديم إلى الهيكل الجديد (إعادة بناء كاملة مع نقل البيانات)
const NEW_ORDERS_SCHEMA = `(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number   TEXT,
    customer_name  TEXT NOT NULL,
    phone          TEXT NOT NULL,
    email          TEXT,
    city           TEXT,
    address        TEXT,
    customer_notes TEXT,
    status         TEXT NOT NULL DEFAULT 'new',
    source         TEXT NOT NULL DEFAULT 'website',
    total_price    REAL NOT NULL DEFAULT 0,
    internal_notes TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )`;

function ordersTableNeedsRebuild() {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
  if (!t) return false;
  const cols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  // الجدول القديم: ينقصه order_number أو ما زال يحمل أعمدة الإصدار الأول
  return !cols.includes("order_number") || cols.includes("service_or_product");
}
if (ordersTableNeedsRebuild()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL,
      product_id   INTEGER,
      product_name TEXT NOT NULL,
      quantity     INTEGER NOT NULL,
      unit_price   REAL NOT NULL,
      total_price  REAL NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE orders_v2 ${NEW_ORDERS_SCHEMA};
  `);
  const oldCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  const pick = (row, ...names) => {
    for (const n of names) if (oldCols.includes(n) && row[n] !== undefined && row[n] !== null) return row[n];
    return null;
  };
  const oldRows = db.prepare("SELECT * FROM orders").all();
  const insOrder = db.prepare(`
    INSERT INTO orders_v2 (id, order_number, customer_name, phone, email, city, address, customer_notes, status, source, total_price, internal_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const r of oldRows) {
    insOrder.run(
      r.id, pick(r, "order_number") || "MB-" + (1000 + r.id), r.customer_name, r.phone,
      pick(r, "email"), pick(r, "city", "governorate"), pick(r, "address"),
      pick(r, "customer_notes", "message"), r.status || "new", pick(r, "source") || "website",
      Number(pick(r, "total_price", "total")) || 0, r.internal_notes || "",
      r.created_at, r.updated_at
    );
    // نقل منتجات الطلب القديم من items_json إلى جدول order_items
    let items = [];
    try { items = JSON.parse(pick(r, "items_json") || "[]"); } catch { items = []; }
    for (const it of items) {
      if (!it || !it.name) continue;
      const qty = Number(it.qty) || 1;
      const unit = Number(it.price) || 0;
      insItem.run(r.id, null, String(it.name), qty, unit, unit * qty, r.created_at);
    }
  }
  db.exec("DROP TABLE orders");
  db.exec("ALTER TABLE orders_v2 RENAME TO orders");
  console.log(`✅ تم ترحيل جدول الطلبات للهيكل الجديد (${oldRows.length} طلب منقول).`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number   TEXT,
    customer_name  TEXT NOT NULL,
    phone          TEXT NOT NULL,
    email          TEXT,
    city           TEXT,
    address        TEXT,
    customer_notes TEXT,
    status         TEXT NOT NULL DEFAULT 'new',
    source         TEXT NOT NULL DEFAULT 'website',
    total_price    REAL NOT NULL DEFAULT 0,
    internal_notes TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL,
    product_id   INTEGER,
    product_name TEXT NOT NULL,
    quantity     INTEGER NOT NULL,
    unit_price   REAL NOT NULL,
    total_price  REAL NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    path       TEXT NOT NULL,
    orig_name  TEXT,
    mime       TEXT,
    size       INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_items_order     ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_images_order    ON order_images(order_id);
  CREATE INDEX IF NOT EXISTS idx_products_cat    ON products(category_id);
`);

// ===== الإعدادات وكلمة السر =====
function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return check.length === expected.length && crypto.timingSafeEqual(check, expected);
}

const pwFlagIndex = process.argv.indexOf("--set-password");
if (pwFlagIndex !== -1) {
  const newPass = process.argv[pwFlagIndex + 1];
  if (!newPass || newPass.length < 8) {
    console.error("❌ اكتب كلمة سر لا تقل عن 8 أحرف:  node server.js --set-password كلمة_السر");
    process.exit(1);
  }
  setSetting("admin_password", hashPassword(newPass));
  db.prepare("DELETE FROM sessions").run();
  console.log("✅ تم تغيير كلمة سر الأدمن بنجاح.");
  process.exit(0);
}

if (!getSetting("admin_password")) {
  setSetting("admin_password", hashPassword(DEFAULT_PASSWORD));
  console.log("⚠️  حساب الأدمن الافتراضي — المستخدم: admin / كلمة السر: " + DEFAULT_PASSWORD);
  console.log("    غيّرها بالأمر:  node server.js --set-password كلمة_سر_جديدة");
}
// إعدادات المتجر الافتراضية
if (getSetting("whatsapp_order_enabled") === null) setSetting("whatsapp_order_enabled", "1");
if (getSetting("shipping_fee") === null) setSetting("shipping_fee", "50");
if (getSetting("store_phone") === null) setSetting("store_phone", "201032543968");

// ===== تهيئة الفئات والمنتجات عند أول تشغيل =====
if (db.prepare("SELECT COUNT(*) AS c FROM categories").get().c === 0) {
  const insCat = db.prepare("INSERT INTO categories (key, name, sort_order) VALUES (?, ?, ?)");
  insCat.run("awards", "دروع وتذكارات", 1);
  insCat.run("certificates", "شهادات", 2);
  insCat.run("prints", "مطبوعات", 3);
}
if (db.prepare("SELECT COUNT(*) AS c FROM products").get().c === 0) {
  const catId = (key) => db.prepare("SELECT id FROM categories WHERE key = ?").get(key).id;
  const ts = new Date().toISOString();
  const ins = db.prepare(`
    INSERT INTO products
    (name, slug, image, short_description, description, details_json, category_id,
     regular_price, sale_price, has_offer, stock_status, product_status, is_featured, is_hidden, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_stock', 'available', ?, 0, ?, ?, ?)`);
  ins.run(
    "درع زجاجي — شهادة تميز", "glass-award-shield", "images/award-shield.png",
    "درع زجاجي كريستالي فاخر بقاعدة خشبية، محفور بالليزر بتصميمك.",
    "درع زجاجي كريستالي فاخر بقاعدة خشبية، محفور بالليزر بتصميمك أو شعارك أو نص خاص. الاختيار الأمثل لتكريم الموظفين، حفلات التخرج، المسابقات، والمناسبات الرسمية. تصميم راقٍ يعكس قيمة التكريم.",
    JSON.stringify([["الخامة", "زجاج كريستال + قاعدة خشب طبيعي"], ["المقاس", "حوالي 20 × 15 سم"], ["التخصيص", "نقش الاسم / الشعار / النص + لوحة ذهبية"], ["مدة التنفيذ", "2 – 4 أيام عمل"]]),
    catId("awards"), 450, 350, 1, 1, 1, ts, ts
  );
  ins.run(
    "شهادة تقدير بإطار خشبي", "certificate-wooden-frame", "images/certificate-frame.png",
    "شهادة تقدير مطبوعة بجودة عالية داخل إطار خشبي أنيق.",
    "شهادة تقدير مطبوعة بجودة عالية داخل إطار خشبي أنيق بحواف ذهبية وختم مميز. مناسبة للتكريم والإهداء في المناسبات الرسمية والمدارس والشركات. تُسلَّم جاهزة للعرض أو الإهداء.",
    JSON.stringify([["الخامة", "ورق فاخر + إطار خشبي"], ["المقاس", "A4 مع الإطار"], ["التخصيص", "الاسم / النص / المناسبة / الشعار"], ["مدة التنفيذ", "1 – 3 أيام عمل"]]),
    catId("certificates"), 220, null, 0, 0, 2, ts, ts
  );
  ins.run(
    "تيشيرت مطبوع مخصص", "custom-printed-tshirt", "images/tshirt-print.png",
    "تيشيرت قطن عالي الجودة بطباعة احترافية ثابتة لا تبهت.",
    "تيشيرت قطن عالي الجودة بطباعة احترافية ثابتة لا تبهت مع الغسيل. اطبع تصميمك أو اسمك أو شعارك على الأمام والخلف. متوفر بكل المقاسات وعدة ألوان. مثالي للفرق والشركات والمناسبات.",
    JSON.stringify([["الخامة", "قطن 100%"], ["المقاسات", "S / M / L / XL / XXL"], ["التخصيص", "طباعة أمامية وخلفية بتصميمك"], ["مدة التنفيذ", "2 – 4 أيام عمل"]]),
    catId("prints"), 320, 250, 1, 0, 3, ts, ts
  );
  ins.run(
    "مج مطبوع مخصص", "custom-printed-mug", "images/mug-print.png",
    "مج سيراميك بطباعة بانورامية عالية الجودة بصورتك أو تصميمك.",
    "مج سيراميك بطباعة بانورامية عالية الجودة. اطبع صورتك أو اسمك أو أي تصميم تحبه — هدية مميزة وعملية لكل المناسبات وأعياد الميلاد. ألوان ثابتة وجودة طباعة ممتازة.",
    JSON.stringify([["الخامة", "سيراميك عالي الجودة"], ["السعة", "330 مل"], ["التخصيص", "طباعة بانورامية بصورتك / تصميمك"], ["مدة التنفيذ", "1 – 3 أيام عمل"]]),
    catId("prints"), 160, 120, 1, 0, 4, ts, ts
  );
  console.log("✅ تم نقل منتجات المتجر الحالية إلى قاعدة البيانات.");
}

// ===== الجلسات =====
function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)").run(token, username, expires);
  return token;
}
function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row;
}
function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// ===== الحماية من الإغراق (Rate limiting) =====
function makeRateLimiter(max, windowMs) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now >= rec.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return false;
    }
    rec.count++;
    return rec.count > max;
  };
}
const loginLimiter = makeRateLimiter(8, 10 * 60 * 1000);
const orderLimiter = makeRateLimiter(6, 10 * 60 * 1000);

// ===== أدوات مساعدة =====
const CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");
function cleanStr(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.replace(CTRL_RE, "").trim().slice(0, max);
}
function sendJSON(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(obj));
}
function readBody(req, maxBytes = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}
function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "2" + d;
  else if (/^1[0-9]{9}$/.test(d)) d = "20" + d;
  return d;
}
function nowISO() {
  return new Date().toISOString();
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function toBool01(v) {
  return v === true || v === 1 || v === "1" ? 1 : 0;
}
function slugify(name, id) {
  const s = String(name || "").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return s || `product-${id || Date.now()}`;
}

// فحص وحفظ صورة data-URL بأمان (نوع/حجم حقيقيان + اسم عشوائي)
const IMG_EXT = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp" };
function decodeImageDataURL(dataURL, maxBytes = 6 * 1024 * 1024) {
  if (typeof dataURL !== "string") return null;
  const m = dataURL.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const ext = IMG_EXT[m[1] === "jpeg" ? "jpg" : m[1]] || "jpg";
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > maxBytes) return null;
  // تحقق من التوقيع الفعلي للملف (magic bytes) لا الامتداد فقط
  const isPNG = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJPG = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWEBP = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
  if (!isPNG && !isJPG && !isWEBP) return null;
  return { buf, ext, mime: `image/${ext === "jpg" ? "jpeg" : ext}` };
}
function saveOrderImages(orderId, images, ts) {
  if (!Array.isArray(images) || !images.length) return 0;
  if (!fs.existsSync(ORDER_UPLOADS_DIR)) fs.mkdirSync(ORDER_UPLOADS_DIR, { recursive: true });
  const ins = db.prepare(`
    INSERT INTO order_images (order_id, path, orig_name, mime, size, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  let saved = 0;
  for (const item of images.slice(0, MAX_ORDER_IMAGES)) {
    const dataURL = typeof item === "string" ? item : item && item.data;
    const origName = cleanStr((item && item.name) || "", 120) || null;
    const dec = decodeImageDataURL(dataURL);
    if (!dec) continue;
    const fileName = `o${orderId}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}.${dec.ext}`;
    fs.writeFileSync(path.join(ORDER_UPLOADS_DIR, fileName), dec.buf);
    ins.run(orderId, `images/order_uploads/${fileName}`, origName, dec.mime, dec.buf.length, ts);
    saved++;
  }
  return saved;
}

// ===== منطق العروض والتوفر =====
function offerActive(p) {
  if (!p.has_offer || !p.sale_price || Number(p.sale_price) <= 0) return false;
  if (Number(p.sale_price) >= Number(p.regular_price)) return false;
  const today = todayStr();
  if (p.offer_start_date && today < p.offer_start_date) return false;
  if (p.offer_end_date && today > p.offer_end_date) return false;
  return true;
}
function discountPercent(p) {
  if (!offerActive(p)) return 0;
  return Math.round((1 - Number(p.sale_price) / Number(p.regular_price)) * 100);
}
function isOrderable(p) {
  return !p.is_hidden && p.product_status === "available" && p.stock_status === "in_stock";
}
function availabilityLabel(p) {
  if (p.stock_status === "out_of_stock") return "نفدت الكمية";
  if (p.product_status === "unavailable") return "غير متوفر حاليًا";
  return "";
}
function publicProductJSON(p) {
  const active = offerActive(p);
  let details = [];
  try { details = JSON.parse(p.details_json || "[]"); } catch { details = []; }
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    image: p.image,
    short_description: p.short_description,
    description: p.description,
    details,
    category_key: p.category_key || null,
    category_name: p.category_name || null,
    regular_price: Number(p.regular_price),
    sale_price: active ? Number(p.sale_price) : null,
    price: active ? Number(p.sale_price) : Number(p.regular_price),
    offer_active: active,
    discount_percent: discountPercent(p),
    stock_status: p.stock_status,
    product_status: p.product_status,
    is_featured: !!p.is_featured,
    orderable: isOrderable(p),
    availability_label: availabilityLabel(p),
  };
}
const PRODUCT_SELECT = `
  SELECT p.*, c.key AS category_key, c.name AS category_name
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

// تصدير المنتجات لملف products.json — يُستخدم كـ snapshot للاستضافة الثابتة (GitHub Pages)
function exportProductsSnapshot() {
  try {
    const rows = db.prepare(`${PRODUCT_SELECT} WHERE p.is_hidden = 0 ORDER BY p.sort_order ASC, p.id ASC`).all();
    const snapshot = {
      generated_at: nowISO(),
      settings: {
        shipping_fee: Number(getSetting("shipping_fee", "50")),
        store_phone: getSetting("store_phone", ""),
      },
      products: rows.map(publicProductJSON),
    };
    fs.writeFileSync(path.join(ROOT, "products.json"), JSON.stringify(snapshot, null, 2));
  } catch (e) {
    console.error("snapshot export error:", e.message);
  }
}

// ===== API عام (بدون تسجيل دخول) =====
function apiPublicProducts(req, res, url) {
  const cat = cleanStr(url.searchParams.get("cat") || "", 40);
  const offersOnly = url.searchParams.get("offers") === "1";
  const rows = db.prepare(`${PRODUCT_SELECT} WHERE p.is_hidden = 0 ORDER BY p.sort_order ASC, p.id ASC`).all();
  let list = rows.map(publicProductJSON);
  if (cat && cat !== "all") list = list.filter((p) => p.category_key === cat);
  if (offersOnly) list = list.filter((p) => p.offer_active);
  sendJSON(res, 200, { products: list });
}
function apiPublicProduct(req, res, id) {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ? AND p.is_hidden = 0`).get(id);
  if (!row) return sendJSON(res, 404, { error: "المنتج غير موجود" });
  sendJSON(res, 200, { product: publicProductJSON(row) });
}
function apiPublicSettings(req, res) {
  sendJSON(res, 200, {
    whatsapp_order_enabled: getSetting("whatsapp_order_enabled") === "1",
    shipping_fee: Number(getSetting("shipping_fee", "50")),
    store_phone: getSetting("store_phone", ""),
  });
}

// ===== API عام: إنشاء طلب من الموقع =====
function apiCreateOrder(req, res, body) {
  const ip = req.socket.remoteAddress || "?";
  if (orderLimiter(ip))
    return sendJSON(res, 429, { error: "تم استلام طلبات كثيرة من جهازك — انتظر قليلاً ثم أعد المحاولة" });

  // Honeypot: حقل مخفي لا يملؤه إلا الروبوتات
  if (cleanStr(body.website, 50)) return sendJSON(res, 400, { error: "طلب غير صالح" });

  const customer_name = cleanStr(body.customer_name, 120);
  const phone = normalizePhone(cleanStr(body.phone, 30));
  const email = cleanStr(body.email, 160);
  const city = cleanStr(body.city, 80);
  const address = cleanStr(body.address, 500);
  const customer_notes = cleanStr(body.customer_notes, 2000);

  if (!customer_name || customer_name.length < 2) return sendJSON(res, 400, { error: "الاسم مطلوب" });
  if (!/^[0-9]{10,15}$/.test(phone)) return sendJSON(res, 400, { error: "رقم الهاتف غير صحيح" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return sendJSON(res, 400, { error: "البريد الإلكتروني غير صحيح" });
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50)
    return sendJSON(res, 400, { error: "سلة الطلب فارغة" });

  // مصدر الطلب: واتساب مسموح فقط لو الخيار مفعّل من الداش بورد
  const source = body.source === "whatsapp" && getSetting("whatsapp_order_enabled") === "1" ? "whatsapp" : "website";

  // الأسعار تُحسب من قاعدة البيانات وليس من العميل (أمان)
  const items = [];
  for (const raw of body.items) {
    const pid = Number(raw && raw.product_id);
    const qty = Math.max(1, Math.min(999, Number(raw && raw.qty) || 1));
    if (!Number.isInteger(pid)) return sendJSON(res, 400, { error: "منتج غير صالح" });
    const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(pid);
    if (!p || !isOrderable(p))
      return sendJSON(res, 400, { error: `منتج غير متوفر حاليًا: ${p ? p.name : "#" + pid}` });
    if (p.stock_quantity !== null && p.stock_quantity !== undefined && qty > p.stock_quantity)
      return sendJSON(res, 400, { error: `الكمية المتاحة من "${p.name}" هي ${p.stock_quantity} فقط` });
    const unit = offerActive(p) ? Number(p.sale_price) : Number(p.regular_price);
    items.push({ product: p, qty, unit });
  }

  const shipping = Number(getSetting("shipping_fee", "50"));
  const subtotal = items.reduce((s, it) => s + it.unit * it.qty, 0);
  const total_price = subtotal + shipping;
  const ts = nowISO();

  db.exec("BEGIN");
  try {
    const info = db.prepare(`
      INSERT INTO orders (order_number, customer_name, phone, email, city, address, customer_notes, status, source, total_price, created_at, updated_at)
      VALUES (NULL, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`)
      .run(customer_name, phone, email || null, city || null, address || null, customer_notes || null, source, total_price, ts, ts);
    const orderId = Number(info.lastInsertRowid);
    const orderNumber = "MB-" + (1000 + orderId);
    db.prepare("UPDATE orders SET order_number = ? WHERE id = ?").run(orderNumber, orderId);

    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const it of items) {
      insItem.run(orderId, it.product.id, it.product.name, it.qty, it.unit, it.unit * it.qty, ts);
      // خصم الكمية من المخزون إن كان المنتج يتتبع كمية
      if (it.product.stock_quantity !== null && it.product.stock_quantity !== undefined) {
        const remaining = it.product.stock_quantity - it.qty;
        db.prepare("UPDATE products SET stock_quantity = ?, stock_status = ?, updated_at = ? WHERE id = ?")
          .run(Math.max(0, remaining), remaining <= 0 ? "out_of_stock" : "in_stock", ts, it.product.id);
      }
    }
    // حفظ الصور المرجعية المرفقة بالطلب (تُفحص وتُخزَّن بأمان)
    const imagesSaved = saveOrderImages(orderId, body.images, ts);
    db.exec("COMMIT");
    sendJSON(res, 201, { ok: true, id: orderId, order_number: orderNumber, total_price, shipping, images_saved: imagesSaved });
  } catch (e) {
    console.error("order create error:", e.message);
    try { db.exec("ROLLBACK"); } catch {}
    sendJSON(res, 500, { error: "تعذّر حفظ الطلب — حاول مرة أخرى" });
  }
}

// ===== API الأدمن: الإحصائيات =====
function apiStats(req, res) {
  const oc = {};
  for (const s of ORDER_STATUSES) {
    oc[s] = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = ?").get(s).c;
  }
  const orders = {
    new: oc.new,
    following: FOLLOWING_STATUSES.reduce((s, k) => s + oc[k], 0),
    completed: oc.completed,
    cancelled: oc.cancelled,
    total: ORDER_STATUSES.reduce((s, k) => s + oc[k], 0),
  };

  const allProducts = db.prepare("SELECT * FROM products").all();
  const products = {
    available: allProducts.filter((p) => isOrderable(p)).length,
    unavailable: allProducts.filter((p) => !p.is_hidden && (p.product_status === "unavailable" || p.stock_status === "out_of_stock")).length,
    hidden: allProducts.filter((p) => p.is_hidden).length,
    offers: allProducts.filter((p) => offerActive(p)).length,
    total: allProducts.length,
  };

  const recent = db.prepare("SELECT * FROM orders ORDER BY datetime(created_at) DESC LIMIT 6").all();
  attachItemsSummary(recent);
  sendJSON(res, 200, { orders, products, recent });
}

function attachItemsSummary(orderRows) {
  if (!orderRows.length) return;
  const ids = orderRows.map((o) => o.id);
  const marks = ids.map(() => "?").join(",");
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${marks})`).all(...ids);
  const byOrder = {};
  for (const it of items) (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it);
  const imgCounts = db.prepare(`SELECT order_id, COUNT(*) AS c FROM order_images WHERE order_id IN (${marks}) GROUP BY order_id`).all(...ids);
  const countByOrder = {};
  for (const r of imgCounts) countByOrder[r.order_id] = r.c;
  for (const o of orderRows) {
    const list = byOrder[o.id] || [];
    o.items = list;
    o.products_summary = list.map((it) => `${it.product_name} × ${it.quantity}`).join("، ");
    o.images_count = countByOrder[o.id] || 0;
  }
}

// ===== API الأدمن: الطلبات =====
function apiListOrders(req, res, url) {
  const q = url.searchParams;
  const search = cleanStr(q.get("search") || "", 100);
  const status = cleanStr(q.get("status") || "", 30);
  const from = cleanStr(q.get("from") || "", 10);
  const to = cleanStr(q.get("to") || "", 10);

  const where = [];
  const params = [];
  if (search) {
    const clauses = ["customer_name LIKE ?", "phone LIKE ?", "order_number LIKE ?"];
    params.push(`%${search}%`, `%${search.replace(/\D/g, "") || search}%`, `%${search}%`);
    const numMatch = search.match(/^#?(?:MB-?)?(\d+)$/i);
    if (numMatch) {
      const n = Number(numMatch[1]);
      clauses.push("id = ?");
      params.push(n > 1000 ? n - 1000 : n);
    }
    where.push("(" + clauses.join(" OR ") + ")");
  }
  if (status && ORDER_STATUSES.includes(status)) {
    where.push("status = ?");
    params.push(status);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.push("date(created_at) >= ?");
    params.push(from);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push("date(created_at) <= ?");
    params.push(to);
  }
  const sql = "SELECT * FROM orders" + (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY datetime(created_at) DESC LIMIT 500";
  const rows = db.prepare(sql).all(...params);
  attachItemsSummary(rows);
  sendJSON(res, 200, { orders: rows });
}

function apiGetOrder(req, res, id) {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return sendJSON(res, 404, { error: "الطلب غير موجود" });
  attachItemsSummary([row]);
  row.images = db.prepare("SELECT id, path, orig_name, mime, size FROM order_images WHERE order_id = ? ORDER BY id ASC").all(id);
  sendJSON(res, 200, { order: row });
}

function apiUpdateOrder(req, res, id, body) {
  const row = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!row) return sendJSON(res, 404, { error: "الطلب غير موجود" });
  const sets = [];
  const params = [];
  if (body.status !== undefined) {
    if (!ORDER_STATUSES.includes(body.status)) return sendJSON(res, 400, { error: "حالة غير صالحة" });
    sets.push("status = ?");
    params.push(body.status);
  }
  if (body.internal_notes !== undefined) {
    sets.push("internal_notes = ?");
    params.push(cleanStr(body.internal_notes, 5000));
  }
  if (!sets.length) return sendJSON(res, 400, { error: "لا يوجد ما يتم تحديثه" });
  sets.push("updated_at = ?");
  params.push(nowISO(), id);
  db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  attachItemsSummary([updated]);
  sendJSON(res, 200, { ok: true, order: updated });
}

function apiDeleteOrder(req, res, id) {
  const row = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!row) return sendJSON(res, 404, { error: "الطلب غير موجود" });
  // حذف ملفات الصور المرفقة من القرص أولاً
  const imgs = db.prepare("SELECT path FROM order_images WHERE order_id = ?").all(id);
  for (const im of imgs) {
    try { fs.unlinkSync(path.join(ROOT, im.path)); } catch {}
  }
  db.prepare("DELETE FROM order_images WHERE order_id = ?").run(id);
  db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id);
  db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  sendJSON(res, 200, { ok: true });
}

// ===== API الأدمن: المنتجات =====
function adminProductJSON(p) {
  return {
    ...p,
    is_featured: !!p.is_featured,
    is_hidden: !!p.is_hidden,
    has_offer: !!p.has_offer,
    offer_active: offerActive(p),
    discount_percent: discountPercent(p),
    orderable: isOrderable(p),
  };
}

function apiAdminListProducts(req, res, url) {
  const q = url.searchParams;
  const search = cleanStr(q.get("search") || "", 100);
  const cat = cleanStr(q.get("cat") || "", 40);
  const filter = cleanStr(q.get("filter") || "", 30);

  const rows = db.prepare(`${PRODUCT_SELECT} ORDER BY p.sort_order ASC, p.id ASC`).all();
  let list = rows.map(adminProductJSON);
  if (search) list = list.filter((p) => (p.name || "").includes(search));
  if (cat && cat !== "all") list = list.filter((p) => p.category_key === cat);
  switch (filter) {
    case "available":    list = list.filter((p) => p.orderable); break;
    case "unavailable":  list = list.filter((p) => !p.is_hidden && p.product_status === "unavailable"); break;
    case "out_of_stock": list = list.filter((p) => !p.is_hidden && p.stock_status === "out_of_stock"); break;
    case "hidden":       list = list.filter((p) => p.is_hidden); break;
    case "offer":        list = list.filter((p) => p.offer_active); break;
    case "featured":     list = list.filter((p) => p.is_featured); break;
  }
  sendJSON(res, 200, { products: list });
}

function validateProductBody(body, partial = false) {
  const errors = [];
  const out = {};

  if (!partial || body.name !== undefined) {
    out.name = cleanStr(body.name, 150);
    if (!out.name || out.name.length < 2) errors.push("اسم المنتج مطلوب");
  }
  if (!partial || body.regular_price !== undefined) {
    out.regular_price = Number(body.regular_price);
    if (!(out.regular_price > 0)) errors.push("السعر الأساسي يجب أن يكون أكبر من صفر");
  }
  if (body.sale_price !== undefined) {
    out.sale_price = body.sale_price === null || body.sale_price === "" ? null : Number(body.sale_price);
    if (out.sale_price !== null && !(out.sale_price > 0)) errors.push("سعر العرض غير صالح");
  }
  if (body.image !== undefined) {
    out.image = cleanStr(body.image, 300);
    if (out.image && !/^images\/[\w\-./]+$/.test(out.image) && !/^https?:\/\//.test(out.image))
      errors.push("مسار الصورة غير صالح");
    if (!out.image) out.image = null;
  }
  if (body.short_description !== undefined) out.short_description = cleanStr(body.short_description, 300);
  if (body.description !== undefined) out.description = cleanStr(body.description, 3000);
  if (body.internal_notes !== undefined) out.internal_notes = cleanStr(body.internal_notes, 2000);
  if (body.category_id !== undefined) {
    out.category_id = Number(body.category_id) || null;
    if (out.category_id && !db.prepare("SELECT id FROM categories WHERE id = ?").get(out.category_id))
      errors.push("التصنيف غير موجود");
  }
  if (body.has_offer !== undefined) out.has_offer = toBool01(body.has_offer);
  if (body.offer_start_date !== undefined) {
    out.offer_start_date = cleanStr(body.offer_start_date, 10) || null;
    if (out.offer_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.offer_start_date)) errors.push("تاريخ بداية العرض غير صالح");
  }
  if (body.offer_end_date !== undefined) {
    out.offer_end_date = cleanStr(body.offer_end_date, 10) || null;
    if (out.offer_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.offer_end_date)) errors.push("تاريخ نهاية العرض غير صالح");
  }
  if (body.stock_quantity !== undefined) {
    out.stock_quantity = body.stock_quantity === null || body.stock_quantity === "" ? null : Math.max(0, Math.floor(Number(body.stock_quantity)));
    if (out.stock_quantity !== null && Number.isNaN(out.stock_quantity)) errors.push("الكمية غير صالحة");
  }
  if (body.stock_status !== undefined) {
    if (!STOCK_STATUSES.includes(body.stock_status)) errors.push("حالة المخزون غير صالحة");
    else out.stock_status = body.stock_status;
  }
  if (body.product_status !== undefined) {
    if (!PRODUCT_STATUSES.includes(body.product_status)) errors.push("حالة المنتج غير صالحة");
    else out.product_status = body.product_status;
  }
  if (body.is_featured !== undefined) out.is_featured = toBool01(body.is_featured);
  if (body.is_hidden !== undefined) out.is_hidden = toBool01(body.is_hidden);
  if (body.sort_order !== undefined) out.sort_order = Math.floor(Number(body.sort_order)) || 0;
  if (body.details !== undefined) {
    // مواصفات المنتج: مصفوفة أزواج [اسم، قيمة]
    if (Array.isArray(body.details)) {
      out.details_json = JSON.stringify(
        body.details.slice(0, 20).map((r) => [cleanStr(r && r[0], 60), cleanStr(r && r[1], 200)]).filter((r) => r[0])
      );
    } else out.details_json = "[]";
  }

  // منطق العرض: لو مفعّل لازم سعر عرض صالح
  if (out.has_offer === 1 && out.sale_price !== undefined && (out.sale_price === null || !(out.sale_price > 0)))
    errors.push("فعّلت العرض بدون سعر عرض صالح");

  return { out, errors };
}

function apiCreateProduct(req, res, body) {
  const { out, errors } = validateProductBody(body, false);
  if (errors.length) return sendJSON(res, 400, { error: errors.join("، ") });
  const ts = nowISO();
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM products").get().m;
  const info = db.prepare(`
    INSERT INTO products
    (name, slug, image, short_description, description, details_json, category_id,
     regular_price, sale_price, has_offer, offer_start_date, offer_end_date,
     stock_quantity, stock_status, product_status, is_featured, is_hidden, sort_order, internal_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      out.name, slugify(out.name), out.image || null, out.short_description || null, out.description || null,
      out.details_json || "[]", out.category_id || null,
      out.regular_price, out.sale_price !== undefined ? out.sale_price : null, out.has_offer || 0,
      out.offer_start_date || null, out.offer_end_date || null,
      out.stock_quantity !== undefined ? out.stock_quantity : null,
      out.stock_status || "in_stock", out.product_status || "available",
      out.is_featured || 0, out.is_hidden || 0,
      out.sort_order !== undefined ? out.sort_order : maxSort + 1,
      out.internal_notes || "", ts, ts
    );
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(Number(info.lastInsertRowid));
  exportProductsSnapshot();
  sendJSON(res, 201, { ok: true, product: adminProductJSON(row) });
}

function apiUpdateProduct(req, res, id, body) {
  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) return sendJSON(res, 404, { error: "المنتج غير موجود" });
  const { out, errors } = validateProductBody(body, true);
  if (errors.length) return sendJSON(res, 400, { error: errors.join("، ") });
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(out)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (out.name) {
    sets.push("slug = ?");
    params.push(slugify(out.name, id));
  }
  if (!sets.length) return sendJSON(res, 400, { error: "لا يوجد ما يتم تحديثه" });
  sets.push("updated_at = ?");
  params.push(nowISO(), id);
  db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  exportProductsSnapshot();
  sendJSON(res, 200, { ok: true, product: adminProductJSON(row) });
}

function apiDeleteProduct(req, res, id) {
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) return sendJSON(res, 404, { error: "المنتج غير موجود" });
  // عناصر الطلبات السابقة تحتفظ باسم المنتج (snapshot) فلا تتأثر بالحذف
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
  exportProductsSnapshot();
  sendJSON(res, 200, { ok: true });
}

function apiListCategories(req, res) {
  const rows = db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all();
  sendJSON(res, 200, { categories: rows });
}

// ===== API الأدمن: رفع صورة =====
function apiUploadImage(req, res, body) {
  const data = typeof body.data === "string" ? body.data : "";
  const m = data.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return sendJSON(res, 400, { error: "صيغة الصورة غير مدعومة — استخدم PNG أو JPG أو WEBP" });
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 3 * 1024 * 1024) return sendJSON(res, 400, { error: "حجم الصورة أكبر من 3 ميجابايت" });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const fileName = `p_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);
  sendJSON(res, 201, { ok: true, path: `images/uploads/${fileName}` });
}

// ===== API الأدمن: الإعدادات =====
function apiGetSettings(req, res) {
  sendJSON(res, 200, {
    whatsapp_order_enabled: getSetting("whatsapp_order_enabled") === "1",
    shipping_fee: Number(getSetting("shipping_fee", "50")),
    store_phone: getSetting("store_phone", ""),
  });
}
function apiUpdateSettings(req, res, body) {
  if (body.whatsapp_order_enabled !== undefined)
    setSetting("whatsapp_order_enabled", toBool01(body.whatsapp_order_enabled) ? "1" : "0");
  if (body.shipping_fee !== undefined) {
    const fee = Number(body.shipping_fee);
    if (!(fee >= 0)) return sendJSON(res, 400, { error: "مصاريف الشحن غير صالحة" });
    setSetting("shipping_fee", String(fee));
  }
  if (body.store_phone !== undefined) {
    const ph = normalizePhone(body.store_phone);
    if (!/^[0-9]{10,15}$/.test(ph)) return sendJSON(res, 400, { error: "رقم واتساب المتجر غير صحيح" });
    setSetting("store_phone", ph);
  }
  exportProductsSnapshot();
  apiGetSettings(req, res);
}

// ===== الدخول والخروج =====
async function apiLogin(req, res, body) {
  const ip = req.socket.remoteAddress || "?";
  if (loginLimiter(ip))
    return sendJSON(res, 429, { error: "محاولات كثيرة — انتظر 10 دقائق ثم أعد المحاولة" });
  const username = cleanStr(body.username, 60);
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  const stored = getSetting("admin_password");
  if (username !== ADMIN_USERNAME || !stored || !verifyPassword(password, stored)) {
    return sendJSON(res, 401, { error: "اسم المستخدم أو كلمة السر غير صحيحة" });
  }
  const token = createSession(username);
  res.setHeader("Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
  sendJSON(res, 200, { ok: true, username });
}
function apiLogout(req, res) {
  destroySession(req);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  sendJSON(res, 200, { ok: true });
}

// ===== تقديم الملفات الثابتة =====
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const relNorm = path.relative(ROOT, filePath).replace(/\\/g, "/");
  if (relNorm.startsWith("data/") || relNorm === "server.js" || relNorm === "package.json" ||
      relNorm.endsWith(".db") || relNorm.endsWith(".bat")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext]) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not Found");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }
    res.writeHead(200, { "Content-Type": MIME[ext], "X-Content-Type-Options": "nosniff" });
    res.end(data);
  });
}

// ===== الراوتر الرئيسي =====
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    // ---------- API عام ----------
    if (pathname === "/api/products" && req.method === "GET") return apiPublicProducts(req, res, url);
    const pubProdMatch = pathname.match(/^\/api\/products\/(\d+)$/);
    if (pubProdMatch && req.method === "GET") return apiPublicProduct(req, res, Number(pubProdMatch[1]));
    if (pathname === "/api/settings/public" && req.method === "GET") return apiPublicSettings(req, res);
    if (pathname === "/api/orders" && req.method === "POST") {
      const body = await readBody(req, 30 * 1024 * 1024); // مساحة كافية للصور المرفقة
      return apiCreateOrder(req, res, body);
    }

    // ---------- دخول / خروج ----------
    if (pathname === "/api/admin/login" && req.method === "POST") {
      const body = await readBody(req);
      return apiLogin(req, res, body);
    }
    if (pathname === "/api/admin/logout" && req.method === "POST") return apiLogout(req, res);

    // ---------- API الأدمن (جلسة مطلوبة) ----------
    if (pathname.startsWith("/api/admin/")) {
      const session = getSession(req);
      if (!session) return sendJSON(res, 401, { error: "غير مصرح — سجّل الدخول أولاً" });

      if (pathname === "/api/admin/me" && req.method === "GET")
        return sendJSON(res, 200, { ok: true, username: session.username });
      if (pathname === "/api/admin/stats" && req.method === "GET") return apiStats(req, res);
      if (pathname === "/api/admin/categories" && req.method === "GET") return apiListCategories(req, res);

      if (pathname === "/api/admin/settings") {
        if (req.method === "GET") return apiGetSettings(req, res);
        if (req.method === "PATCH") {
          const body = await readBody(req);
          return apiUpdateSettings(req, res, body);
        }
      }

      if (pathname === "/api/admin/upload" && req.method === "POST") {
        const body = await readBody(req, 5 * 1024 * 1024);
        return apiUploadImage(req, res, body);
      }

      if (pathname === "/api/admin/orders" && req.method === "GET") return apiListOrders(req, res, url);
      const orderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
      if (orderMatch) {
        const id = Number(orderMatch[1]);
        if (req.method === "GET") return apiGetOrder(req, res, id);
        if (req.method === "PATCH") {
          const body = await readBody(req);
          return apiUpdateOrder(req, res, id, body);
        }
        if (req.method === "DELETE") return apiDeleteOrder(req, res, id);
      }

      if (pathname === "/api/admin/products") {
        if (req.method === "GET") return apiAdminListProducts(req, res, url);
        if (req.method === "POST") {
          const body = await readBody(req);
          return apiCreateProduct(req, res, body);
        }
      }
      const prodMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
      if (prodMatch) {
        const id = Number(prodMatch[1]);
        if (req.method === "PATCH") {
          const body = await readBody(req);
          return apiUpdateProduct(req, res, id, body);
        }
        if (req.method === "DELETE") return apiDeleteProduct(req, res, id);
      }
      return sendJSON(res, 404, { error: "غير موجود" });
    }

    // ---------- حماية صفحات الأدمن ----------
    if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/index.html") {
      const session = getSession(req);
      res.writeHead(302, { Location: session ? "/admin/dashboard.html" : "/admin/login.html" });
      return res.end();
    }
    if (pathname === "/admin/dashboard.html" && !getSession(req)) {
      res.writeHead(302, { Location: "/admin/login.html" });
      return res.end();
    }
    if (pathname === "/admin/login.html" && getSession(req)) {
      res.writeHead(302, { Location: "/admin/dashboard.html" });
      return res.end();
    }

    // ---------- ملفات الموقع ----------
    if (req.method === "GET") return serveStatic(req, res, pathname);

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
  } catch (err) {
    sendJSON(res, err.message === "payload too large" ? 413 : 400, { error: "طلب غير صالح" });
  }
});

exportProductsSnapshot();

server.listen(PORT, () => {
  console.log("");
  console.log("🛍️  MY BOX STORE v2 يعمل الآن:");
  console.log(`    المتجر:        http://localhost:${PORT}`);
  console.log(`    لوحة التحكم:   http://localhost:${PORT}/admin`);
  console.log("");
});
