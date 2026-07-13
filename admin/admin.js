/* ====================================================
   MY BOX STORE — منطق لوحة التحكم v2
   طلبات + منتجات + عروض + إعدادات
   ==================================================== */

const COMPANY_NAME = "MY BOX STORE";
const THEME_KEY = "mbs_theme";

// ===== تبديل الوضع الليلي/النهاري (مشترك مع المتجر عبر نفس المفتاح) =====
function applyTheme(theme, persist) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch {} }
  document.querySelectorAll(".theme-toggle .theme-icon").forEach((el) => (el.textContent = t === "dark" ? "☀️" : "🌙"));
  document.querySelectorAll(".theme-toggle").forEach((b) =>
    b.setAttribute("aria-label", t === "dark" ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي"));
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark", true);
}
function makeThemeToggle(cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "theme-toggle" + (cls ? " " + cls : "");
  b.innerHTML = `<span class="theme-icon" aria-hidden="true">🌙</span>`;
  b.addEventListener("click", toggleTheme);
  return b;
}
function initAdminTheme() {
  // ضع زراً في الشريط العلوي للموبايل وفي القائمة الجانبية
  const topnav = document.querySelector(".mobile-topnav .tabs");
  if (topnav && !topnav.querySelector(".theme-toggle")) topnav.insertBefore(makeThemeToggle(), topnav.firstChild);
  const brand = document.querySelector(".sidebar .brand");
  if (brand && !brand.querySelector(".theme-toggle")) brand.appendChild(makeThemeToggle());
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light", false);
}

// الحالات المعتمدة (تظهر في قائمة تغيير الحالة)
const STATUS_LABELS = {
  new: "جديد",
  under_review: "قيد المراجعة",
  awaiting_confirmation: "في انتظار تأكيد العميل",
  design_confirmed: "تم تأكيد التصميم",
  in_production: "قيد التنفيذ",
  ready: "تم التجهيز",
  shipped: "تم الشحن",
  completed: "مكتمل",
  cancelled: "ملغي",
};
// تسميات قديمة — للعرض فقط لو وُجدت طلبات بحالات سابقة
const LEGACY_STATUS_LABELS = {
  contacted: "تم التواصل",
  pending_confirmation: "في انتظار التأكيد",
  in_progress: "قيد التنفيذ",
  prepared: "تم التجهيز",
  delivered: "تم التسليم",
};
const ALL_STATUS_LABELS = { ...STATUS_LABELS, ...LEGACY_STATUS_LABELS };

const SOURCE_LABELS = { website: "🌐 الموقع", whatsapp: "💬 واتساب" };

let CATEGORIES = [];
let PRODUCTS_CACHE = [];
let pendingImageData = null; // صورة جديدة بانتظار الرفع عند الحفظ

// ===== أدوات عامة =====
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) +
    " — " + d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function fmtPrice(n) {
  return Number(n || 0).toLocaleString("ar-EG") + " ج.م";
}

function statusBadge(status) {
  const label = ALL_STATUS_LABELS[status];
  const key = label ? status : "new";
  return `<span class="status-badge ${key}">${label || ALL_STATUS_LABELS.new}</span>`;
}

function waPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "2" + d;
  else if (/^1[0-9]{9}$/.test(d)) d = "20" + d;
  return d;
}

function waLink(order) {
  const num = order.order_number || `#${order.id}`;
  const msg = `مرحبًا ${order.customer_name}، معك فريق ${COMPANY_NAME} بخصوص طلبك رقم ${num}. يسعدنا خدمتك وتأكيد تفاصيل الطلب.`;
  return `https://wa.me/${waPhone(order.phone)}?text=${encodeURIComponent(msg)}`;
}

let toastTimer;
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    location.href = "login.html";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "حدث خطأ غير متوقع");
  return data;
}

function handleErr(err) {
  if (err && err.message !== "unauthorized") showToast(err.message, "error");
}

// ===== التنقل بين الأقسام =====
const VIEWS = ["overview", "orders", "products", "categories", "settings"];
function switchView(view) {
  VIEWS.forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = v === view ? "" : "none";
  });
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "overview") loadOverview();
  if (view === "orders") loadOrders();
  if (view === "products") loadProducts();
  if (view === "categories") loadCategories();
  if (view === "settings") loadSettings();
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ===================================================================
// نظرة عامة
// ===================================================================
async function loadOverview() {
  try {
    const { orders, products, recent } = await api("/api/admin/stats");

    document.getElementById("orderStatsGrid").innerHTML = `
      <div class="stat-card new" onclick="filterOrders('new')">
        <div class="num">${orders.new}</div>
        <div class="lbl">🆕 طلبات جديدة</div>
      </div>
      <div class="stat-card progress" onclick="filterOrders('in_progress')">
        <div class="num">${orders.following}</div>
        <div class="lbl">⏳ قيد المتابعة</div>
      </div>
      <div class="stat-card completed" onclick="filterOrders('completed')">
        <div class="num">${orders.completed}</div>
        <div class="lbl">✅ مكتملة</div>
      </div>
      <div class="stat-card cancelled" onclick="filterOrders('cancelled')">
        <div class="num">${orders.cancelled}</div>
        <div class="lbl">🚫 ملغية</div>
      </div>`;

    document.getElementById("productStatsGrid").innerHTML = `
      <div class="stat-card completed" onclick="filterProducts('available')">
        <div class="num">${products.available}</div>
        <div class="lbl">✅ منتجات متاحة</div>
      </div>
      <div class="stat-card cancelled" onclick="filterProducts('unavailable')">
        <div class="num">${products.unavailable}</div>
        <div class="lbl">🚫 غير متاحة</div>
      </div>
      <div class="stat-card muted" onclick="filterProducts('hidden')">
        <div class="num">${products.hidden}</div>
        <div class="lbl">🙈 مخفية مؤقتًا</div>
      </div>
      <div class="stat-card total" onclick="filterProducts('offer')">
        <div class="num">${products.offers}</div>
        <div class="lbl">🔥 عليها عروض</div>
      </div>`;

    document.getElementById("recentWrap").innerHTML = recent.length
      ? ordersTableHTML(recent, true)
      : emptyStateHTML("لا توجد طلبات بعد", "أول طلب من عميلك هيظهر هنا فور وصوله 🎉");
  } catch (err) {
    handleErr(err);
  }
}

