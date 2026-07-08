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

  const actionBtn = p.orderable
    ? `<button class="add-btn" data-id="${p.id}">أضف للسلة</button>`
    : `<button class="add-btn disabled" disabled>${escapeHTML(p.availability_label || "غير متوفر حاليًا")}</button>`;

  return `
    <article class="product-card ${p.orderable ? "" : "is-unavailable"}" data-cat="${escapeHTML(p.category_key || "")}">
      <a class="product-img" href="product.html?id=${p.id}">
        <img src="${escapeHTML(p.image || "images/logo.jpeg")}" alt="${escapeHTML(p.name)}" loading="lazy" />
        ${badge}
        ${unavailable}
      </a>
      <div class="product-body">
        <span class="product-cat">${escapeHTML(p.category_name || "")}</span>
        <a class="product-name-link" href="product.html?id=${p.id}"><h3 class="product-name">${escapeHTML(p.name)}</h3></a>
        <div class="product-footer">
          <div class="product-price">${priceHTML(p)}</div>
          ${actionBtn}
        </div>
      </div>
    </article>`;
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

// ===== نموذج إتمام الطلب (الطلب من الموقع — بدون واتساب) =====
function openCheckout() {
  const sec = document.getElementById("checkoutSection");
  if (!sec) return;
  sec.innerHTML = `
    <section style="padding:40px 0 0;">
      <h2 class="section-title">بيانات التوصيل</h2>
      <p class="section-sub">املأ بياناتك واضغط "إرسال الطلب" — فريقنا هيتواصل معاك لتأكيد التفاصيل (الدفع عند الاستلام)</p>
      <form class="checkout-form" style="max-width:640px;margin:0 auto;" onsubmit="submitOrder(event)">
        <div class="form-row">
          <div class="form-group">
            <label>الاسم بالكامل</label>
            <input type="text" name="name" required placeholder="مثال: أحمد محمد">
          </div>
          <div class="form-group">
            <label>رقم الموبايل</label>
            <input type="tel" name="phone" required placeholder="01xxxxxxxxx" pattern="01[0-9]{9}">
          </div>
        </div>
        <div class="form-group">
          <label>البريد الإلكتروني (اختياري)</label>
          <input type="email" name="email" placeholder="example@email.com">
        </div>
        <div class="form-group">
          <label>المحافظة / المدينة</label>
          <select name="city" required>
            <option value="">اختر المحافظة</option>
            <option>القاهرة</option><option>الجيزة</option><option>الإسكندرية</option>
            <option>الدقهلية</option><option>الشرقية</option><option>الغربية</option>
            <option>أخرى</option>
          </select>
        </div>
        <div class="form-group">
          <label>العنوان بالتفصيل</label>
          <textarea name="address" required rows="3" placeholder="الشارع، رقم العمارة، الدور، علامة مميزة"></textarea>
        </div>
        <div class="form-group">
          <label>تفاصيل التخصيص / ملاحظات (مهم لمنتجات الطباعة)</label>
          <input type="text" name="notes" placeholder="مثال: الاسم المطلوب طباعته، اللون، المقاس...">
        </div>
        <!-- حقل مخفي لصد الرسائل العشوائية -->
        <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;right:-9999px;opacity:0;height:0;" aria-hidden="true">
        <button type="submit" class="btn btn-primary" id="submitOrderBtn" style="justify-content:center;">إرسال الطلب ✓</button>
        <p style="text-align:center;color:var(--muted);font-size:0.88rem;margin-top:4px;">
          بعد الإرسال هيوصلنا طلبك فوراً وهنتواصل معاك على رقمك لتأكيد التفاصيل.
        </p>
      </form>
    </section>`;
  sec.scrollIntoView({ behavior: "smooth" });
}

