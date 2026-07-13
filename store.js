/* ====================================================
   MY BOX STORE — Printing & Gifts (v2)
   المنتجات تُجلب من قاعدة البيانات عبر API
   الطلب يتم من الموقع ويُحفظ في لوحة التحكم — بدون فتح واتساب تلقائياً
   ==================================================== */

const CART_KEY = "myboxstore_cart";

// ===== حالة المتجر (تُجلب من السيرفر) =====
let PRODUCTS = [];
let SETTINGS = { whatsapp_order_enabled: false, shipping_fee: 50, store_phone: "" };
let STATIC_MODE = false; // استضافة ثابتة (GitHub Pages): منتجات من snapshot + طلب واتساب
let _storeLoaded = null;

function loadStore() {
  if (_storeLoaded) return _storeLoaded;
  _storeLoaded = Promise.all([
    fetch("api/products").then((r) => r.json()),
    fetch("api/settings/public").then((r) => r.json()),
  ])
    .then(([prodData, settings]) => {
      PRODUCTS = prodData.products || [];
      SETTINGS = { ...SETTINGS, ...settings };
    })
    .catch(async () => {
      // لا يوجد سيرفر (استضافة ثابتة) → منتجات من الملف المُصدَّر والطلب عبر واتساب
      STATIC_MODE = true;
      SETTINGS = { whatsapp_order_enabled: true, shipping_fee: 50, store_phone: "201032543968" };
      try {
        const r = await fetch("products.json");
        const d = await r.json();
        PRODUCTS = d.products || [];
        if (d.settings) SETTINGS = { ...SETTINGS, ...d.settings, whatsapp_order_enabled: true };
      } catch {
        PRODUCTS = [];
      }
    });
  return _storeLoaded;
}

function escapeHTML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== أدوات السلة =====
function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function cartTotalItems() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}

function updateCartCount() {
  const count = cartTotalItems();
  document.querySelectorAll(".cart-count").forEach((el) => {
    el.textContent = count;
    el.style.display = count > 0 ? "inline-flex" : "none";
  });
}

function addToCart(productId, qty = 1) {
  const p = PRODUCTS.find((x) => x.id === productId);
  if (p && !p.orderable) {
    showToast("⚠️ هذا المنتج غير متوفر حاليًا");
    return;
  }
  const cart = getCart();
  const existing = cart.find((i) => i.id === productId);
  if (existing) existing.qty += qty;
  else cart.push({ id: productId, qty });
  saveCart(cart);
  if (p) showToast(`✅ تمت إضافة "${p.name}" للسلة`);
}

function changeQty(productId, delta) {
  const cart = getCart();
  const item = cart.find((i) => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeFromCart(productId);
    return;
  }
  saveCart(cart);
  renderCart();
}

function removeFromCart(productId) {
  saveCart(getCart().filter((i) => i.id !== productId));
  renderCart();
}

function formatPrice(n) {
  return Number(n).toLocaleString("ar-EG") + " ج.م";
}

// ===== التوست =====
let toastTimer;
function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// ===== رسم بطاقة منتج =====
function priceHTML(p) {
  if (p.offer_active) {
    return `<small>${formatPrice(p.regular_price)}</small>${formatPrice(p.sale_price)}`;
  }
  return formatPrice(p.regular_price);
}

function productCardHTML(p) {
  let badge = "";
  if (p.offer_active) badge = `<span class="product-badge badge-offer">خصم ${p.discount_percent}%</span>`;
  else if (p.is_featured) badge = `<span class="product-badge">⭐ مميز</span>`;

  const unavailable = !p.orderable
    ? `<span class="unavailable-overlay">${escapeHTML(p.availability_label || "غير متوفر حاليًا")}</span>`
    : "";

  // البطاقة كلها رابط لصفحة التفاصيل — لا إضافة مباشرة للسلة من هنا (§7)
  const href = `product.html?id=${p.id}`;
  return `
    <a class="product-card ${p.orderable ? "" : "is-unavailable"}" href="${href}" data-cat="${escapeHTML(p.category_key || "")}">
      <span class="product-img">
        <img src="${escapeHTML(p.image || "images/logo.jpeg")}" alt="${escapeHTML(p.name)}" loading="lazy" />
        ${badge}
        ${unavailable}
      </span>
      <span class="product-body">
        <span class="product-cat">${escapeHTML(p.category_name || "")}</span>
        <span class="product-name">${escapeHTML(p.name)}</span>
        <span class="product-footer">
          <span class="product-price">${priceHTML(p)}</span>
        </span>
        <span class="btn-details">عرض التفاصيل ←</span>
      </span>
    </a>`;
}