function filterOrders(status) {
  switchView("orders");
  document.getElementById("fStatus").value = status;
  loadOrders();
}
function filterProducts(filter) {
  switchView("products");
  document.getElementById("pFilter").value = filter;
  loadProducts();
}

// ===================================================================
// إدارة الطلبات
// ===================================================================
async function loadOrders() {
  const params = new URLSearchParams();
  const search = document.getElementById("fSearch").value.trim();
  const status = document.getElementById("fStatus").value;
  const from = document.getElementById("fFrom").value;
  const to = document.getElementById("fTo").value;
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const wrap = document.getElementById("ordersWrap");
  try {
    const { orders } = await api("/api/admin/orders?" + params.toString());
    const hasFilters = search || status || from || to;
    wrap.innerHTML = orders.length
      ? ordersTableHTML(orders, false)
      : emptyStateHTML(
          hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد طلبات بعد",
          hasFilters ? "جرّب تعديل البحث أو الفلاتر" : "أول طلب من عميلك هيظهر هنا فور وصوله 🎉"
        );
  } catch (err) {
    handleErr(err);
  }
}

function emptyStateHTML(title, sub) {
  return `
    <div class="empty-state">
      <div class="emoji">📭</div>
      <h3>${esc(title)}</h3>
      <p>${esc(sub)}</p>
    </div>`;
}

