// اتصال قاعدة البيانات (Neon Postgres) + إنشاء الجداول والبيانات الأولية
const { neon, neonConfig, Pool } = require("@neondatabase/serverless");
const { hashPassword } = require("./auth");

// دعم WebSocket لعمليات المعاملات (transactions) على Node إن لم يكن متاحًا عالميًا
if (typeof WebSocket === "undefined") {
  try { neonConfig.webSocketConstructor = require("ws"); } catch (_) {}
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

let _sql = null;
function getSql() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!_sql) _sql = neon(DATABASE_URL);
  return _sql;
}
function getPool() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return new Pool({ connectionString: DATABASE_URL });
}

const SEED_PRODUCTS = [
  { name: "درع زجاجي — شهادة تميز", cat: "awards", image: "images/award-shield.png",
    short: "درع زجاجي كريستالي فاخر بقاعدة خشبية، محفور بالليزر بتصميمك.",
    full: "درع زجاجي كريستالي فاخر بقاعدة خشبية، محفور بالليزر بتصميمك أو شعارك أو نص خاص. الاختيار الأمثل لتكريم الموظفين، حفلات التخرج، المسابقات، والمناسبات الرسمية.",
    price: 450, sale: 350, featured: true,
    specs: [["الخامة", "زجاج كريستال + قاعدة خشب طبيعي"], ["المقاس", "حوالي 20 × 15 سم"], ["التخصيص", "نقش الاسم / الشعار / النص + لوحة ذهبية"], ["مدة التنفيذ", "2 – 4 أيام عمل"]] },
  { name: "شهادة تقدير بإطار خشبي", cat: "certificates", image: "images/certificate-frame.png",
    short: "شهادة تقدير مطبوعة بجودة عالية داخل إطار خشبي أنيق.",
    full: "شهادة تقدير مطبوعة بجودة عالية داخل إطار خشبي أنيق بحواف ذهبية وختم مميز. مناسبة للتكريم والإهداء في المناسبات الرسمية والمدارس والشركات.",
    price: 220, sale: null, featured: false,
    specs: [["الخامة", "ورق فاخر + إطار خشبي"], ["المقاس", "A4 مع الإطار"], ["التخصيص", "الاسم / النص / المناسبة / الشعار"], ["مدة التنفيذ", "1 – 3 أيام عمل"]] },
  { name: "تيشيرت مطبوع مخصص", cat: "prints", image: "images/tshirt-print.png",
    short: "تيشيرت قطن عالي الجودة بطباعة احترافية ثابتة لا تبهت.",
    full: "تيشيرت قطن عالي الجودة بطباعة احترافية ثابتة لا تبهت مع الغسيل. اطبع تصميمك أو اسمك أو شعارك على الأمام والخلف. متوفر بكل المقاسات وعدة ألوان.",
    price: 320, sale: 250, featured: false,
    specs: [["الخامة", "قطن 100%"], ["المقاسات", "S / M / L / XL / XXL"], ["التخصيص", "طباعة أمامية وخلفية بتصميمك"], ["مدة التنفيذ", "2 – 4 أيام عمل"]] },
  { name: "مج مطبوع مخصص", cat: "prints", image: "images/mug-print.png",
    short: "مج سيراميك بطباعة بانورامية عالية الجودة بصورتك أو تصميمك.",
    full: "مج سيراميك بطباعة بانورامية عالية الجودة. اطبع صورتك أو اسمك أو أي تصميم تحبه — هدية مميزة وعملية لكل المناسبات وأعياد الميلاد.",
    price: 160, sale: 120, featured: false,
    specs: [["الخامة", "سيراميك عالي الجودة"], ["السعة", "330 مل"], ["التخصيص", "طباعة بانورامية بصورتك / تصميمك"], ["مدة التنفيذ", "1 – 3 أيام عمل"]] },
];

