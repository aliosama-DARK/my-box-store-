// مصادقة الأدمن: تجزئة كلمة السر + جلسة موقّعة بالكوكيز (بدون حالة على الخادم)
const crypto = require("crypto");

const COOKIE = "mbs_admin";
const SESSION_DAYS = 7;

function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not configured");
  return s;
}

// ===== كلمة السر (scrypt) =====
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return check.length === expected.length && crypto.timingSafeEqual(check, expected);
}

// ===== الجلسة الموقّعة =====
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${mac}`;
}
function verifySession(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", getSecret()).update(body).digest());
  const a = Buffer.from(mac || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString("utf8")); } catch { return null; }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

// ===== الكوكيز =====
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 86400;
  res.setHeader("Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`);
}
function createSessionToken(admin) {
  return signSession({ sub: admin.id, email: admin.email, name: admin.name, exp: Date.now() + SESSION_DAYS * 86400000 });
}
function getAdmin(req) {
  return verifySession(parseCookies(req)[COOKIE]);
}
// يعيد الجلسة أو يرسل 401 ويعيد null
function requireAdmin(req, res) {
  const a = getAdmin(req);
  if (!a) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "غير مصرح — سجّل الدخول أولاً" }));
    return null;
  }
  return a;
}

module.exports = {
  hashPassword, verifyPassword, createSessionToken, getAdmin, requireAdmin,
  setSessionCookie, clearSessionCookie, SESSION_DAYS,
};