function ordersTableHTML(orders, compact) {
  return `
    <table class="orders-table">
      <thead>
        <tr>
          <th>رقم الطلب</th>
          <th>العميل</th>
          <th>الهاتف</th>
          <th>المنتجات</th>
          <th>الإجمالي</th>
          <th>التاريخ</th>
          <th>الحالة</th>
          ${compact ? "" : "<th>المصدر</th>"}
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${orders
          .map(
            (o) => `
          <tr>
            <td class="order-id">${esc(o.order_number || "#" + o.id)}</td>
            <td>${esc(o.customer_name)}</td>
            <td class="phone-cell">${esc(o.phone)}</td>
            <td class="product-cell" title="${esc(o.products_summary || "")}">${esc(o.products_summary || "—")}</td>
            <td style="white-space:nowrap;font-weight:800;">${fmtPrice(o.total_price)}</td>
            <td class="date-cell">${fmtDate(o.created_at)}</td>
            <td>${statusBadge(o.status)}</td>
            ${compact ? "" : `<td style="white-space:nowrap;font-size:0.83rem;">${SOURCE_LABELS[o.source] || esc(o.source || "—")}</td>`}
            <td>
              <div class="row-actions">
                <button class="mini-btn view" onclick="openOrder(${o.id})">👁 التفاصيل</button>
                <a class="mini-btn wa" href="${waLink(o)}" target="_blank" rel="noopener">💬 تواصل واتساب</a>
              </div>
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

let _orderImages = []; // للايت بوكس

async function openOrder(id) {
  try {
    const { order } = await api(`/api/admin/orders?id=${id}`);
    const items = order.items || [];
    _orderImages = (order.images || []).map((im) => ({
      src: im.url || (im.path ? "../" + im.path : ""),
      name: im.orig_name || "صورة مرجعية",
      size: im.size,
    }));

    document.getElementById("modalTitle").textContent = `تفاصيل الطلب ${order.order_number || "#" + order.id}`;
    document.getElementById("modalBody").innerHTML = `
      <div class="detail-rows">
        <div class="detail-item"><div class="k">👤 اسم العميل</div><div class="v">${esc(order.customer_name)}</div></div>
        <div class="detail-item"><div class="k">📱 رقم الهاتف</div><div class="v ltr">${esc(order.phone)}</div></div>
        ${order.email ? `<div class="detail-item"><div class="k">✉️ البريد الإلكتروني</div><div class="v ltr">${esc(order.email)}</div></div>` : ""}
        ${order.city ? `<div class="detail-item"><div class="k">🏙️ المحافظة / المدينة</div><div class="v">${esc(order.city)}</div></div>` : ""}
        ${order.address ? `<div class="detail-item full"><div class="k">📍 العنوان</div><div class="v">${esc(order.address)}</div></div>` : ""}
        <div class="detail-item"><div class="k">🕐 تاريخ الطلب</div><div class="v">${fmtDate(order.created_at)}</div></div>
        <div class="detail-item"><div class="k">🔄 آخر تحديث</div><div class="v">${fmtDate(order.updated_at)}</div></div>
        <div class="detail-item"><div class="k">📥 مصدر الطلب</div><div class="v">${SOURCE_LABELS[order.source] || esc(order.source || "—")}</div></div>
        <div class="detail-item"><div class="k">💰 الإجمالي</div><div class="v">${fmtPrice(order.total_price)}</div></div>
        <div class="detail-item full">
          <div class="k">🛒 المنتجات المطلوبة</div>
          ${items.length
            ? `<ul class="items-list">
                ${items.map((it) => `
                  <li>
                    <span>${esc(it.product_name)} × ${esc(it.quantity)} <small style="color:var(--muted);">(${fmtPrice(it.unit_price)} للقطعة)</small></span>
                    <span class="line-total">${fmtPrice(it.total_price)}</span>
                  </li>`).join("")}
                <li><span><strong>الإجمالي (شامل الشحن)</strong></span><span class="line-total">${fmtPrice(order.total_price)}</span></li>
              </ul>`
            : `<div class="v">—</div>`}
        </div>
        ${order.customer_notes ? `<div class="detail-item full"><div class="k">📝 تفاصيل الطباعة / ملاحظات العميل</div><div class="v" style="white-space:pre-wrap;">${esc(order.customer_notes)}</div></div>` : ""}
        ${_orderImages.length ? `
        <div class="detail-item full">
          <div class="k">🖼️ الصور المرجعية المرفقة (${_orderImages.length})</div>
          <div class="order-images">
            ${_orderImages.map((im, i) => `
              <button type="button" class="oi-thumb" onclick="openLightbox(${i})" title="${esc(im.name)}">
                <img src="${esc(im.src)}" alt="${esc(im.name)}" loading="lazy" />
              </button>`).join("")}
          </div>
        </div>` : ""}
      </div>

      <label class="modal-section-label" for="modalStatus">حالة الطلب</label>
      <select id="modalStatus">
        ${Object.entries(STATUS_LABELS)
          .map(([k, v]) => `<option value="${k}" ${order.status === k ? "selected" : ""}>${v}</option>`)
          .join("")}
      </select>

      <label class="modal-section-label" for="modalNotes">ملاحظات داخلية (يراها الأدمن فقط)</label>
      <textarea id="modalNotes" rows="3" placeholder="مثال: تم تأكيد التصميم مع العميل، التسليم يوم الخميس...">${esc(order.internal_notes || "")}</textarea>

      <div class="modal-actions">
        <button class="btn btn-primary" onclick="saveOrder(${order.id})">💾 حفظ التحديثات</button>
        <a class="btn btn-whatsapp" href="${waLink(order)}" target="_blank" rel="noopener">💬 تواصل واتساب</a>
        <button class="btn btn-danger" onclick="deleteOrder(${order.id})">🗑️ حذف الطلب</button>
      </div>`;

    document.getElementById("orderModal").classList.add("open");
  } catch (err) {
    handleErr(err);
  }
}

// ===== لايت بوكس الصور المرجعية =====
let _lightboxIndex = 0;
function openLightbox(index) {
  if (!_orderImages.length) return;
  _lightboxIndex = index;
  let box = document.getElementById("imgLightbox");
  if (!box) {
    box = document.createElement("div");
    box.id = "imgLightbox";
    box.className = "lightbox";
    box.innerHTML = `
      <button class="lb-close" type="button" aria-label="إغلاق" onclick="closeLightbox()">✕</button>
      <button class="lb-nav lb-prev" type="button" aria-label="السابق" onclick="lightboxStep(-1)">‹</button>
      <figure class="lb-figure">
        <img id="lbImg" src="" alt="" />
        <figcaption id="lbCap"></figcaption>
      </figure>
      <button class="lb-nav lb-next" type="button" aria-label="التالي" onclick="lightboxStep(1)">›</button>
      <a id="lbDownload" class="lb-download" download>⬇️ تحميل الأصل</a>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => { if (e.target === box) closeLightbox(); });
    document.addEventListener("keydown", lightboxKey);
  }
  renderLightbox();
  box.classList.add("open");
}
function renderLightbox() {
  const im = _orderImages[_lightboxIndex];
  if (!im) return;
  document.getElementById("lbImg").src = im.src;
  document.getElementById("lbImg").alt = im.name;
  document.getElementById("lbCap").textContent = `${im.name} — ${_lightboxIndex + 1} / ${_orderImages.length}`;
  const dl = document.getElementById("lbDownload");
  dl.href = im.src;
  dl.setAttribute("download", im.name || "reference");
  document.querySelector(".lb-prev").style.visibility = _orderImages.length > 1 ? "visible" : "hidden";
  document.querySelector(".lb-next").style.visibility = _orderImages.length > 1 ? "visible" : "hidden";
}
function lightboxStep(d) {
  _lightboxIndex = (_lightboxIndex + d + _orderImages.length) % _orderImages.length;
  renderLightbox();
}
function closeLightbox() {
  document.getElementById("imgLightbox")?.classList.remove("open");
}
function lightboxKey(e) {
  const box = document.getElementById("imgLightbox");
  if (!box || !box.classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") lightboxStep(1);
  else if (e.key === "ArrowRight") lightboxStep(-1);
}

async function saveOrder(id) {
  const status = document.getElementById("modalStatus").value;
  const internal_notes = document.getElementById("modalNotes").value;
  try {
    await api(`/api/admin/orders?id=${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, internal_notes }),
    });
    showToast("✅ تم حفظ حالة الطلب والملاحظات بنجاح");
    closeModal("orderModal");
    loadOverview();
    loadOrders();
  } catch (err) {
    handleErr(err);
  }
}

async function deleteOrder(id) {
  if (!confirm("هل أنت متأكد من حذف هذا الطلب نهائيًا؟ لا يمكن التراجع.")) return;
  try {
    await api(`/api/admin/orders?id=${id}`, { method: "DELETE" });
    showToast("🗑️ تم حذف الطلب");
    closeModal("orderModal");
    loadOverview();
    loadOrders();
  } catch (err) {
    handleErr(err);
  }
}

// ===================================================================
// إدارة المنتجات
// ===================================================================
async function loadCategories() {
  if (CATEGORIES.length) return;
  try {
    const { categories } = await api("/api/admin/categories");
    CATEGORIES = categories;
    const sel = document.getElementById("pCat");
    sel.innerHTML = `<option value="">كل التصنيفات</option>` +
      CATEGORIES.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("");
  } catch (err) {
    handleErr(err);
  }
}

