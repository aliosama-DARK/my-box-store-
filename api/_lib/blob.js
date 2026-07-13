// رفع الصور إلى Vercel Blob + التحقق الأمني من نوع الملف الحقيقي
const { put, del } = require("@vercel/blob");
const crypto = require("crypto");

const IMG = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

// فحص التوقيع الفعلي للملف (magic bytes) — لا يُعتمد على الامتداد
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP")
    return { ext: "webp", mime: "image/webp" };
  return null;
}

// يفكّ data URL لصورة ويتحقق من النوع والحجم الحقيقيين
function decodeImageDataURL(dataURL, maxBytes = 8 * 1024 * 1024) {
  if (typeof dataURL !== "string") return null;
  const m = dataURL.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > maxBytes) return null;
  const kind = sniffImage(buf);
  if (!kind) return null;
  return { buf, ext: kind.ext, mime: kind.mime };
}

async function uploadImageBuffer(buf, ext, mime, folder = "misc") {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "misc";
  const name = `${safeFolder}/${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const result = await put(name, buf, {
    access: "public",
    token,
    contentType: mime,
    addRandomSuffix: true,
    cacheControlMaxAge: 31536000,
  });
  return { url: result.url, pathname: result.pathname, mime, size: buf.length };
}

async function deleteByUrl(url) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || !url) return;
  try { await del(url, { token }); } catch (_) {}
}

module.exports = { sniffImage, decodeImageDataURL, uploadImageBuffer, deleteByUrl, IMG };
