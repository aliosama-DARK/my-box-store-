const { ensureSchema, getSetting, listShippingZones } = require("../_lib/db");
const { sendJSON } = require("../_lib/util");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendJSON(res, 405, { error: "method not allowed" });
  try {
    await ensureSchema();
    const zones = await listShippingZones(true);
    sendJSON(res, 200, {
      whatsapp_order_enabled: (await getSetting("whatsapp_order_enabled", "1")) === "1",
      shipping_fee: Number(await getSetting("shipping_fee", "50")),
      store_phone: await getSetting("store_phone", ""),
      content: {
        store_name: await getSetting("store_name", "MY BOX STORE"),
        facebook: await getSetting("contact_facebook", "https://www.facebook.com/profile.php?id=61563896937276"),
        instagram: await getSetting("contact_instagram", ""),
        address: await getSetting("contact_address", "مصر"),
        footer_about: await getSetting("footer_about", "متجرك المتخصص في الطباعة والهدايا المخصصة. نطبع لك تصميمك على الدروع والشهادات والتيشيرتات والمجات بأعلى جودة."),
      },
      shipping_zones: zones.map((z) => ({
        name: z.name,
        fee: Number(z.fee),
        delivery_time: z.delivery_time,
        free_threshold: z.free_threshold == null ? null : Number(z.free_threshold),
        notes: z.notes || "",
      })),
    });
  } catch (e) {
    sendJSON(res, 500, { error: "تعذّر تحميل الإعدادات" });
  }
};