async function submitOrder(e) {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  const btn = document.getElementById("submitOrderBtn");

  const items = cartDetailed()
    .filter((p) => p.orderable)
    .map((p) => ({ product_id: p.id, qty: p.qty }));

  if (items.length === 0) {
    showToast("⚠️ لا توجد منتجات متاحة في سلتك");
    return;
  }

  btn.disabled = true;
  btn.textContent = "جارٍ إرسال الطلب...";

  // وضع الاستضافة الثابتة: لا يوجد سيرفر لحفظ الطلب → الطلب يُرسل عبر واتساب
  if (STATIC_MODE) {
    submitOrderViaWhatsApp(data);
    return;
  }

  try {
    const res = await fetch("api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: (data.get("name") || "").trim(),
        phone: (data.get("phone") || "").trim(),
        email: (data.get("email") || "").trim(),
        city: data.get("city") || "",
        address: (data.get("address") || "").trim(),
        customer_notes: (data.get("notes") || "").trim(),
        website: data.get("website") || "",
        items,
      }),
    });
    const result = await res.json();

    if (!res.ok || !result.ok) {
      showToast("⚠️ " + (result.error || "تعذّر إرسال الطلب — حاول مرة أخرى"));
      btn.disabled = false;
      btn.textContent = "إرسال الطلب ✓";
      return;
    }

    // نجاح: تفريغ السلة وعرض رسالة التأكيد — بدون فتح واتساب
    saveCart([]);
    const wrap = document.getElementById("cartWrap");
    wrap.innerHTML = `
      <div class="empty-cart">
        <div class="emoji">🎉</div>
        <h3>تم استلام طلبك بنجاح!</h3>
        <p>رقم طلبك: <strong style="color:var(--primary);font-size:1.2rem;">${escapeHTML(result.order_number)}</strong><br>
        وسيتواصل معك فريقنا قريبًا لتأكيد التفاصيل.</p>
        <a href="products.html" class="btn btn-primary" style="display:inline-flex;width:auto;margin:0 auto;">مواصلة التسوق</a>
      </div>`;
    showToast("🎉 تم استلام طلبك بنجاح");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    showToast("⚠️ تعذّر الاتصال بالمتجر — تأكد من اتصالك بالإنترنت");
    btn.disabled = false;
    btn.textContent = "إرسال الطلب ✓";
  }
}

// إرسال الطلب عبر واتساب (وضع الاستضافة الثابتة فقط)
function submitOrderViaWhatsApp(formData) {
  const detailed = cartDetailed().filter((p) => p.orderable);
  const subtotal = detailed.reduce((s, p) => s + p.price * p.qty, 0);
  const total = subtotal + SETTINGS.shipping_fee;

  let msg = "🛍️ *طلب جديد من MY BOX STORE*\n—————————————\n";
  msg += `👤 الاسم: ${(formData.get("name") || "").trim()}\n`;
  msg += `📱 الموبايل: ${(formData.get("phone") || "").trim()}\n`;
  msg += `🏙️ المحافظة: ${formData.get("city") || ""}\n`;
  msg += `📍 العنوان: ${(formData.get("address") || "").trim()}\n`;
  const notes = (formData.get("notes") || "").trim();
  if (notes) msg += `🎨 التخصيص/ملاحظات: ${notes}\n`;
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
    <div class="empty-cart">
      <div class="emoji">🎉</div>
      <h3>خطوة أخيرة لإتمام طلبك!</h3>
      <p>تم فتح واتساب بتفاصيل طلبك — اضغط <strong>إرسال</strong> داخل واتساب ليصلنا فوراً.<br>لو ما فتحش تلقائياً اضغط الزر:</p>
      <a href="${waUrl}" target="_blank" class="btn btn-whatsapp" style="display:inline-flex;width:auto;margin:0 auto 14px;">💬 أرسل الطلب على واتساب</a>
      <div><a href="products.html" class="btn btn-light" style="background:var(--bg);">مواصلة التسوق</a></div>
    </div>`;
  showToast("🎉 تم تجهيز طلبك — أرسله عبر واتساب");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== قائمة الموبايل =====
function toggleMenu() {
  document.querySelector(".nav")?.classList.toggle("open");
}

// ===== التشغيل عند التحميل =====
document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();
});
