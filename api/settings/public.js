const { ensureSchema, getSetting } = require("../_lib/db");
const { sendJSON } = require("../_lib/util");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });
  try {
    await ensureSchema();
    sendJSON(res, 200, {
      whatsapp_order_enabled: (await getSetting("whatsapp_order_enabled", "1")) === "1",
      shipping_fee: Number(await getSetting("shipping_fee", "50")),
      store_phone: await getSetting("store_phone", ""),
    });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر تحميل الإعدادات" });
  }
};
