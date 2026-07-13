// رفع صورة مرجعية واحدة للعميل (قبل إتمام الطلب) — تُخزَّن في Blob وتُعاد بياناتها
const { ensureSchema } = require("../_lib/db");
const { sendJSON, readJson, makeRateLimiter, clientIp, cleanStr } = require("../_lib/util");
const { decodeImageDataURL, uploadImageBuffer } = require("../_lib/blob");

const limiter = makeRateLimiter(60, 10 * 60 * 1000); // 60 صورة/10 دقائق لكل IP

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJSON(res, 405, { error: "method not allowed" });
  if (limiter(clientIp(req))) return sendJSON(res, 429, { error: "محاولات كثيرة — انتظر قليلاً" });
  try {
    await ensureSchema();
    const body = await readJson(req, 4 * 1024 * 1024);
    const dec = decodeImageDataURL(body.data, 4 * 1024 * 1024);
    if (!dec) return sendJSON(res, 400, { error: "صيغة الصورة غير مدعومة أو حجمها كبير (JPG/PNG/WebP، حتى ~3.5MB)" });
    const origName = cleanStr(body.name || "", 120) || `reference.${dec.ext}`;
    const up = await uploadImageBuffer(dec.buf, dec.ext, dec.mime, "orders");
    sendJSON(res, 201, { ok: true, url: up.url, pathname: up.pathname, mime: up.mime, size: up.size, name: origName });
  } catch (e) {
    sendJSON(res, e.message === "payload too large" ? 413 : 500, { error: "تعذّر رفع الصورة — حاول مرة أخرى" });
  }
};