// ===== رسم شبكة المنتجات =====
async function renderProducts(filter = "all", containerId = "productsGrid", limit = null) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px;">جارٍ تحميل المنتجات...</p>`;
  await loadStore();

  let list;
  if (filter === "offers") list = PRODUCTS.filter((p) => p.offer_active);
  else if (filter === "all") list = PRODUCTS;
  else list = PRODUCTS.filter((p) => p.category_key === filter);
  if (limit) list = list.slice(0, limit);

  if (list.length === 0) {
    grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px;">${
      filter === "offers" ? "لا توجد عروض حالياً — تابعنا قريباً 🔥" : "لا توجد منتجات في هذه الفئة حالياً."
    }</p>`;
    return;
  }
  grid.innerHTML = list.map(productCardHTML).join("");
  bindAddButtons();
}

function bindAddButtons() {
  document.querySelectorAll(".add-btn:not(.disabled)").forEach((btn) => {
    btn.onclick = () => {
      addToCart(Number(btn.dataset.id));
      const original = btn.textContent;
      btn.textContent = "✓ تمت الإضافة";
      btn.classList.add("added");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("added");
      }, 1300);
    };
  });
}

// ===== صفحة تفاصيل المنتج =====
async function renderProductDetail() {
  const wrap = document.getElementById("productDetail");
  if (!wrap) return;
  wrap.innerHTML = `<p style="text-align:center;color:var(--muted);padding:60px;">جارٍ التحميل...</p>`;
  await loadStore();

  const id = Number(new URLSearchParams(location.search).get("id"));
  const p = PRODUCTS.find((x) => x.id === id);

  if (!p) {
    wrap.innerHTML = `
      <div class="empty-cart">
        <div class="emoji">🔍</div>
        <h3>المنتج غير موجود</h3>
        <a href="products.html" class="btn btn-primary">رجوع للمنتجات</a>
      </div>`;
    return;
  }

  document.title = `${p.name} — MY BOX STORE`;
  let badge = "";
  if (p.offer_active) badge = `<span class="product-badge badge-offer" style="position:static;display:inline-block;margin-bottom:10px;">خصم ${p.discount_percent}%</span>`;
  else if (p.is_featured) badge = `<span class="product-badge" style="position:static;display:inline-block;margin-bottom:10px;">⭐ مميز</span>`;

  const priceBlock = p.offer_active
    ? `<div class="detail-price"><small>${formatPrice(p.regular_price)}</small>${formatPrice(p.sale_price)} <span class="discount-chip">وفّرت ${p.discount_percent}%</span></div>`
    : `<div class="detail-price">${formatPrice(p.regular_price)}</div>`;

  const orderControls = p.orderable
    ? `
      <div class="detail-actions">
        <div class="qty-control">
          <button onclick="detailQty(-1)">−</button>
          <span id="detailQtyVal">1</span>
          <button onclick="detailQty(1)">+</button>
        </div>
        <button class="btn btn-primary" onclick="addToCart(${p.id}, getDetailQty())">أضف للسلة 🛒</button>
      </div>
      ${SETTINGS.whatsapp_order_enabled
        ? `<button class="btn btn-whatsapp" style="width:100%;margin-top:14px;" onclick="orderSingleViaWhatsApp(${p.id})">💬 أو اطلب هذا المنتج عبر واتساب (اختياري)</button>`
        : ""}`
    : `<div class="unavailable-banner">🚫 ${escapeHTML(p.availability_label || "غير متوفر حاليًا")} — تابعنا وسيعود قريباً</div>`;

  wrap.innerHTML = `
    <nav class="breadcrumb">
      <a href="index.html">الرئيسية</a> ‹
      <a href="products.html">المنتجات</a> ‹
      <span>${escapeHTML(p.name)}</span>
    </nav>
    <div class="detail-grid">
      <div class="detail-img">
        <img src="${escapeHTML(p.image || "images/logo.jpeg")}" alt="${escapeHTML(p.name)}" />
      </div>
      <div class="detail-info">
        ${badge}
        <span class="product-cat">${escapeHTML(p.category_name || "")}</span>
        <h1>${escapeHTML(p.name)}</h1>
        ${priceBlock}
        <p class="detail-desc">${escapeHTML(p.description || p.short_description || "")}</p>

        ${p.details && p.details.length
          ? `<table class="detail-specs">
              ${p.details.map((row) => `<tr><th>${escapeHTML(row[0])}</th><td>${escapeHTML(row[1])}</td></tr>`).join("")}
            </table>`
          : ""}

        ${orderControls}

        <div class="detail-note">💡 كل منتجاتنا قابلة للتخصيص — هتقدر تبعتلنا تصميمك أو اسمك بعد الطلب.</div>
      </div>
    </div>`;
}

async function renderRelated(containerId = "relatedGrid") {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  await loadStore();
  const curId = Number(new URLSearchParams(location.search).get("id"));
  const related = PRODUCTS.filter((p) => p.id !== curId).slice(0, 4);
  grid.innerHTML = related.map(productCardHTML).join("");
  bindAddButtons();
}

let _detailQty = 1;
function detailQty(delta) {
  _detailQty = Math.max(1, _detailQty + delta);
  const el = document.getElementById("detailQtyVal");
  if (el) el.textContent = _detailQty;
}
function getDetailQty() {
  return _detailQty;
}

// ===== الطلب الاختياري عبر واتساب (يظهر فقط لو مفعّل من لوحة التحكم) =====
function orderSingleViaWhatsApp(id) {
  if (!SETTINGS.whatsapp_order_enabled || !SETTINGS.store_phone) return;
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  const qty = getDetailQty();
  const msg =
    `السلام عليكم، حابب أطلب من MY BOX STORE:\n\n` +
    `${p.name} × ${qty} = ${formatPrice(p.price * qty)}\n\n` +
    `حابب أعرف تفاصيل التخصيص والتوصيل.`;
  window.open(`https://wa.me/${SETTINGS.store_phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