async function loadProducts() {
  await loadCategories();
  const params = new URLSearchParams();
  const search = document.getElementById("pSearch").value.trim();
  const cat = document.getElementById("pCat").value;
  const filter = document.getElementById("pFilter").value;
  if (search) params.set("search", search);
  if (cat) params.set("cat", cat);
  if (filter) params.set("filter", filter);

  const wrap = document.getElementById("productsWrap");
  try {
    const { products } = await api("/api/admin/products?" + params.toString());
    PRODUCTS_CACHE = products;
    const hasFilters = search || cat || filter;
    wrap.innerHTML = products.length
      ? productsTableHTML(products)
      : emptyStateHTML(
          hasFilters ? "لا توجد نتائج مطابقة" : "لا توجد منتجات بعد",
          hasFilters ? "جرّب تعديل البحث أو الفلاتر" : "اضغط ➕ إضافة منتج لبدء بناء متجرك"
        );
  } catch (err) {
    handleErr(err);
  }
}

function productStatusBadges(p) {
  const badges = [];
  if (p.is_hidden) badges.push(`<span class="status-badge cancelled">🙈 مخفي مؤقتًا</span>`);
  else if (p.stock_status === "out_of_stock") badges.push(`<span class="status-badge pending_confirmation">📭 نفدت الكمية</span>`);
  else if (p.product_status === "unavailable") badges.push(`<span class="status-badge cancelled">🚫 غير متاح</span>`);
  else badges.push(`<span class="status-badge completed">✅ متاح</span>`);
  if (p.offer_active) badges.push(`<span class="status-badge offer">🔥 خصم ${p.discount_percent}%</span>`);
  else if (p.has_offer) badges.push(`<span class="status-badge muted-badge">⏸ عرض غير نشط</span>`);
  if (p.is_featured) badges.push(`<span class="status-badge featured">⭐ مميز</span>`);
  return badges.join(" ");
}

function productPriceHTML(p) {
  if (p.offer_active) {
    return `<small style="text-decoration:line-through;color:var(--muted);display:block;">${fmtPrice(p.regular_price)}</small><strong style="color:var(--c-red);">${fmtPrice(p.sale_price)}</strong>`;
  }
  return `<strong>${fmtPrice(p.regular_price)}</strong>`;
}

function productsTableHTML(products) {
  return `
    <table class="orders-table products-table">
      <thead>
        <tr>
          <th>المنتج</th>
          <th>التصنيف</th>
          <th>السعر</th>
          <th>الكمية</th>
          <th>الحالة</th>
          <th>الترتيب</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${products
          .map(
            (p) => `
          <tr class="${p.is_hidden ? "row-hidden" : ""}">
            <td>
              <div class="prod-cell">
                <img class="prod-thumb" src="../${esc(p.image || "images/logo.jpeg")}" alt="" onerror="this.src='../images/logo.jpeg'" />
                <span class="prod-name">${esc(p.name)}</span>
              </div>
            </td>
            <td style="white-space:nowrap;">${esc(p.category_name || "—")}</td>
            <td style="white-space:nowrap;">${productPriceHTML(p)}</td>
            <td style="white-space:nowrap;">${p.stock_quantity === null || p.stock_quantity === undefined ? "غير محدودة" : p.stock_quantity}</td>
            <td>${productStatusBadges(p)}</td>
            <td>${p.sort_order}</td>
            <td>
              <div class="row-actions">
                <button class="mini-btn view" onclick="openProductForm(${p.id})">✏️ تعديل</button>
                ${p.is_hidden
                  ? `<button class="mini-btn show" onclick="quickUpdateProduct(${p.id}, {is_hidden: 0}, 'تم إظهار المنتج في الموقع')">👁 إظهار</button>`
                  : `<button class="mini-btn hide" onclick="quickUpdateProduct(${p.id}, {is_hidden: 1}, 'تم إخفاء المنتج مؤقتًا من الموقع')">🙈 إخفاء</button>`}
                ${!p.is_hidden && p.product_status === "available"
                  ? `<button class="mini-btn hide" onclick="quickUpdateProduct(${p.id}, {product_status: 'unavailable'}, 'تم وضع المنتج كغير متوفر حاليًا')">🚫 غير متاح</button>`
                  : ""}
                ${!p.is_hidden && p.product_status === "unavailable"
                  ? `<button class="mini-btn show" onclick="quickUpdateProduct(${p.id}, {product_status: 'available'}, 'المنتج أصبح متاحًا')">✅ إتاحة</button>`
                  : ""}
                <button class="mini-btn danger" onclick="deleteProduct(${p.id}, '${esc(p.name).replace(/'/g, "\\'")}')">🗑️</button>
              </div>
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

