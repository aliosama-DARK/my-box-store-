/* ====================================================
   MY BOX STORE — منطق لوحة التحكم v2
   طلبات + منتجات + عروض + إعدادات
   ==================================================== */

const COMPANY_NAME = "MY BOX STORE";

const STATUS_LABELS = {
  new: "جديد",
  contacted: "تم التواصل",
  pending_confirmation: "في انتظار التأكيد",
  in_progress: "قيد التنفيذ",
  prepared: "تم التجهيز",
  delivered: "تم التسليم",
  completed: "مكتمل",
  cancelled: "ملغي",
};

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
  const key = STATUS_LABELS[status] ? status : "new";
  return `<span class="status-badge ${key}">${STATUS_LABELS[key]}</span>`;
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
const VIEWS = ["overview", "orders", "products", "settings"];
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

async function openOrder(id) {
  try {
    const { order } = await api(`/api/admin/orders/${id}`);
    const items = order.items || [];

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
        ${order.customer_notes ? `<div class="detail-item full"><div class="k">📝 ملاحظات العميل / التخصيص</div><div class="v">${esc(order.customer_notes)}</div></div>` : ""}
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

async function saveOrder(id) {
  const status = document.getElementById("modalStatus").value;
  const internal_notes = document.getElementById("modalNotes").value;
  try {
    await api(`/api/admin/orders/${id}`, {
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
    await api(`/api/admin/orders/${id}`, { method: "DELETE" });
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
    await api(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    showToast("✅ " + successMsg);
    loadProducts();
  } catch (err) {
    handleErr(err);
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`حذف نهائي للمنتج "${name}"؟\n\nنصيحة: يمكنك إخفاؤه مؤقتًا بدلاً من الحذف. الطلبات السابقة لن تتأثر.`)) return;
  try {
    await api(`/api/admin/products/${id}`, { method: "DELETE" });
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
      await api(`/api/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
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
// عام: النوافذ، الفلاتر، الخروج
// ===================================================================
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("open");
}
["orderModal", "productModal"].forEach((mid) => {
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
  try {
    await api("/api/admin/me");
  } catch {
    return;
  }
  loadCategories();
  loadOverview();
  loadOrders();
})();
