// تشغيل الترحيل والبذور يدويًا:  node --env-file=.env.local scripts/migrate.js
const { ensureSchema, getSql } = require("../api/_lib/db");

(async () => {
  try {
    await ensureSchema();
    const sql = getSql();
    const p = (await sql`SELECT COUNT(*)::int AS c FROM products`)[0].c;
    const c = (await sql`SELECT COUNT(*)::int AS c FROM categories`)[0].c;
    const a = (await sql`SELECT COUNT(*)::int AS c FROM admins`)[0].c;
    console.log(`✅ migration OK — products:${p} categories:${c} admins:${a}`);
    process.exit(0);
  } catch (e) {
    console.error("❌ migration failed:", e.message);
    process.exit(1);
  }
})();