function orderCartViaWhatsApp() {
  if (!SETTINGS.whatsapp_order_enabled || !SETTINGS.store_phone) return;
  const detailed = cartDetailed().filter((p) => p.orderable);
  if (detailed.length === 0) return;
  const subtotal = detailed.reduce((s, p) => s + p.price * p.qty, 0);
  const total = subtotal + SETTINGS.shipping_fee;
  let msg = "السلام عليكم، حابب أطلب من MY BOX STORE:\n\n";
  detailed.forEach((p, i) => {
    msg += `${i + 1}- ${p.name} × ${p.qty} = ${formatPrice(p.price * p.qty)}\n`;
  });
  msg += `\nالشحن: ${formatPrice(SETTINGS.shipping_fee)}\nالإجمالي: ${formatPrice(total)}`;
  window.open(`https://wa.me/${SETTINGS.store_phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ===== صفحة السلة =====
function cartDetailed() {
  return getCart()
    .map((item) => {
      const p = PRODUCTS.find((x) => x.id === item.id);
      return p ? { ...p, qty: item.qty } : null;
    })
    .filter(Boolean);
}

async function renderCart() {
  const wrap = document.getElementById("cartWrap");
  if (!wrap) return;
  wrap.innerHTML = `<p style="text-align:center;color:var(--muted);padding:60px;">جارٍ التحميل...</p>`;
  await loadStore();

  const cart = getCart();
  if (cart.length === 0) {
    wrap.innerHTML = `
      <div class="empty-cart">
        <div class="emoji">🛒</div>
        <h3>سلتك فاضية</h3>
        <p>لسه ماضفتش أي منتج للسلة. اكتشف تشكيلتنا واختار اللي يعجبك!</p>
        <a href="products.html" class="btn btn-primary">تسوّق دلوقتي</a>
      </div>`;
    return;
  }

  const detailed = cartDetailed();
  const orderable = detailed.filter((p) => p.orderable);
  const blocked = detailed.filter((p) => !p.orderable);

  const subtotal = orderable.reduce((s, p) => s + p.price * p.qty, 0);
  const total = subtotal + SETTINGS.shipping_fee;

  wrap.innerHTML = `
    <div class="cart-page">
      <div class="cart-items">
        ${detailed
          .map(
            (p) => `
          <div class="cart-item ${p.orderable ? "" : "is-unavailable"}">
            <div class="cart-item-img"><img src="${escapeHTML(p.image || "images/logo.jpeg")}" alt="${escapeHTML(p.name)}" /></div>
            <div class="cart-item-info">
              <h4>${escapeHTML(p.name)}</h4>
              ${p.orderable
                ? `<span class="price">${p.offer_active ? `<small style="text-decoration:line-through;color:var(--muted);">${formatPrice(p.regular_price)}</small> ` : ""}${formatPrice(p.price)}</span>`
                : `<span class="price unavailable-text">⚠️ ${escapeHTML(p.availability_label || "غير متوفر حاليًا")} — لن يُحتسب في الطلب</span>`}
            </div>
            <div class="qty-control">
              <button onclick="changeQty(${p.id}, -1)">−</button>
              <span>${p.qty}</span>
              <button onclick="changeQty(${p.id}, 1)">+</button>
            </div>
            <button class="remove-btn" title="حذف" onclick="removeFromCart(${p.id})">🗑️</button>
          </div>`
          )
          .join("")}
      </div>

      <div class="cart-summary">
        <h3>ملخص الطلب</h3>
        ${blocked.length ? `<p class="unavailable-text" style="font-size:0.85rem;">⚠️ ${blocked.length} منتج غير متوفر لن يُحتسب</p>` : ""}
        <div class="summary-row"><span>الإجمالي الفرعي</span><span>${formatPrice(subtotal)}</span></div>
        <div class="summary-row"><span>الشحن</span><span>${formatPrice(SETTINGS.shipping_fee)}</span></div>
        <div class="summary-row total"><span>الإجمالي</span><span>${formatPrice(total)}</span></div>
        <button class="btn btn-primary" onclick="openCheckout()" ${orderable.length ? "" : "disabled"}>إتمام الطلب</button>
        ${SETTINGS.whatsapp_order_enabled && orderable.length
          ? `<button class="btn btn-whatsapp" onclick="orderCartViaWhatsApp()">💬 أو اطلب عبر واتساب (اختياري)</button>`
          : ""}
        <a href="products.html" class="btn btn-light" style="background:var(--bg);margin-top:10px;">مواصلة التسوق</a>
      </div>
    </div>

    <div id="checkoutSection"></div>`;
}

// ===== رفع الصور المرجعية =====
const MAX_IMAGES = 10;
const MAX_IMG_BYTES = 6 * 1024 * 1024; // حد السيرفر لكل صورة
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
let orderImages = []; // [{ id, name, dataUrl, size }]
let _imgSeq = 0;

function humanSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// ضغط/تصغير الصورة إن كانت كبيرة (يحافظ على جودة مرجعية جيدة للطباعة)
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 2000;
      let { width, height } = img;
      const tooBig = file.size > 1.2 * 1024 * 1024;
      const overDim = width > MAX_DIM || height > MAX_DIM;
      // ملفات صغيرة الحجم والأبعاد: احتفظ بالأصل كما هو
      if (!tooBig && !overDim) {
        const r = new FileReader();
        r.onload = () => resolve({ dataUrl: r.result, size: file.size });
        r.onerror = reject;
        r.readAsDataURL(file);
        return;
      }
      if (overDim) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(type, 0.85);
      const size = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
      resolve({ dataUrl, size });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

function setUploadError(msg) {
  const el = document.getElementById("uploadError");
  if (el) el.textContent = msg || "";
}

async function handleFiles(fileList) {
  setUploadError("");
  const files = Array.from(fileList || []);
  if (!files.length) return;

  for (const file of files) {
    if (orderImages.length >= MAX_IMAGES) {
      setUploadError(`الحد الأقصى ${MAX_IMAGES} صور — تم تجاهل الباقي.`);
      break;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError("صيغة غير مدعومة — استخدم JPG أو PNG أو WebP.");
      continue;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError(`"${file.name}" أكبر من 25 ميجا — من فضلك اختر صورة أصغر.`);
      continue;
    }
    let dataUrl, size;
    try {
      ({ dataUrl, size } = await compressImage(file));
    } catch {
      setUploadError(`تعذّر قراءة "${file.name}".`);
      continue;
    }
    const entry = { id: ++_imgSeq, name: file.name || `صورة-${_imgSeq}`, previewUrl: dataUrl, dataUrl, size, status: "uploading", url: null, pathname: null, mime: null };
    orderImages.push(entry);
    renderUploads();
    uploadOne(entry); // رفع فوري بالخلفية
  }
}

// رفع صورة واحدة إلى السيرفر (Vercel Blob) وتحديث حالتها
async function uploadOne(entry) {
  entry.status = "uploading";
  renderUploads();
  if (STATIC_MODE) { entry.status = "local"; renderUploads(); return; }
  try {
    const res = await fetch("api/upload/order-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: entry.dataUrl, name: entry.name }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "فشل الرفع");
    entry.status = "done";
    entry.url = data.url;
    entry.pathname = data.pathname;
    entry.mime = data.mime;
    entry.size = data.size || entry.size;
    entry.dataUrl = null; // تحرير الذاكرة بعد الرفع
  } catch (e) {
    entry.status = "error";
    setUploadError(`تعذّر رفع "${entry.name}" — اضغط ↻ لإعادة المحاولة.`);
  }
  renderUploads();
}

function retryUpload(id) {
  const entry = orderImages.find((im) => im.id === id);
  if (entry) { setUploadError(""); uploadOne(entry); }
}

function removeUpload(id) {
  orderImages = orderImages.filter((im) => im.id !== id);
  setUploadError("");
  renderUploads();
}

function uploadsPending() {
  return orderImages.some((im) => im.status === "uploading");
}

function renderUploads() {
  const counter = document.getElementById("uploadCounter");
  const grid = document.getElementById("uploadGrid");
  const dz = document.getElementById("dropzone");
  if (!counter || !grid) return;
  const done = orderImages.filter((im) => im.status === "done" || im.status === "local").length;
  counter.innerHTML = `تم رفع <span class="uc-num">${done}</span> من ${MAX_IMAGES} صور`;
  grid.innerHTML = orderImages
    .map((im) => {
      const src = im.previewUrl || im.url || "";
      const overlay =
        im.status === "uploading" ? `<span class="up-state busy" aria-label="جارٍ الرفع"></span>`
        : im.status === "error" ? `<button type="button" class="up-state retry" title="إعادة المحاولة" onclick="retryUpload(${im.id})">↻</button>`
        : "";
      return `
      <div class="upload-thumb ${im.status}">
        <img src="${src}" alt="${escapeHTML(im.name)}" />
        ${overlay}
        <button type="button" class="up-remove" aria-label="حذف الصورة ${escapeHTML(im.name)}" onclick="removeUpload(${im.id})">✕</button>
        <span class="up-size">${im.status === "error" ? "خطأ" : humanSize(im.size)}</span>
      </div>`;
    })
    .join("");
  if (dz) dz.classList.toggle("full", orderImages.length >= MAX_IMAGES);
}

// ===== نموذج إتمام الطلب (أقسام مجمّعة + رفع صور + مراجعة) =====
function openCheckout() {
  const sec = document.getElementById("checkoutSection");
  if (!sec) return;
  orderImages = [];
  const staticNote = STATIC_MODE
    ? `<p class="field-hint" style="color:var(--danger);">⚠️ رفع الصور يتطلّب تشغيل الموقع على سيرفر المتجر. حالياً سيُرسَل الطلب عبر واتساب بدون الصور.</p>`
    : "";

  sec.innerHTML = `
    <section style="padding:40px 0 0;">
      <h2 class="section-title">إتمام الطلب</h2>
      <p class="section-sub">كل الخطوات واضحة — عبّي بياناتك وراجع طلبك قبل الإرسال. الدفع عند الاستلام.</p>
      <div class="trust-row">
        <span>🔒 بياناتك آمنة</span>
        <span>💵 الدفع عند الاستلام</span>
        <span>🎨 مراجعة التصميم قبل التنفيذ</span>
        <span>📞 تأكيد هاتفي قبل الشحن</span>
      </div>

      <form class="checkout-shell" id="checkoutForm" novalidate>
        <!-- 1) بيانات العميل -->
        <div class="checkout-step">
          <h3><span class="step-badge">1</span> بيانات العميل</h3>
          <p class="step-sub">عشان نقدر نتواصل معاك ونأكد الطلب.</p>
          <div class="form-row">
            <div class="form-group">
              <label for="ckName">الاسم بالكامل<span class="req-star">*</span></label>
              <input type="text" id="ckName" name="name" required placeholder="مثال: أحمد محمد" autocomplete="name">
              <span class="field-error" data-for="ckName"></span>
            </div>
            <div class="form-group">
              <label for="ckPhone">رقم الموبايل<span class="req-star">*</span></label>
              <input type="tel" id="ckPhone" name="phone" required inputmode="numeric" placeholder="01xxxxxxxxx" pattern="01[0-9]{9}" autocomplete="tel">
              <span class="field-error" data-for="ckPhone"></span>
            </div>
          </div>
          <div class="form-group">
            <label for="ckEmail">البريد الإلكتروني <span class="optional-tag">(اختياري)</span></label>
            <input type="email" id="ckEmail" name="email" placeholder="example@email.com" autocomplete="email">
            <span class="field-error" data-for="ckEmail"></span>
          </div>
        </div>

        <!-- 2) بيانات التوصيل -->
        <div class="checkout-step">
          <h3><span class="step-badge">2</span> بيانات التوصيل</h3>
          <p class="step-sub">التوصيل لكل المحافظات خلال 2–4 أيام عمل.</p>
          <div class="form-group">
            <label for="ckCity">المحافظة / المدينة<span class="req-star">*</span></label>
            <select id="ckCity" name="city" required>
              <option value="">اختر المحافظة</option>
              <option>القاهرة</option><option>الجيزة</option><option>الإسكندرية</option>
              <option>الدقهلية</option><option>الشرقية</option><option>الغربية</option>
              <option>القليوبية</option><option>المنوفية</option><option>البحيرة</option>
              <option>بورسعيد</option><option>السويس</option><option>أسيوط</option>
              <option>المنيا</option><option>سوهاج</option><option>قنا</option><option>أسوان</option>
              <option>أخرى</option>
            </select>
            <span class="field-error" data-for="ckCity"></span>
          </div>
          <div class="form-group">
            <label for="ckAddress">العنوان بالتفصيل<span class="req-star">*</span></label>
            <textarea id="ckAddress" name="address" required rows="3" placeholder="الشارع، رقم العمارة، الدور، الشقة، علامة مميزة قريبة"></textarea>
            <span class="field-error" data-for="ckAddress"></span>
          </div>
        </div>

        <!-- 3) تفاصيل الطباعة والطلب -->
        <div class="checkout-step">
          <h3><span class="step-badge">3</span> تفاصيل الطباعة والطلب</h3>
          <p class="step-sub">اكتب كل تفاصيل الطباعة المطلوبة عشان ننفّذ طلبك بالشكل الصحيح.</p>
          <div class="form-group">
            <label for="ckNotes">تفاصيل التخصيص</label>
            <textarea id="ckNotes" name="notes" class="print-details" rows="5" maxlength="2000"
              placeholder="اكتب جميع تفاصيل الطباعة المطلوبة، مثل النصوص، الألوان، المقاسات، أماكن الطباعة، وأي ملاحظات تساعدنا على تنفيذ طلبك بالشكل الصحيح.&#10;&#10;مثال: أريد طباعة الشعار في منتصف المنتج باللون الأبيض، بمقاس 15 × 15 سم، مع كتابة الاسم أسفل الشعار."></textarea>
            <div class="char-counter" id="notesCounter">0 / 2000</div>
          </div>
        </div>

        <!-- 4) الصور المرجعية -->
        <div class="checkout-step">
          <h3><span class="step-badge">4</span> إرفاق صور أو ملفات مرجعية <span class="optional-tag">(اختياري)</span></h3>
          <p class="step-sub">ارفع ما يصل إلى ${MAX_IMAGES} صور لتوضيح التصميم أو الصورة التي ترغب في طباعتها.</p>
          <div class="uploader-note">
            🖼️ للحصول على أفضل نتيجة، يُفضل رفع صور واضحة وعالية الجودة، وقد يتواصل معك فريقنا إذا كانت جودة الملف غير مناسبة للطباعة.<br>
            🔐 تُستخدم الملفات المرفقة فقط لمراجعة طلبك وتنفيذ الطباعة، ولن يتم استخدامها أو مشاركتها لأي غرض آخر.
          </div>
          ${staticNote}
          <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="اسحب الصور هنا أو اضغط للاختيار من جهازك">
            <div class="dz-icon" aria-hidden="true">📤</div>
            <div class="dz-title">اسحب الصور هنا أو اضغط للاختيار</div>
            <div class="dz-hint">JPG / PNG / WebP — حتى ${MAX_IMAGES} صور</div>
            <input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp" multiple hidden>
          </div>
          <div class="upload-error" id="uploadError" role="alert"></div>
          <div class="upload-counter" id="uploadCounter">تم رفع <span class="uc-num">0</span> من ${MAX_IMAGES} صور</div>
          <div class="upload-grid" id="uploadGrid"></div>
        </div>

        <!-- 5) طريقة الدفع -->
        <div class="checkout-step">
          <h3><span class="step-badge">5</span> طريقة الدفع</h3>
          <div class="pay-method">
            <span class="pm-icon" aria-hidden="true">💵</span>
            <div>
              <div class="pm-title">الدفع عند الاستلام</div>
              <div class="pm-desc">تدفع نقداً للمندوب بعد استلام طلبك.</div>
            </div>
          </div>
        </div>

        <!-- حقل مخفي لصد الرسائل العشوائية -->
        <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;right:-9999px;opacity:0;height:0;" aria-hidden="true">

        <button type="submit" class="btn btn-primary" style="justify-content:center;width:100%;">مراجعة الطلب قبل التأكيد ←</button>
        <p style="text-align:center;color:var(--muted);font-size:0.86rem;margin-top:10px;">
          هتقدر تراجع كل التفاصيل في الخطوة الجاية قبل ما تأكد.
        </p>
      </form>
    </section>`;

  // ربط الأحداث
  const form = document.getElementById("checkoutForm");
  form.addEventListener("submit", (e) => { e.preventDefault(); openReview(); });

  const notes = document.getElementById("ckNotes");
  const notesCounter = document.getElementById("notesCounter");
  const updateNotes = () => {
    const n = notes.value.length;
    notesCounter.textContent = `${n} / 2000`;
    notesCounter.classList.toggle("limit", n >= 2000);
  };
  notes.addEventListener("input", updateNotes);

  const dz = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  dz.addEventListener("click", () => { if (!dz.classList.contains("full")) fileInput.click(); });
  dz.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !dz.classList.contains("full")) { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => { handleFiles(fileInput.files); fileInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files); });

  sec.scrollIntoView({ behavior: "smooth" });
}

// التحقق من صحة الحقول مع رسائل بجانب كل حقل (يحافظ على البيانات)
function validateCheckout() {
  const form = document.getElementById("checkoutForm");
  if (!form) return null;
  const setErr = (id, msg) => {
    const field = document.getElementById(id);
    const err = form.querySelector(`.field-error[data-for="${id}"]`);
    if (field) field.setAttribute("aria-invalid", msg ? "true" : "false");
    if (err) err.textContent = msg || "";
    return !msg;
  };
  const val = (id) => (document.getElementById(id).value || "").trim();

  let firstBad = null;
  const fail = (id) => { if (!firstBad) firstBad = document.getElementById(id); };

  const name = val("ckName");
  if (!setErr("ckName", name.length >= 2 ? "" : "من فضلك اكتب اسمك بالكامل")) fail("ckName");

  const phone = val("ckPhone");
  if (!setErr("ckPhone", /^01[0-9]{9}$/.test(phone) ? "" : "رقم موبايل مصري صحيح مثل 01xxxxxxxxx")) fail("ckPhone");

  const email = val("ckEmail");
  if (!setErr("ckEmail", !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "البريد الإلكتروني غير صحيح")) fail("ckEmail");

  const city = val("ckCity");
  if (!setErr("ckCity", city ? "" : "اختر المحافظة")) fail("ckCity");

  const address = val("ckAddress");
  if (!setErr("ckAddress", address.length >= 6 ? "" : "اكتب العنوان بالتفصيل")) fail("ckAddress");

  if (firstBad) {
    firstBad.focus();
    firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }
  return { name, phone, email, city, address, notes: val("ckNotes") };
}

// ===== خطوة المراجعة قبل التأكيد =====
let _reviewData = null;

function openReview() {
  const info = validateCheckout();
  if (!info) { showToast("⚠️ من فضلك أكمل الحقول المطلوبة"); return; }
  if (uploadsPending()) { showToast("⏳ انتظر انتهاء رفع الصور"); return; }
  if (orderImages.some((im) => im.status === "error")) { showToast("⚠️ في صور فشل رفعها — أعد المحاولة أو احذفها"); return; }

  const detailed = cartDetailed().filter((p) => p.orderable);
  if (detailed.length === 0) { showToast("⚠️ لا توجد منتجات متاحة في سلتك"); return; }

  const subtotal = detailed.reduce((s, p) => s + p.price * p.qty, 0);
  const total = subtotal + SETTINGS.shipping_fee;
  _reviewData = { info, detailed, subtotal, total };

  const overlay = document.createElement("div");
  overlay.className = "review-overlay";
  overlay.innerHTML = `
    <div class="review-card" role="dialog" aria-modal="true" aria-labelledby="reviewTitle">
      <div class="review-head">
        <h3 id="reviewTitle">مراجعة الطلب</h3>
        <button class="theme-modal-close" type="button" aria-label="إغلاق ومتابعة التعديل">✕</button>
      </div>
      <div class="review-body">
        <div class="review-section">
          <h4>🛒 المنتجات</h4>
          <ul class="review-items" style="padding:0;margin:0;">
            ${detailed.map((p) => `<li><span>${escapeHTML(p.name)} × ${p.qty}</span><span>${formatPrice(p.price * p.qty)}</span></li>`).join("")}
          </ul>
        </div>
        <div class="review-section">
          <div class="review-line"><span class="rk">الإجمالي الفرعي</span><span>${formatPrice(subtotal)}</span></div>
          <div class="review-line"><span class="rk">الشحن</span><span>${formatPrice(SETTINGS.shipping_fee)}</span></div>
          <div class="review-total"><span>الإجمالي</span><span>${formatPrice(total)}</span></div>
        </div>
        <div class="review-section">
          <h4>👤 بيانات العميل والتوصيل</h4>
          <div class="review-line"><span class="rk">الاسم</span><span>${escapeHTML(info.name)}</span></div>
          <div class="review-line"><span class="rk">الموبايل</span><span class="ltr">${escapeHTML(info.phone)}</span></div>
          ${info.email ? `<div class="review-line"><span class="rk">الإيميل</span><span>${escapeHTML(info.email)}</span></div>` : ""}
          <div class="review-line"><span class="rk">المحافظة</span><span>${escapeHTML(info.city)}</span></div>
          <div class="review-line"><span class="rk">العنوان</span><span>${escapeHTML(info.address)}</span></div>
          <div class="review-line"><span class="rk">الدفع</span><span>عند الاستلام</span></div>
        </div>
        <div class="review-section">
          <h4>🎨 تفاصيل الطباعة</h4>
          ${info.notes ? `<div class="review-notes">${escapeHTML(info.notes)}</div>` : `<div class="review-notes" style="color:var(--ink-soft);">لم تُضف تفاصيل — سيتواصل معك الفريق لأخذ التفاصيل.</div>`}
        </div>
        <div class="review-section">
          <h4>🖼️ الصور المرفقة (${orderImages.length})</h4>
          ${orderImages.length
            ? `<div class="review-thumbs">${orderImages.map((im) => `<img src="${im.previewUrl || im.url}" alt="${escapeHTML(im.name)}">`).join("")}</div>`
            : `<div class="review-notes" style="color:var(--ink-soft);">لا توجد صور مرفقة.</div>`}
        </div>
      </div>
      <div class="review-actions">
        <button class="btn btn-light" type="button" id="reviewEdit">← تعديل البيانات</button>
        <button class="btn btn-primary" type="button" id="reviewConfirm">تأكيد وإرسال الطلب ✓</button>
      </div>
    </div>`;

  const close = () => {
    overlay.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 220);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.querySelector(".theme-modal-close").addEventListener("click", close);
  overlay.querySelector("#reviewEdit").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#reviewConfirm").addEventListener("click", (e) => doSubmitOrder(e.currentTarget, close));
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  setTimeout(() => overlay.querySelector("#reviewConfirm")?.focus(), 60);
}

// ===== إرسال الطلب النهائي =====
async function doSubmitOrder(btn, closeReview) {
  if (!_reviewData || btn.dataset.busy === "1") return; // منع الإرسال المزدوج
  btn.dataset.busy = "1";
  btn.disabled = true;
  btn.textContent = "جارٍ الإرسال...";

  const { info, detailed } = _reviewData;
  const items = detailed.map((p) => ({ product_id: p.id, qty: p.qty }));

  // وضع الاستضافة الثابتة: لا سيرفر → إرسال عبر واتساب
  if (STATIC_MODE) {
    submitOrderViaWhatsApp(info, detailed);
    closeReview();
    return;
  }

  try {
    const res = await fetch("api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: info.name,
        phone: info.phone,
        email: info.email,
        city: info.city,
        address: info.address,
        customer_notes: info.notes,
        website: "",
        items,
        attachments: orderImages
          .filter((im) => im.status === "done" && im.url)
          .map((im) => ({ url: im.url, pathname: im.pathname, name: im.name, mime: im.mime, size: im.size })),
      }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      showToast("⚠️ " + (result.error || "تعذّر إرسال الطلب — حاول مرة أخرى"));
      btn.disabled = false;
      btn.dataset.busy = "0";
      btn.textContent = "تأكيد وإرسال الطلب ✓";
      return;
    }
    closeReview();
    saveCart([]);
    orderImages = [];
    showOrderSuccess(result);
  } catch {
    showToast("⚠️ تعذّر الاتصال بالمتجر — تأكد من اتصالك بالإنترنت");
    btn.disabled = false;
    btn.dataset.busy = "0";
    btn.textContent = "تأكيد وإرسال الطلب ✓";
  }
}

function showOrderSuccess(result) {
  const wrap = document.getElementById("cartWrap");
  const num = escapeHTML(result.order_number || "");
  const imgsLine = result.images_saved
    ? `<li>تم إرفاق <strong>${result.images_saved}</strong> صورة مرجعية بطلبك بنجاح.</li>`
    : "";
  wrap.innerHTML = `
    <div class="order-success">
      <div class="success-mark" aria-hidden="true">✓</div>
      <h3>تم استلام طلبك بنجاح</h3>
      <p style="color:var(--muted);">شكراً لثقتك في MY BOX STORE 🎁</p>
      <div class="order-number-box">
        <div>
          <div class="on-label">رقم الطلب</div>
          <div class="on-value" id="orderNumVal">${num}</div>
        </div>
        <button class="copy-btn" type="button" onclick="copyOrderNumber('${num}', this)">📋 نسخ</button>
      </div>
      <div class="order-next">
        <h4>الخطوات القادمة</h4>
        <ol>
          <li>سيقوم فريقنا بمراجعة تفاصيل الطلب والصور المرفقة.</li>
          <li><strong>قد نتواصل معك</strong> لتأكيد تفاصيل الطباعة قبل بدء التنفيذ.</li>
          <li>بعد تأكيد التصميم يبدأ التنفيذ ثم الشحن، والدفع عند الاستلام.</li>
          ${imgsLine}
        </ol>
      </div>
      <a href="products.html" class="btn btn-primary" style="display:inline-flex;width:auto;margin:0 auto;">مواصلة التسوق</a>
    </div>`;
  showToast("🎉 تم استلام طلبك بنجاح");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function copyOrderNumber(num, btn) {
  const done = () => { if (btn) { const t = btn.textContent; btn.textContent = "✓ تم النسخ"; setTimeout(() => (btn.textContent = t), 1500); } };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(num).then(done).catch(done);
  } else {
    const ta = document.createElement("textarea");
    ta.value = num; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove(); done();
  }
}

// إرسال الطلب عبر واتساب (وضع الاستضافة الثابتة فقط)
function submitOrderViaWhatsApp(info, detailed) {
  const subtotal = detailed.reduce((s, p) => s + p.price * p.qty, 0);
  const total = subtotal + SETTINGS.shipping_fee;

  let msg = "🛍️ *طلب جديد من MY BOX STORE*\n—————————————\n";
  msg += `👤 الاسم: ${info.name}\n`;
  msg += `📱 الموبايل: ${info.phone}\n`;
  msg += `🏙️ المحافظة: ${info.city}\n`;
  msg += `📍 العنوان: ${info.address}\n`;
  if (info.notes) msg += `🎨 التخصيص/ملاحظات: ${info.notes}\n`;
  msg += "—————————————\n🛒 المنتجات:\n";
  detailed.forEach((p, i) => {
    msg += `${i + 1}- ${p.name} × ${p.qty} = ${formatPrice(p.price * p.qty)}\n`;
  });
  msg += `—————————————\nالشحن: ${formatPrice(SETTINGS.shipping_fee)}\n💰 *الإجمالي: ${formatPrice(total)}*\n💵 الدفع عند الاستلام`;

  const waUrl = `https://wa.me/${SETTINGS.store_phone}?text=${encodeURIComponent(msg)}`;
  window.open(waUrl, "_blank");

  saveCart([]);
  const wrap = document.getElementById("cartWrap");
  wrap.innerHTML = `
    <div class="order-success">
      <div class="success-mark" aria-hidden="true">💬</div>
      <h3>خطوة أخيرة لإتمام طلبك!</h3>
      <p>تم فتح واتساب بتفاصيل طلبك — اضغط <strong>إرسال</strong> داخل واتساب ليصلنا فوراً.<br>لو ما فتحش تلقائياً اضغط الزر:</p>
      <a href="${waUrl}" target="_blank" class="btn btn-whatsapp" style="display:inline-flex;width:auto;margin:14px auto;">💬 أرسل الطلب على واتساب</a>
      <div><a href="products.html" class="btn btn-light">مواصلة التسوق</a></div>
    </div>`;
  showToast("🎉 تم تجهيز طلبك — أرسله عبر واتساب");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== قائمة الموبايل =====
