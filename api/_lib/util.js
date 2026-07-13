// أدوات مساعدة مشتركة لدوال الـ API (CommonJS)

const CTRL_RE = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

function cleanStr(v, max = 500) {
  if (typeof v !== "string") return "";
  return v.replace(CTRL_RE, "").trim().slice(0, max);
}

function sendJSON(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(obj));
}

// قراءة جسم الطلب JSON (يدعم req.body المُحلَّل مسبقًا من Vercel أو التدفّق الخام)
function readJson(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string") {
        try { resolve(req.body ? JSON.parse(req.body) : {}); }
        catch { reject(new Error("invalid json")); }
      } else {
        resolve(req.body);
      }
      return;
    }
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("invalid json")); }
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

function slugify(name, id) {
  const s = String(name || "").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return s || `item-${id || "x"}`;
}

function toBool(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

// حدّ معدّل بسيط داخل نفس نسخة الدالة (best-effort في بيئة serverless)
function makeRateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now >= rec.resetAt) { hits.set(key, { count: 1, resetAt: now + windowMs }); return false; }
    rec.count++;
    return rec.count > max;
  };
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "?";
}

module.exports = { cleanStr, sendJSON, readJson, normalizePhone, slugify, toBool, makeRateLimiter, clientIp };