let _schemaPromise = null;
function ensureSchema() {
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, slug TEXT, description TEXT, image TEXT,
      display_order INT NOT NULL DEFAULT 0, is_visible BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, category_id INT REFERENCES categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL, slug TEXT, short_description TEXT, full_description TEXT,
      price NUMERIC NOT NULL DEFAULT 0, sale_price NUMERIC, offer_start_date DATE, offer_end_date DATE,
      stock_status TEXT NOT NULL DEFAULT 'in_stock', quantity INT,
      images JSONB NOT NULL DEFAULT '[]'::jsonb, specifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      variations JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_visible BOOLEAN NOT NULL DEFAULT true, is_featured BOOLEAN NOT NULL DEFAULT false,
      internal_notes TEXT DEFAULT '', display_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, order_number TEXT UNIQUE, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
      email TEXT, city TEXT, address TEXT, customer_notes TEXT, printing_instructions TEXT,
      subtotal NUMERIC NOT NULL DEFAULT 0, delivery_cost NUMERIC NOT NULL DEFAULT 0,
      discount NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cod', payment_status TEXT NOT NULL DEFAULT 'unpaid',
      status TEXT NOT NULL DEFAULT 'new', source TEXT NOT NULL DEFAULT 'website', internal_notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT, product_name TEXT NOT NULL, variation TEXT,
      quantity INT NOT NULL, unit_price NUMERIC NOT NULL, total_price NUMERIC NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS order_attachments (
      id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      original_filename TEXT, storage_path TEXT NOT NULL, url TEXT NOT NULL,
      mime_type TEXT, file_size INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_att_order ON order_attachments(order_id)`;

    // إعدادات افتراضية
    await sql`INSERT INTO settings (key, value) VALUES ('shipping_fee','50') ON CONFLICT (key) DO NOTHING`;
    await sql`INSERT INTO settings (key, value) VALUES ('store_phone','201032543968') ON CONFLICT (key) DO NOTHING`;
    await sql`INSERT INTO settings (key, value) VALUES ('whatsapp_order_enabled','1') ON CONFLICT (key) DO NOTHING`;

    // الفئات الأولية
    const catCount = (await sql`SELECT COUNT(*)::int AS c FROM categories`)[0].c;
    if (catCount === 0) {
      await sql`INSERT INTO categories (key,name,slug,display_order) VALUES
        ('awards','دروع وتذكارات','awards',1),
        ('certificates','شهادات','certificates',2),
        ('prints','مطبوعات','prints',3)`;
    }

    // المنتجات الأولية
    const prodCount = (await sql`SELECT COUNT(*)::int AS c FROM products`)[0].c;
    if (prodCount === 0) {
      const cats = await sql`SELECT id, key FROM categories`;
      const catId = (k) => (cats.find((c) => c.key === k) || {}).id || null;
      let order = 1;
      for (const p of SEED_PRODUCTS) {
        await sql`INSERT INTO products
          (category_id,name,slug,short_description,full_description,price,sale_price,
           images,specifications,is_featured,display_order,created_at,updated_at)
          VALUES (${catId(p.cat)}, ${p.name}, ${slugifyLite(p.name)}, ${p.short}, ${p.full},
           ${p.price}, ${p.sale}, ${JSON.stringify([p.image])}::jsonb, ${JSON.stringify(p.specs)}::jsonb,
           ${p.featured}, ${order++}, now(), now())`;
      }
    }

    // حساب الأدمن (من متغيّرات البيئة فقط — لا يُخزَّن في الكود)
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const pass = process.env.ADMIN_PASSWORD || "";
    if (email && pass.length >= 8) {
      const exists = (await sql`SELECT id FROM admins WHERE email = ${email}`)[0];
      if (!exists) {
        await sql`INSERT INTO admins (name,email,password_hash,role,created_at,updated_at)
          VALUES (${process.env.ADMIN_NAME || "المدير"}, ${email}, ${hashPassword(pass)}, 'admin', now(), now())`;
      }
    }
  })().catch((e) => { _schemaPromise = null; throw e; });
  return _schemaPromise;
}

function slugifyLite(name) {
  return String(name || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// إعدادات
async function getSetting(key, fallback = null) {
  const sql = getSql();
  const row = (await sql`SELECT value FROM settings WHERE key = ${key}`)[0];
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  const sql = getSql();
  await sql`INSERT INTO settings (key,value) VALUES (${key}, ${String(value)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

module.exports = { getSql, getPool, ensureSchema, getSetting, setSetting };