function toggleMenu() {
  document.querySelector(".nav")?.classList.toggle("open");
}

// ===== نظام الثيم (نهاري / ليلي) =====
const THEME_KEY = "mbs_theme";
const THEME_SEEN_KEY = "mbs_theme_seen";

function getSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}
function applyTheme(theme, persist) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  if (persist) {
    try { localStorage.setItem(THEME_KEY, t); } catch {}
  }
  // تحديث زر التبديل
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    const dark = t === "dark";
    btn.setAttribute("aria-pressed", String(dark));
    btn.setAttribute("aria-label", dark ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي");
    btn.setAttribute("title", dark ? "الوضع النهاري" : "الوضع الليلي");
    btn.querySelector(".theme-icon").textContent = dark ? "☀️" : "🌙";
  });
  // إعلان للقارئات الصوتية
  const live = document.getElementById("themeLive");
  if (live) live.textContent = t === "dark" ? "تم تفعيل الوضع الليلي" : "تم تفعيل الوضع النهاري";
}
function toggleTheme() {
  applyTheme(getCurrentTheme() === "dark" ? "light" : "dark", true);
}

function injectThemeToggle() {
  document.querySelectorAll(".header-actions").forEach((actions) => {
    if (actions.querySelector(".theme-toggle")) return;
    const btn = document.createElement("button");
    btn.className = "theme-toggle";
    btn.type = "button";
    btn.innerHTML = `<span class="theme-icon" aria-hidden="true">🌙</span>`;
    btn.addEventListener("click", toggleTheme);
    // ضعه قبل زر قائمة الموبايل إن وُجد
    const menuBtn = actions.querySelector(".menu-toggle");
    actions.insertBefore(btn, menuBtn || null);
  });
  if (!document.getElementById("themeLive")) {
    const live = document.createElement("div");
    live.id = "themeLive";
    live.setAttribute("aria-live", "polite");
    live.className = "sr-only";
    document.body.appendChild(live);
  }
}