async function quickUpdateProduct(id, patch, successMsg) {
  try {
    await api(`/api/admin/products?id=${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    showToast("✅ " + successMsg);
    loadProducts();
  } catch (err) {
    handleErr(err);
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`حذف نهائي للمنتج "${name}"؟\n\nنصيحة: يمكنك إخفاؤه مؤقتًا بدلاً من الحذف. الطلبات السابقة لن تتأثر.`)) return;
  try {
    await api(`/api/admin/products?id=${id}`, { method: "DELETE" });
    showToast("🗑️ تم حذف المنتج نهائيًا");
    loadProducts();
    loadOverview();
  } catch (err) {
    handleErr(err);
  }
}

// ===== نموذج إضافة / تعديل منتج =====
function openProductForm(id) {
  const p = id ? PRODUCTS_CACHE.find((x) => x.id === id) : null;
  pendingImageData = null;

  let details = [];
  try { details = JSON.parse((p && p.details_json) || "[]"); } catch { details = []; }
  const detailsText = details.map((r) => `${r[0]} | ${r[1]}`).join("\n");

  document.getElementById("productModalTitle").textContent = p ? `تعديل: ${p.name}` : "إضافة منتج جديد";
  document.getElementById("productModalBody").innerHTML = `
    <div class="pform">
      <div class="form-group">
        <label>اسم المنتج *</label>
        <input type="text" id="pfName" value="${esc(p ? p.name : "")}" placeholder="مثال: درع خشبي مميز">
      </div>

      <div class="form-group">
        <label>صورة المنتج</label>
        <div class="img-upload-row">
          <img id="pfImgPreview" class="img-preview" src="${p && p.image ? "../" + esc(p.image) : "../images/logo.jpeg"}" onerror="this.src='../images/logo.jpeg'" />
          <div style="flex:1;">
            <input type="file" id="pfImageFile" accept="image/png,image/jpeg,image/webp,image/gif">
            <small style="color:var(--muted);display:block;margin-top:4px;">PNG / JPG / WEBP — حتى 3 ميجابايت</small>
          </div>
        </div>
      </div>

      <div class="form-2col">
        <div class="form-group">
          <label>التصنيف</label>
          <select id="pfCat">
            ${CATEGORIES.map((c) => `<option value="${c.id}" ${p && p.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>الترتيب في صفحة المنتجات</label>
          <input type="number" id="pfSort" value="${p ? p.sort_order : ""}" placeholder="تلقائي">
        </div>
      </div>

      <div class="form-group">
        <label>وصف مختصر</label>
        <input type="text" id="pfShortDesc" value="${esc(p ? p.short_description || "" : "")}" placeholder="جملة واحدة تظهر في البطاقة">
      </div>
      <div class="form-group">
        <label>الوصف التفصيلي</label>
        <textarea id="pfDesc" rows="3" placeholder="وصف كامل يظهر في صفحة المنتج">${esc(p ? p.description || "" : "")}</textarea>
      </div>
      <div class="form-group">
        <label>المواصفات (سطر لكل خاصية بصيغة: الاسم | القيمة)</label>
        <textarea id="pfDetails" rows="3" placeholder="الخامة | خشب طبيعي&#10;المقاس | 20 × 15 سم">${esc(detailsText)}</textarea>
      </div>

      <h3 class="pform-section">💰 السعر والعرض</h3>
      <div class="form-2col">
        <div class="form-group">
          <label>السعر الأساسي (ج.م) *</label>
          <input type="number" id="pfPrice" min="0" step="0.5" value="${p ? p.regular_price : ""}" oninput="updateDiscountHint()">
        </div>
        <div class="form-group">
          <label>سعر العرض (ج.م)</label>
          <input type="number" id="pfSalePrice" min="0" step="0.5" value="${p && p.sale_price !== null && p.sale_price !== undefined ? p.sale_price : ""}" oninput="updateDiscountHint()">
        </div>
      </div>
      <label class="check-row">
        <input type="checkbox" id="pfHasOffer" ${p && p.has_offer ? "checked" : ""} onchange="updateDiscountHint()">
        <span>تفعيل العرض <span id="discountHint" class="discount-hint"></span></span>
      </label>
      <div class="form-2col">
        <div class="form-group">
          <label>بداية العرض (اختياري)</label>
          <input type="date" id="pfOfferStart" value="${esc(p ? p.offer_start_date || "" : "")}">
        </div>
        <div class="form-group">
          <label>نهاية العرض (اختياري)</label>
          <input type="date" id="pfOfferEnd" value="${esc(p ? p.offer_end_date || "" : "")}">
        </div>
      </div>

      <h3 class="pform-section">📦 التوفر والحالة</h3>
      <div class="form-2col">
        <div class="form-group">
          <label>حالة المنتج</label>
          <select id="pfStatus">
            <option value="available" ${!p || p.product_status === "available" ? "selected" : ""}>✅ متاح</option>
            <option value="unavailable" ${p && p.product_status === "unavailable" ? "selected" : ""}>🚫 غير متاح حاليًا</option>
          </select>
        </div>
        <div class="form-group">
          <label>حالة المخزون</label>
          <select id="pfStock">
            <option value="in_stock" ${!p || p.stock_status === "in_stock" ? "selected" : ""}>✅ متوفر</option>
            <option value="out_of_stock" ${p && p.stock_status === "out_of_stock" ? "selected" : ""}>📭 نفدت الكمية</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>الكمية المتاحة (اتركها فارغة = غير محدودة، تُخصم تلقائياً مع كل طلب)</label>
        <input type="number" id="pfQty" min="0" value="${p && p.stock_quantity !== null && p.stock_quantity !== undefined ? p.stock_quantity : ""}">
      </div>
      <label class="check-row">
        <input type="checkbox" id="pfFeatured" ${p && p.is_featured ? "checked" : ""}>
        <span>⭐ منتج مميز</span>
      </label>
      <label class="check-row">
        <input type="checkbox" id="pfHidden" ${p && p.is_hidden ? "checked" : ""}>
        <span>🙈 مخفي مؤقتًا (لا يظهر للعملاء نهائيًا)</span>
      </label>

      <div class="form-group" style="margin-top:10px;">
        <label>ملاحظات داخلية للإدارة</label>
        <textarea id="pfNotes" rows="2" placeholder="مثال: المورّد فلان، التكلفة كذا...">${esc(p ? p.internal_notes || "" : "")}</textarea>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" id="pfSaveBtn" onclick="saveProduct(${p ? p.id : "null"})">💾 ${p ? "حفظ التعديلات" : "إضافة المنتج"}</button>
      </div>
    </div>`;

  // معاينة الصورة عند اختيار ملف
  document.getElementById("pfImageFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      showToast("⚠️ حجم الصورة أكبر من 3 ميجابايت", "error");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingImageData = reader.result;
      document.getElementById("pfImgPreview").src = pendingImageData;
    };
    reader.readAsDataURL(file);
  });

  updateDiscountHint();
  document.getElementById("productModal").classList.add("open");
}

function updateDiscountHint() {
  const hint = document.getElementById("discountHint");
  if (!hint) return;
  const price = Number(document.getElementById("pfPrice").value);
  const sale = Number(document.getElementById("pfSalePrice").value);
  const on = document.getElementById("pfHasOffer").checked;
  if (on && price > 0 && sale > 0 && sale < price) {
    hint.textContent = `— خصم ${Math.round((1 - sale / price) * 100)}% تلقائيًا`;
  } else if (on && sale >= price && price > 0) {
    hint.textContent = "— ⚠️ سعر العرض يجب أن يكون أقل من الأساسي";
  } else {
    hint.textContent = "";
  }
}

function parseDetailsText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("|");
      if (i === -1) return null;
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
    .filter((r) => r && r[0]);
}

async function saveProduct(id) {
  const btn = document.getElementById("pfSaveBtn");
  const name = document.getElementById("pfName").value.trim();
  const price = Number(document.getElementById("pfPrice").value);
  if (!name || name.length < 2) return showToast("⚠️ اكتب اسم المنتج", "error");
  if (!(price > 0)) return showToast("⚠️ اكتب سعرًا أساسيًا صحيحًا", "error");

  const hasOffer = document.getElementById("pfHasOffer").checked;
  const saleRaw = document.getElementById("pfSalePrice").value;
  const sale = saleRaw === "" ? null : Number(saleRaw);
  if (hasOffer && (!sale || sale <= 0 || sale >= price))
    return showToast("⚠️ لتفعيل العرض اكتب سعر عرض أقل من السعر الأساسي", "error");

  btn.disabled = true;
  btn.textContent = "جارٍ الحفظ...";

  try {
    // رفع الصورة الجديدة أولاً إن وجدت
    let imagePath;
    if (pendingImageData) {
      const up = await api("/api/admin/upload", {
        method: "POST",
        body: JSON.stringify({ data: pendingImageData }),
      });
      imagePath = up.path;
    }

    const payload = {
      name,
      regular_price: price,
      sale_price: sale,
      has_offer: hasOffer ? 1 : 0,
      offer_start_date: document.getElementById("pfOfferStart").value || null,
      offer_end_date: document.getElementById("pfOfferEnd").value || null,
      category_id: Number(document.getElementById("pfCat").value) || null,
      short_description: document.getElementById("pfShortDesc").value.trim(),
      description: document.getElementById("pfDesc").value.trim(),
      details: parseDetailsText(document.getElementById("pfDetails").value),
      product_status: document.getElementById("pfStatus").value,
      stock_status: document.getElementById("pfStock").value,
      stock_quantity: document.getElementById("pfQty").value === "" ? null : Number(document.getElementById("pfQty").value),
      is_featured: document.getElementById("pfFeatured").checked ? 1 : 0,
      is_hidden: document.getElementById("pfHidden").checked ? 1 : 0,
      internal_notes: document.getElementById("pfNotes").value.trim(),
    };
    const sortVal = document.getElementById("pfSort").value;
    if (sortVal !== "") payload.sort_order = Number(sortVal);
    if (imagePath) payload.image = imagePath;

    if (id) {
      await api(`/api/admin/products?id=${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      showToast("✅ تم حفظ تعديلات المنتج بنجاح");
    } else {
      await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
      showToast("✅ تمت إضافة المنتج بنجاح");
    }
    closeModal("productModal");
    loadProducts();
    loadOverview();
  } catch (err) {
    handleErr(err);
  }
  btn.disabled = false;
  btn.textContent = id ? "💾 حفظ التعديلات" : "💾 إضافة المنتج";
}

// ===================================================================
// الإعدادات
// ===================================================================
async function loadSettings() {
  try {
    const s = await api("/api/admin/settings");
    document.getElementById("setWaEnabled").checked = !!s.whatsapp_order_enabled;
    document.getElementById("setShipping").value = s.shipping_fee;
    document.getElementById("setStorePhone").value = s.store_phone;
  } catch (err) {
    handleErr(err);
  }
  loadShipping();
}

// ===================================================================
// الشحن حسب المحافظة
// ===================================================================
let ZONES_CACHE = [];
async function loadShipping() {
  const wrap = document.getElementById("zonesWrap");
  try {
    const { zones } = await api("/api/admin/shipping");
    ZONES_CACHE = zones;
    if (!zones.length) {
      wrap.innerHTML = emptyStateHTML("لا توجد مناطق شحن", "أضف محافظة لتحديد سعر شحنها");
      return;
    }
    wrap.innerHTML = `
      <table class="orders-table zones-table">
        <thead><tr>
          <th>المحافظة</th><th>الشحن</th><th>مدة التوصيل</th><th>شحن مجاني فوق</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>
          ${zones.map((z) => `
            <tr class="${z.enabled ? "" : "row-off"}">
              <td data-label="المحافظة"><strong>${esc(z.name)}</strong></td>
              <td data-label="الشحن">${fmtPrice(z.fee)}</td>
              <td data-label="مدة التوصيل">${esc(z.delivery_time || "—")}</td>
              <td data-label="شحن مجاني فوق">${z.free_threshold ? fmtPrice(z.free_threshold) : "—"}</td>
              <td data-label="الحالة">${z.enabled ? '<span class="status-badge completed">مفعّل</span>' : '<span class="status-badge cancelled">معطّل</span>'}</td>
              <td data-label="إجراءات">
                <div class="row-actions">
                  <button class="mini-btn view" onclick="openZoneForm(${z.id})">✏️ تعديل</button>
                  <button class="mini-btn ${z.enabled ? "hide" : "show"}" onclick="toggleZone(${z.id}, ${z.enabled ? "false" : "true"})">${z.enabled ? "🚫 تعطيل" : "✅ تفعيل"}</button>
                  <button class="mini-btn danger" onclick="deleteZone(${z.id}, '${esc(z.name).replace(/'/g, "\\'")}')">🗑️</button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    handleErr(err);
  }
}

function openZoneForm(id) {
  const z = id ? ZONES_CACHE.find((x) => x.id === id) : null;
  document.getElementById("zoneModalTitle").textContent = z ? `تعديل: ${z.name}` : "إضافة منطقة شحن";
  document.getElementById("zoneModalBody").innerHTML = `
    <div class="form-group"><label>اسم المحافظة / المنطقة *</label>
      <input type="text" id="zName" value="${z ? esc(z.name) : ""}" placeholder="مثال: القاهرة"></div>
    <div class="form-row">
      <div class="form-group"><label>سعر الشحن (ج.م) *</label>
        <input type="number" id="zFee" min="0" step="1" value="${z ? z.fee : 50}"></div>
      <div class="form-group"><label>شحن مجاني فوق (اختياري)</label>
        <input type="number" id="zFree" min="0" step="1" value="${z && z.free_threshold ? z.free_threshold : ""}" placeholder="اتركه فارغاً"></div>
    </div>
    <div class="form-group"><label>مدة التوصيل</label>
      <input type="text" id="zTime" value="${z ? esc(z.delivery_time || "") : "2 – 4 أيام عمل"}" placeholder="مثال: 2 – 4 أيام عمل"></div>
    <div class="form-group"><label>ملاحظة للعميل (اختياري)</label>
      <input type="text" id="zNotes" value="${z ? esc(z.notes || "") : ""}" placeholder="تظهر للعميل عند اختيار المحافظة"></div>
    <label class="toggle-row"><span><strong>مفعّل (متاح للتوصيل)</strong></span>
      <span class="switch"><input type="checkbox" id="zEnabled" ${!z || z.enabled ? "checked" : ""}><span class="slider"></span></span></label>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="saveZone(${z ? z.id : "null"})">💾 حفظ</button>
    </div>`;
  document.getElementById("zoneModal").classList.add("open");
}

async function saveZone(id) {
  const payload = {
    name: document.getElementById("zName").value.trim(),
    fee: Number(document.getElementById("zFee").value),
    free_threshold: document.getElementById("zFree").value === "" ? null : Number(document.getElementById("zFree").value),
    delivery_time: document.getElementById("zTime").value.trim(),
    notes: document.getElementById("zNotes").value.trim(),
    enabled: document.getElementById("zEnabled").checked,
  };
  if (!payload.name) return showToast("اسم المحافظة مطلوب", "error");
  try {
    await api(id ? `/api/admin/shipping?id=${id}` : "/api/admin/shipping", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    showToast("✅ تم حفظ منطقة الشحن");
    closeModal("zoneModal");
    loadShipping();
  } catch (err) {
    handleErr(err);
  }
}

async function toggleZone(id, enable) {
  try {
    await api(`/api/admin/shipping?id=${id}`, { method: "PATCH", body: JSON.stringify({ enabled: enable }) });
    loadShipping();
  } catch (err) {
    handleErr(err);
  }
}

async function deleteZone(id, name) {
  if (!confirm(`حذف منطقة الشحن "${name}"؟`)) return;
  try {
    await api(`/api/admin/shipping?id=${id}`, { method: "DELETE" });
    showToast("🗑️ تم حذف المنطقة");
    loadShipping();
  } catch (err) {
    handleErr(err);
  }
}

async function saveSettings() {
  try {
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        whatsapp_order_enabled: document.getElementById("setWaEnabled").checked ? 1 : 0,
        shipping_fee: Number(document.getElementById("setShipping").value),
        store_phone: document.getElementById("setStorePhone").value.trim(),
      }),
    });
    showToast("✅ تم حفظ الإعدادات بنجاح");
  } catch (err) {
    handleErr(err);
  }
}

// ===================================================================
// إدارة الفئات
// ===================================================================
let CATS_ADMIN = [];
let pendingCatImage = null;

async function loadCategories() {
  const wrap = document.getElementById("categoriesWrap");
  try {
    const { categories } = await api("/api/admin/categories");
    CATS_ADMIN = categories;
    if (!categories.length) {
      wrap.innerHTML = emptyStateHTML("لا توجد فئات", "أضف فئة لتصنيف منتجاتك");
      return;
    }
    wrap.innerHTML = `
      <table class="orders-table zones-table">
        <thead><tr><th>الفئة</th><th>الوصف</th><th>الترتيب</th><th>الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>
          ${categories.map((c) => `
            <tr class="${c.is_visible ? "" : "row-off"}">
              <td data-label="الفئة">
                <div style="display:flex;align-items:center;gap:10px;">
                  <img src="${c.image ? "../" + esc(c.image) : "../images/logo.jpeg"}" alt="" class="cat-thumb" onerror="this.src='../images/logo.jpeg'" style="width:42px;height:42px;border-radius:8px;object-fit:cover;" />
                  <strong>${esc(c.name)}</strong>
                </div>
              </td>
              <td data-label="الوصف">${esc(c.description || "—")}</td>
              <td data-label="الترتيب">${c.display_order}</td>
              <td data-label="الحالة">${c.is_visible ? '<span class="status-badge completed">ظاهرة</span>' : '<span class="status-badge cancelled">مخفية</span>'}</td>
              <td data-label="إجراءات">
                <div class="row-actions">
                  <button class="mini-btn view" onclick="openCategoryForm(${c.id})">✏️ تعديل</button>
                  <button class="mini-btn ${c.is_visible ? "hide" : "show"}" onclick="toggleCategory(${c.id}, ${c.is_visible ? "false" : "true"})">${c.is_visible ? "🙈 إخفاء" : "👁 إظهار"}</button>
                  <button class="mini-btn danger" onclick="deleteCategory(${c.id}, '${esc(c.name).replace(/'/g, "\\'")}')">🗑️</button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (err) {
    handleErr(err);
  }
}

function openCategoryForm(id) {
  const c = id ? CATS_ADMIN.find((x) => x.id === id) : null;
  pendingCatImage = null;
  document.getElementById("categoryModalTitle").textContent = c ? `تعديل: ${c.name}` : "إضافة فئة";
  document.getElementById("categoryModalBody").innerHTML = `
    <div class="form-group"><label>اسم الفئة *</label>
      <input type="text" id="cName" value="${c ? esc(c.name) : ""}" placeholder="مثال: دروع وتذكارات"></div>
    <div class="form-group"><label>الوصف</label>
      <textarea id="cDesc" rows="2" placeholder="وصف قصير يظهر للعميل">${c ? esc(c.description || "") : ""}</textarea></div>
    <div class="form-group"><label>صورة الفئة</label>
      <img id="cImgPreview" class="img-preview" src="${c && c.image ? "../" + esc(c.image) : "../images/logo.jpeg"}" onerror="this.src='../images/logo.jpeg'" style="width:90px;height:90px;border-radius:10px;object-fit:cover;display:block;margin-bottom:8px;" />
      <input type="file" accept="image/jpeg,image/png,image/webp" onchange="onCatImageChange(this)"></div>
    <div class="form-row">
      <div class="form-group"><label>ترتيب العرض</label>
        <input type="number" id="cOrder" value="${c ? c.display_order : 0}"></div>
      <div class="form-group"><label>عنوان SEO (اختياري)</label>
        <input type="text" id="cSeoTitle" value="${c ? esc(c.seo_title || "") : ""}"></div>
    </div>
    <label class="toggle-row"><span><strong>ظاهرة في المتجر</strong></span>
      <span class="switch"><input type="checkbox" id="cVisible" ${!c || c.is_visible ? "checked" : ""}><span class="slider"></span></span></label>
    <div class="modal-actions">
      <button class="btn btn-primary" id="cSaveBtn" onclick="saveCategory(${c ? c.id : "null"})">💾 حفظ</button>
    </div>`;
  document.getElementById("categoryModal").classList.add("open");
}

function onCatImageChange(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingCatImage = reader.result;
    document.getElementById("cImgPreview").src = pendingCatImage;
  };
  reader.readAsDataURL(file);
}

async function saveCategory(id) {
  const btn = document.getElementById("cSaveBtn");
  const payload = {
    name: document.getElementById("cName").value.trim(),
    description: document.getElementById("cDesc").value.trim(),
    display_order: Number(document.getElementById("cOrder").value) || 0,
    seo_title: document.getElementById("cSeoTitle").value.trim(),
    is_visible: document.getElementById("cVisible").checked,
  };
  if (!payload.name) return showToast("اسم الفئة مطلوب", "error");
  btn.disabled = true;
  try {
    if (pendingCatImage) {
      const up = await api("/api/admin/upload", { method: "POST", body: JSON.stringify({ data: pendingCatImage }) });
      payload.image = up.path;
    }
    await api(id ? `/api/admin/categories?id=${id}` : "/api/admin/categories", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    showToast("✅ تم حفظ الفئة");
    closeModal("categoryModal");
    loadCategories();
  } catch (err) {
    handleErr(err);
    btn.disabled = false;
  }
}

async function toggleCategory(id, visible) {
  try {
    await api(`/api/admin/categories?id=${id}`, { method: "PATCH", body: JSON.stringify({ is_visible: visible }) });
    loadCategories();
  } catch (err) {
    handleErr(err);
  }
}

async function deleteCategory(id, name) {
  if (!confirm(`حذف الفئة "${name}"؟ المنتجات المرتبطة بها ستصبح بدون فئة.`)) return;
  try {
    await api(`/api/admin/categories?id=${id}`, { method: "DELETE" });
    showToast("🗑️ تم حذف الفئة");
    loadCategories();
  } catch (err) {
    handleErr(err);
  }
}

// ===================================================================
// عام: النوافذ، الفلاتر، الخروج
// ===================================================================
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("open");
}
["orderModal", "productModal", "zoneModal", "categoryModal"].forEach((mid) => {
  document.getElementById(mid).addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal(mid);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal("orderModal");
    closeModal("productModal");
  }
});

async function logout() {
  try { await fetch("/api/admin/logout", { method: "POST" }); } catch {}
  location.href = "login.html";
}

// فلاتر الطلبات
let searchTimer;
document.getElementById("fSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadOrders, 350);
});
["fStatus", "fFrom", "fTo"].forEach((id) => {
  document.getElementById(id).addEventListener("change", loadOrders);
});
function clearFilters() {
  ["fSearch", "fStatus", "fFrom", "fTo"].forEach((id) => (document.getElementById(id).value = ""));
  loadOrders();
}

// فلاتر المنتجات
let pSearchTimer;
document.getElementById("pSearch").addEventListener("input", () => {
  clearTimeout(pSearchTimer);
  pSearchTimer = setTimeout(loadProducts, 350);
});
["pCat", "pFilter"].forEach((id) => {
  document.getElementById(id).addEventListener("change", loadProducts);
});
function clearProductFilters() {
  ["pSearch", "pCat", "pFilter"].forEach((id) => (document.getElementById(id).value = ""));
  loadProducts();
}

// ===== بدء التشغيل =====
(async function init() {
  initAdminTheme();
  try {
    await api("/api/admin/me");
  } catch {
    return;
  }
  loadCategories();
  loadOverview();
  loadOrders();
})();