// نافذة اختيار المظهر — تظهر مرة واحدة عند أول زيارة فقط
function maybeShowThemeSelector() {
  let saved = null, seen = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
    seen = localStorage.getItem(THEME_SEEN_KEY);
  } catch {}
  if (saved === "light" || saved === "dark" || seen) return; // اختار من قبل أو رآها

  const sys = getSystemTheme();
  const overlay = document.createElement("div");
  overlay.className = "theme-modal-overlay";
  overlay.innerHTML = `
    <div class="theme-modal" role="dialog" aria-modal="true" aria-labelledby="themeModalTitle" aria-describedby="themeModalDesc">
      <button class="theme-modal-close" type="button" aria-label="تخطي واستخدام مظهر النظام">✕</button>
      <div class="theme-modal-brand"><img src="images/logo.jpeg" alt="" /></div>
      <h2 id="themeModalTitle">اختر المظهر المناسب لك</h2>
      <p id="themeModalDesc" class="theme-modal-sub">تقدر تغيّره في أي وقت من زر المظهر بأعلى الصفحة.</p>
      <div class="theme-options">
        <button class="theme-option" type="button" data-theme="light" ${sys === "light" ? "data-suggested='1'" : ""}>
          <span class="theme-preview theme-preview-light" aria-hidden="true">
            <span class="tp-bar"></span><span class="tp-card"></span><span class="tp-btn"></span>
          </span>
          <span class="theme-option-title">☀️ الوضع النهاري</span>
          <span class="theme-option-desc">واجهة مشرقة وواضحة للاستخدام أثناء النهار.</span>
        </button>
        <button class="theme-option" type="button" data-theme="dark" ${sys === "dark" ? "data-suggested='1'" : ""}>
          <span class="theme-preview theme-preview-dark" aria-hidden="true">
            <span class="tp-bar"></span><span class="tp-card"></span><span class="tp-btn"></span>
          </span>
          <span class="theme-option-title">🌙 الوضع الليلي</span>
          <span class="theme-option-desc">واجهة مريحة للعين في الإضاءة المنخفضة.</span>
        </button>
      </div>
      <button class="theme-modal-skip" type="button">تخطي — استخدم مظهر النظام</button>
    </div>`;

  const close = (persistSeen) => {
    if (persistSeen) { try { localStorage.setItem(THEME_SEEN_KEY, "1"); } catch {} }
    overlay.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 250);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close(true);
  };

  overlay.querySelectorAll(".theme-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      applyTheme(opt.dataset.theme, true);
      close(false);
    });
  });
  overlay.querySelector(".theme-modal-close").addEventListener("click", () => close(true));
  overlay.querySelector(".theme-modal-skip").addEventListener("click", () => close(true));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(true); });
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  // تركيز أول خيار لسهولة الوصول بالكيبورد
  setTimeout(() => overlay.querySelector(".theme-option")?.focus(), 60);
}

function initTheme() {
  // الثيم مطبَّق مبكراً عبر سكربت الـ head؛ هنا نضبط الزر والنافذة فقط
  injectThemeToggle();
  applyTheme(getCurrentTheme(), false);
  maybeShowThemeSelector();
  // لو المستخدم غيّر مظهر النظام ولم يحفظ تفضيلاً صريحاً
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
      let saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch {}
      if (saved !== "light" && saved !== "dark") applyTheme(e.matches ? "dark" : "light", false);
    });
  }
}

// ===== حركة الظهور عند التمرير (تحترم تقليل الحركة) =====
function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  els.forEach((el) => obs.observe(el));
}

// ===== التشغيل عند التحميل =====
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  updateCartCount();
  initReveal();
});
