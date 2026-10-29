(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const DB_KEY = "biza_lite_db_v1";
  const CART_KEY = "biza_lite_cart_v1";
  const HANDLE_DB = "biza_lite_handles";
  const HANDLE_STORE = "handles";
  let directoryHandle = null;
  let folderReady = false;
  let cacheOnlyMode = false;
  let writeQueue = Promise.resolve();
  // Snapshot each folder file so a sale updates only the files whose contents actually changed.
  const persistedSnapshots = { products: null, invoices: null, movements: null, settings: null };
  let db = { products: [], invoices: [], movements: [], settings: { vipLocal: false } };
  // Keep the in-progress invoice across a page reload or return to the app.
  let cart = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(x => x && x.productId && Number(x.quantity) > 0) : [];
    } catch { return []; }
  })();
  let toastTimer;

  const num = v => Number(v || 0);
  const money = v => Math.round(num(v)).toLocaleString("fa-IR");
  const digits = v => String(v).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  // Treat visually identical barcodes as the same value (Persian/Arabic digits and whitespace normalized).
  const normalizeBarcode = v => digits(String(v ?? "")).trim().replace(/\s+/g, "").toLowerCase();
  const todayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const dateFa = value => { try { return new Date(value).toLocaleString("fa-IR",{dateStyle:"short",timeStyle:"short"}); } catch { return value; } };
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  function toast(message) {
    const el=$("toast"); el.textContent=message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600);
  }
  function setConnection(state, message) {
    $("dbDot").className = "dot " + (state === "ok" ? "ok" : state === "bad" ? "bad" : "");
    $("dbStatus").textContent = message;
  }
  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(HANDLE_STORE)) req.result.createObjectStore(HANDLE_STORE); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async function storeHandle(handle) {
    const idb = await openHandleDb();
    await new Promise((resolve, reject) => { const tx=idb.transaction(HANDLE_STORE,"readwrite"); tx.objectStore(HANDLE_STORE).put(handle,"directory"); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
    idb.close();
  }
  async function getStoredHandle() {
    const idb = await openHandleDb();
    const handle = await new Promise((resolve, reject) => { const req=idb.transaction(HANDLE_STORE,"readonly").objectStore(HANDLE_STORE).get("directory"); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error); });
    idb.close(); return handle;
  }
  async function readJsonFile(name, fallback) {
    try { const handle=await directoryHandle.getFileHandle(name); const file=await handle.getFile(); return JSON.parse(await file.text()); }
    catch (err) { if (err.name === "NotFoundError") return fallback; throw err; }
  }
  async function writeJsonFile(name, data) {
    const handle=await directoryHandle.getFileHandle(name,{create:true});
    const writable=await handle.createWritable(); await writable.write(JSON.stringify(data,null,2)); await writable.close();
  }
  async function loadFolderData() {
    if (!directoryHandle) return false;
    const permission=await directoryHandle.queryPermission({mode:"readwrite"});
    if(permission!=="granted"){folderReady=false;setConnection("bad","برای دسترسی، دیتابیس را متصل کنید");return false;}
    let products=await readJsonFile("biza-products.json",null);
    let invoices=await readJsonFile("biza-invoices.json",null);
    let movements=await readJsonFile("biza-stock-movements.json",null);
    let settings=await readJsonFile("biza-settings.json",null);
    // Migrate existing data from the browser cache if this folder is new/empty.
    let migratedFromCache = false;
    if(products===null&&invoices===null&&movements===null){
      try{const old=JSON.parse(localStorage.getItem(DB_KEY)||"null");if(old){products=old.products||[];invoices=old.invoices||[];movements=old.movements||[];settings=old.settings||{vipLocal:false};migratedFromCache=true;}}catch{}
    }
    db={products:Array.isArray(products)?products:[],invoices:Array.isArray(invoices)?invoices:[],movements:Array.isArray(movements)?movements:[],settings:settings&&typeof settings==="object"?settings:{vipLocal:false}};
    persistedSnapshots.products = products === null ? null : JSON.stringify(db.products);
    persistedSnapshots.invoices = invoices === null ? null : JSON.stringify(db.invoices);
    persistedSnapshots.movements = movements === null ? null : JSON.stringify(db.movements);
    persistedSnapshots.settings = settings === null ? null : JSON.stringify(db.settings);
    folderReady=true;
    cacheOnlyMode=false;
    localStorage.setItem(DB_KEY,JSON.stringify(db));
    localStorage.removeItem("biza_lite_cache_dirty");
    // Avoid rewriting all files at every startup; only perform a one-time migration when needed.
    if (migratedFromCache) {
      persistedSnapshots.products = persistedSnapshots.invoices = persistedSnapshots.movements = persistedSnapshots.settings = null;
      await persistFiles();
    }
    setConnection("ok"," دیتابیس متصل است");
    return true;
  }
  async function persistFiles() {
    if(!directoryHandle||cacheOnlyMode) return;
    const files = [
      ["products", "biza-products.json", db.products],
      ["invoices", "biza-invoices.json", db.invoices],
      ["movements", "biza-stock-movements.json", db.movements],
      ["settings", "biza-settings.json", db.settings]
    ];
    for (const [key, filename, data] of files) {
      const snapshot = JSON.stringify(data);
      if (persistedSnapshots[key] === snapshot) continue;
      await writeJsonFile(filename, data);
      persistedSnapshots[key] = snapshot;
    }
  }
  function loadDb() { return folderReady; }
  function saveDb() {
    if(!folderReady){setConnection("bad","دیتابیس بارگذاری نشده است");toast("اطلاعات بارگذاری نشده؛ صفحه را دوباره باز کن.");return false;}
    localStorage.setItem(DB_KEY,JSON.stringify(db));
    if(cacheOnlyMode||!directoryHandle){localStorage.setItem("biza_lite_cache_dirty","yes");setConnection("bad","ذخیره محلی فعال است؛ دیتابیس فعلاً اجازه دسترسی نداده");toast("تغییرات در حافظه مرورگر ذخیره شد؛ برای همگام‌سازی دیتابیس را متصل کنید");return true;}
    setConnection("ok","در حال ذخیره اطلاعات…");
    writeQueue=writeQueue.then(()=>persistFiles()).then(()=>{setConnection("ok"," دیتابیس متصل است");}).catch(err=>{cacheOnlyMode=true;localStorage.setItem(DB_KEY,JSON.stringify(db));setConnection("bad","ذخیره محلی؛ دسترسی دیتابیس موقتاً قطع شد");toast("اجازه دیتابیس موقتاً قطع شد؛ تغییرات در مرورگر نگه داشته شد.");console.error(err);});
    return true;
  }
  async function connectFolder(pickNew=false) {
    try {
      if(!window.showDirectoryPicker){toast("این مرورگر اتصال مستقیم پوشه را پشتیبانی نمی‌کند. سایت را در Chrome و با HTTPS باز کن.");return false;}
      let handle=null;
      if(!pickNew) { try { handle=await getStoredHandle(); } catch {} }
      if(handle){let perm=await handle.queryPermission({mode:"readwrite"});if(perm!=="granted")perm=await handle.requestPermission({mode:"readwrite"});if(perm!=="granted")handle=null;}
      if(!handle) handle=await window.showDirectoryPicker({mode:"readwrite"});
      directoryHandle=handle; await storeHandle(handle);
      let ok=false;
      if(cacheOnlyMode){
        // The browser cache is the recovery copy from the last visit; sync it into the chosen folder.
        const perm=await directoryHandle.queryPermission({mode:"readwrite"});
        if(perm==="granted"){
          folderReady=true; cacheOnlyMode=false;
          persistedSnapshots.products = persistedSnapshots.invoices = persistedSnapshots.movements = persistedSnapshots.settings = null;
          await persistFiles();
          setConnection("ok"," دیتابیس متصل است"); ok=true;
        }
      } else ok=await loadFolderData();
      if(ok){toast(" دیتابیس وصل و همگام شد.");showApp();}
      return ok;
    } catch(err){if(err.name!=="AbortError") {console.error(err);toast("اتصال دیتابیس انجام نشد؛ اجازه دسترسی را بررسی کن.");}return false;}
  }
  function showApp() {
    $("appView").classList.remove("hidden");
    renderAll();
  }
  function goPage(page) {
    document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
    const el=$("page-"+page); if(el) el.classList.remove("hidden");
    // Remember the current panel so refreshes and scanner round-trips return to the same section.
    try { localStorage.setItem("biza_lite_current_page", page); } catch {}
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function renderAll() { renderHome(); renderInventory(); renderCart(); renderInvoices(); }
  function renderHome() {
    $("statProducts").textContent=db.products.length.toLocaleString("fa-IR");
    $("statStock").textContent=db.products.reduce((s,p)=>s+num(p.quantity),0).toLocaleString("fa-IR");
    const today=db.invoices.filter(i=>todayKey(new Date(i.createdAt))===todayKey());
    $("statRevenue").textContent=money(today.reduce((s,i)=>s+num(i.total),0));
    $("statInvoices").textContent=today.length.toLocaleString("fa-IR");
    const low=db.products.filter(p=>num(p.quantity)<=5);
    $("lowCount").textContent=low.length.toLocaleString("fa-IR")+" مورد";
    $("lowStockList").innerHTML=low.length?low.slice(0,6).map(p=>`<div class="list-row"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.barcode||"بدون بارکد")}</small></div><b class="danger-text">${money(p.quantity)} عدد</b></div>`).join(""):'<div class="empty-state">فعلاً کالایی برای هشدار وجود ندارد.</div>';
    const recent=[...db.invoices].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
    $("recentInvoices").innerHTML=invoiceTableHtml(recent);
  }
  function renderInventory() {
    const q=$("inventorySearch").value.trim().toLowerCase();
    const list=db.products.filter(p=>!q||p.name.toLowerCase().includes(q)||String(p.barcode||"").toLowerCase().includes(q));
    $("productCountBadge").textContent=list.length.toLocaleString("fa-IR")+" کالا";
    $("inventoryTable").innerHTML=list.length?`<table><thead><tr><th>کالا</th><th>بارکد</th><th>خرید</th><th>فروش</th><th>موجودی</th><th>عملیات</th></tr></thead><tbody>${list.map(p=>`<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.barcode||"—")}</td><td>${money(p.purchasePrice)}</td><td>${money(p.salePrice)}</td><td>${money(p.quantity)}</td><td><button class="table-action" data-edit="${p.id}">ویرایش</button><button class="table-action delete" data-delete="${p.id}">حذف</button></td></tr>`).join("")}</tbody></table>`:'<div class="table-empty">کالایی پیدا نشد. اولین کالا را ثبت کن.</div>';
  }
  function invoiceTableHtml(items) {
    if(!items.length) return '<div class="table-empty">هنوز فاکتوری ثبت نشده است.</div>';
    return `<table><thead><tr><th>شماره فاکتور</th><th>تاریخ</th><th>تعداد اقلام</th><th>مبلغ کل</th><th>عملیات</th></tr></thead><tbody>${items.map(i=>`<tr><td>${escapeHtml(i.number)}</td><td>${dateFa(i.createdAt)}</td><td>${(i.items||[]).reduce((s,x)=>s+num(x.quantity),0).toLocaleString("fa-IR")}</td><td>${money(i.total)} تومان</td><td><button class="table-action" data-view-invoice="${escapeHtml(i.id)}">مشاهده</button><button class="table-action" data-print-invoice="${escapeHtml(i.id)}">چاپ / PDF</button></td></tr>`).join("")}</tbody></table>`;
  }
  function invoiceMarkup(invoice) {
    const rows=(invoice.items||[]).map((item,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(item.name||"کالا")}</td><td>${escapeHtml(item.barcode||"—")}</td><td>${num(item.quantity).toLocaleString("fa-IR")}</td><td>${money(item.salePrice)} تومان</td><td>${money(num(item.quantity)*num(item.salePrice))} تومان</td></tr>`).join("");
    return `<div class="invoice-paper"><div class="invoice-head"><div><h2>Mahshap</h2><p>فاکتور فروش</p></div><div><b>${escapeHtml(invoice.number||"—")}</b><p>${escapeHtml(dateFa(invoice.createdAt))}</p></div></div><table class="invoice-lines"><thead><tr><th>ردیف</th><th>شرح کالا</th><th>بارکد</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>${rows}</tbody></table><div class="invoice-grand-total">مبلغ کل: <strong>${money(invoice.total)} تومان</strong></div><p class="invoice-thanks">با تشکر از خرید شما</p></div>`;
  }
  function viewInvoice(id) {
    const invoice=db.invoices.find(i=>i.id===id); if(!invoice) return;
    $("invoiceModalBody").innerHTML=invoiceMarkup(invoice);
    $("invoiceModal").classList.remove("hidden");
    $("invoiceModal").setAttribute("aria-hidden","false");
    $("invoiceModalPrint").onclick=()=>printInvoice(id);
  }
  function closeInvoiceModal() { $("invoiceModal").classList.add("hidden"); $("invoiceModal").setAttribute("aria-hidden","true"); }
  function printInvoice(id) {
    const invoice=db.invoices.find(i=>i.id===id); if(!invoice) return;
    const win=window.open("", "_blank");
    if(!win){toast("مرورگر پنجره چاپ را مسدود کرد؛ اجازه بازشدن پنجره را بده.");return;}
    win.document.open();
    win.document.write(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>فاکتور ${escapeHtml(invoice.number)}</title><style>body{font-family:Tahoma,Arial,sans-serif;color:#111;margin:24px;font-size:12px}.invoice-paper{max-width:900px;margin:auto}.invoice-head{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:18px}.invoice-head h2{margin:0 0 6px}.invoice-head p{margin:4px 0}.invoice-lines{width:100%;border-collapse:collapse;margin-top:16px}.invoice-lines th,.invoice-lines td{border:1px solid #777;padding:9px;text-align:right}.invoice-lines th{background:#eee}.invoice-grand-total{margin-top:20px;border:1px solid #777;padding:12px;font-size:15px}.invoice-thanks{text-align:center;margin-top:40px}@page{size:A4;margin:14mm}@media print{body{margin:0}}</style></head><body>${invoiceMarkup(invoice)}<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),250)});<\/script></body></html>`);
    win.document.close();
  }
  function renderInvoices() {
    const q=digits($("invoiceSearch")?.value || "").trim().toLowerCase();
    const filtered=db.invoices.filter(i=>{
      if(!q) return true;
      const number=digits(String(i.number||"")).toLowerCase();
      const date=digits(String(dateFa(i.createdAt)||"")).toLowerCase();
      const isoDate=digits(new Date(i.createdAt).toISOString().slice(0,10));
      return number.includes(q)||date.includes(q)||isoDate.includes(q);
    }).sort((a,b)=>b.createdAt-a.createdAt);
    $("invoiceTable").innerHTML=invoiceTableHtml(filtered);
  }
  function resetProductForm() {
    $("productForm").reset(); $("productId").value=""; $("productFormTitle").textContent="ثبت کالای جدید"; $("cancelEdit").classList.add("hidden");
  }
  function editProduct(id) {
    const p=db.products.find(x=>x.id===id); if(!p) return;
    $("productId").value=p.id; $("barcode").value=p.barcode||""; $("productName").value=p.name; $("purchasePrice").value=p.purchasePrice; $("salePrice").value=p.salePrice; $("quantity").value=p.quantity;
    $("productFormTitle").textContent="ویرایش کالا"; $("cancelEdit").classList.remove("hidden");
    $("productForm").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function renderCart() {
    // Persist every cart change before the user switches to the external scanner.
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (err) { console.warn("Could not persist invoice draft", err); }
    $("cartCount").textContent=cart.reduce((s,x)=>s+x.quantity,0).toLocaleString("fa-IR")+" قلم";
    $("cartTotal").textContent=money(cart.reduce((s,x)=>s+x.quantity*x.salePrice,0))+" تومان";
    $("cartItems").classList.toggle("empty-state",!cart.length);
    $("cartItems").innerHTML=cart.length?cart.map(x=>`<div class="cart-row"><div><b>${escapeHtml(x.name)}</b><small>${money(x.salePrice)} تومان · هر عدد</small></div><div class="qty-control"><button type="button" data-cart-step="${x.productId}" data-delta="-1" aria-label="کم کردن تعداد">−</button><input type="number" min="1" step="1" value="${x.quantity}" data-cart-qty="${x.productId}" aria-label="تعداد ${escapeHtml(x.name)}"><button type="button" data-cart-step="${x.productId}" data-delta="1" aria-label="زیاد کردن تعداد">+</button></div><button class="cart-remove" data-cart-remove="${x.productId}" aria-label="حذف">×</button></div>`).join(""):'هنوز کالایی اضافه نشده.';
    if (typeof renderScannerSaleList === "function") renderScannerSaleList();
  }
  function addToCart(product, quantity) {
    quantity=Math.floor(num(quantity));
    if(!product||quantity<1){toast("کالا یا تعداد معتبر نیست.");return false;}
    const existing=cart.find(x=>x.productId===product.id);
    const desired=quantity+(existing?existing.quantity:0);
    if(desired>num(product.quantity)){toast("موجودی کافی نیست.");return false;}
    if(existing) existing.quantity=desired;
    else cart.push({productId:product.id,name:product.name,barcode:product.barcode,salePrice:num(product.salePrice),purchasePrice:num(product.purchasePrice),quantity});
    renderCart(); return true;
  }
  // In-page continuous scanner based on ZXing. It reads barcode text only; product identity
  // remains entirely under the store owner's control.
  let scannerReader = null;
  let scannerControls = null;
  let scannerTarget = "inventory";
  let scannerActive = false;
  let scannerFacing = "environment";
  let scannerCount = 0;
  let scannerLastValue = "";
  let scannerLastSeenAt = 0;
  let scannerLastAcceptedAt = 0;
  let scannerUnlockTimer = null;
  let scannerScriptPromise = null;
  let scannerSaleOrder = [];
  let scannerCameraTrack = null;
  let scannerZoomTimer = null;
  let scannerLastDecodeAt = 0;
  let scannerCurrentZoom = 1;
  let scannerNativeDetector = null;
  let scannerNativeFrame = 0;
  let scannerNativeBusy = false;

  function loadScannerLibrary() {
    if (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) return Promise.resolve();
    if (scannerScriptPromise) return scannerScriptPromise;
    const urls = [
      "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js",
      "https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js"
    ];
    scannerScriptPromise = new Promise((resolve, reject) => {
      let index = 0;
      const tryNext = () => {
        if (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) { resolve(); return; }
        if (index >= urls.length) { reject(new Error("ZXing library unavailable")); return; }
        const script = document.createElement("script");
        script.src = urls[index++];
        script.async = true;
        script.onload = () => {
          if (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) resolve();
          else tryNext();
        };
        script.onerror = tryNext;
        document.head.appendChild(script);
      };
      tryNext();
    }).catch(err => { scannerScriptPromise = null; throw err; });
    return scannerScriptPromise;
  }

  function scannerStatus(message) { $("scannerStatus").textContent = message; }
  function setScannerLoading(show, message) {
    $("scannerLoading").classList.toggle("hidden", !show);
    if (message) $("scannerLoading").textContent = message;
  }
  function openScanner(target) {
    scannerTarget = target === "sale" ? "sale" : "inventory";
    scannerCount = 0;
    scannerSaleOrder = [];
    $("scannerSaleList").classList.toggle("hidden", scannerTarget !== "sale");
    renderScannerSaleList();
    scannerLastValue = "";
    scannerLastSeenAt = 0;
    scannerLastAcceptedAt = 0;
    if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
    scannerUnlockTimer = null;
    $("scannerResult").textContent = "—";
    $("scannerCounter").textContent = "۰ اسکن";
    $("scannerTitle").textContent = scannerTarget === "sale" ? "اسکن کالا برای فروش" : "اسکن کالای موجود";
    $("scannerHelp").textContent = scannerTarget === "sale"
      ? "فقط بارکد کالاهای ثبت‌شده به فاکتور اضافه می‌شوند."
      : "فقط بارکد کالاهای ثبت‌شده شناسایی می‌شوند.";
    $("scannerModal").classList.remove("hidden");
    $("scannerModal").setAttribute("aria-hidden", "false");
    document.body.classList.add("scanner-open");
    startScanner();
  }
  async function createNativeBarcodeDetector() {
    const Detector = window.BarcodeDetector;
    if (typeof Detector !== "function" || typeof Detector.getSupportedFormats !== "function") return null;
    let supported = [];
    try { supported = await Detector.getSupportedFormats(); } catch { return null; }
    const retailFormats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar", "qr_code", "data_matrix", "pdf417", "aztec"];
    const formats = supported.filter(format => retailFormats.includes(format));
    if (!formats.length) return null;
    try { return new Detector({ formats }); } catch { return null; }
  }

  async function enhanceScannerCamera(track) {
    if (!track || typeof track.getCapabilities !== "function") return;
    let caps = {};
    try {
      caps = track.getCapabilities() || {};
      const advanced = {};
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.focusMode = "continuous";
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.exposureMode = "continuous";
      if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) advanced.whiteBalanceMode = "continuous";
      if (Object.keys(advanced).length && typeof track.applyConstraints === "function") {
        try { await track.applyConstraints({ advanced: [advanced] }); } catch (_) {}
      }
    } catch (_) { return; }

    // Gently zoom in only when the camera exposes a zoom control and no barcode is being read.
    if (caps.zoom && Number(caps.zoom.max) > Number(caps.zoom.min || 1) && typeof track.applyConstraints === "function") {
      if (scannerZoomTimer) clearInterval(scannerZoomTimer);
      scannerZoomTimer = setInterval(async () => {
        if (!scannerActive || !scannerCameraTrack || Date.now() - scannerLastDecodeAt < 1700) return;
        const minZoom = Number(caps.zoom.min || 1);
        const maxZoom = Math.min(Number(caps.zoom.max), Math.max(minZoom, 3));
        if (scannerCurrentZoom >= maxZoom) return;
        scannerCurrentZoom = Math.min(maxZoom, scannerCurrentZoom + 0.5);
        try { await scannerCameraTrack.applyConstraints({ advanced: [{ zoom: scannerCurrentZoom }] }); } catch (_) {}
      }, 900);
    }
  }

  function scanNativeBarcodeFrame() {
    if (!scannerActive || !scannerNativeDetector) return;
    const video = $("scannerVideo");
    if (!video || video.readyState < 2 || scannerNativeBusy) {
      scannerNativeFrame = requestAnimationFrame(scanNativeBarcodeFrame);
      return;
    }
    scannerNativeBusy = true;
    Promise.resolve(scannerNativeDetector.detect(video)).then(results => {
      if (!scannerActive) return;
      const detected = Array.isArray(results) ? results.find(item => item && item.rawValue) : null;
      if (detected) {
        handleScannedBarcode(detected.rawValue);
      } else if (scannerLastValue && Date.now() - scannerLastSeenAt > 900) {
        scannerLastValue = "";
        scannerLastAcceptedAt = 0;
      }
    }).catch(() => {
      // A frame that cannot be decoded is normal; keep scanning the next frame.
    }).finally(() => {
      scannerNativeBusy = false;
      if (scannerActive && scannerNativeDetector) scannerNativeFrame = requestAnimationFrame(scanNativeBarcodeFrame);
    });
  }

  async function startNativeScanner(detector) {
    let stream;
    const video = $("scannerVideo");
    const preferred = {
      facingMode: { ideal: scannerFacing },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 60 }
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: preferred, audio: false });
    } catch (err) {
      // Retry softer camera constraints for devices that cannot provide the preferred resolution.
      if (["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(err && err.name)) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: scannerFacing } }, audio: false });
      } else {
        throw err;
      }
    }
    try {
      video.srcObject = stream;
      await video.play();
    } catch (err) {
      try { stream.getTracks().forEach(track => track.stop()); } catch (_) {}
      video.srcObject = null;
      throw err;
    }
    scannerNativeDetector = detector;
    scannerCameraTrack = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    scannerActive = true;
    scannerLastDecodeAt = Date.now();
    scannerCurrentZoom = 1;
    await enhanceScannerCamera(scannerCameraTrack);
    scanNativeBarcodeFrame();
  }

  async function startScanner() {
    if (scannerActive) await stopScanner(false);
    if (!window.isSecureContext && location.hostname !== "localhost" && location.protocol !== "file:") {
      setScannerLoading(true, "برای دسترسی به دوربین، سایت باید با HTTPS باز شود.");
      scannerStatus("اتصال امن HTTPS لازم است.");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScannerLoading(true, "این مرورگر دسترسی مستقیم به دوربین را پشتیبانی نمی‌کند.");
      scannerStatus("مرورگر پشتیبانی نمی‌کند.");
      return;
    }
    setScannerLoading(true, "در حال بارگذاری موتور اسکن…");
    scannerStatus("در حال آماده‌سازی اسکنر…");
    try {
      const nativeDetector = await createNativeBarcodeDetector();
      if (nativeDetector) {
        try {
          await startNativeScanner(nativeDetector);
          setScannerLoading(false);
          scannerStatus("دوربین روشن است؛ بارکد را داخل کادر بگیر.");
          return;
        } catch (nativeError) {
          await stopScanner(false);
          // Permission or camera hardware errors will also block ZXing; report them directly.
          if (nativeError && ["NotAllowedError", "SecurityError", "NotFoundError", "DevicesNotFoundError"].includes(nativeError.name)) throw nativeError;
          // Some browsers expose BarcodeDetector but cannot use it with the selected camera.
          // Continue through the ZXing fallback instead of leaving the scanner unusable.
        }
      }
      await loadScannerLibrary();
      const Reader = window.ZXingBrowser.BrowserMultiFormatReader;
      // Ask ZXing to spend more effort on small/low-contrast barcodes and limit work to common retail formats.
      const ZX = window.ZXingBrowser;
      const hints = new Map();
      if (ZX.DecodeHintType && ZX.DecodeHintType.TRY_HARDER) hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      if (ZX.DecodeHintType && ZX.DecodeHintType.ALSO_INVERTED) hints.set(ZX.DecodeHintType.ALSO_INVERTED, true);
      if (ZX.DecodeHintType && ZX.DecodeHintType.POSSIBLE_FORMATS && ZX.BarcodeFormat) {
        const formats = ["EAN_13","EAN_8","UPC_A","UPC_E","UPC_EAN_EXTENSION","CODE_128","CODE_39","ITF","CODABAR","RSS_14","RSS_EXPANDED","QR_CODE","DATA_MATRIX","PDF_417","AZTEC"]
          .map(name => ZX.BarcodeFormat[name]).filter(Boolean);
        if (formats.length) hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, formats);
      }
      scannerReader = new Reader(hints.size ? hints : undefined, { delayBetweenScanAttempts: 45, delayBetweenScanSuccess: 120 });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === "videoinput");
      let deviceId;
      if (scannerFacing === "user") deviceId = cameras[0] && cameras[0].deviceId;
      else {
        const rear = cameras.find(d => /back|rear|environment|پشت/i.test(d.label));
        deviceId = rear ? rear.deviceId : (cameras[cameras.length - 1] && cameras[cameras.length - 1].deviceId);
      }
      scannerActive = true;
      scannerLastDecodeAt = Date.now();
      scannerCurrentZoom = 1;
      const constraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: scannerFacing };
      scannerControls = await scannerReader.decodeFromConstraints(
        { video: { ...constraints, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 }, focusMode: "continuous" }, audio: false },
        $("scannerVideo"),
        (result, error) => {
          if (result) {
            const text = String(typeof result.getText === "function" ? result.getText() : result.text || "");
            if (text) handleScannedBarcode(text);
          } else if (error && /NotFoundException/i.test(String(error.name || error))) {
            // ZXing reports NotFound while no barcode is visible. Once the view is clear,
            // allow the same barcode to be scanned again intentionally.
            if (scannerLastValue && Date.now() - scannerLastSeenAt > 900) {
              scannerLastValue = "";
              scannerLastAcceptedAt = 0;
            }
          }
        }
      );
      const video = $("scannerVideo");
      scannerCameraTrack = video && video.srcObject && video.srcObject.getVideoTracks ? video.srcObject.getVideoTracks()[0] : null;
      await enhanceScannerCamera(scannerCameraTrack);
      setScannerLoading(false);
      scannerStatus("دوربین روشن است؛ بارکد را داخل کادر بگیر.");
    } catch (err) {
      await stopScanner(false);
      setScannerLoading(true, /NotAllowedError|Permission/i.test(String(err))
        ? "اجازه دوربین داده نشد. مجوز دوربین سایت را در مرورگر فعال کن."
        : /NotFoundError|DevicesNotFound/i.test(String(err))
          ? "دوربین پیدا نشد."
          : "اسکنر اجرا نشد؛ اتصال اینترنت و مجوز دوربین را بررسی کن.");
      scannerStatus(/NotAllowedError|Permission/i.test(String(err)) ? "دسترسی دوربین مسدود است." : "شروع اسکن ناموفق بود.");
      console.error("Mahshap scanner start failed", err);
    }
  }
  function handleScannedBarcode(rawValue) {
    const value = digits(String(rawValue)).trim();
    if (!value) return;
    const now = Date.now();
    scannerLastDecodeAt = now;
    scannerLastSeenAt = now;
    // Return to a wider view after a successful read so the next barcode is easy to present.
    if (scannerCameraTrack && scannerCurrentZoom > 1) {
      scannerCurrentZoom = 1;
      try { scannerCameraTrack.applyConstraints({ advanced: [{ zoom: 1 }] }).catch(() => {}); } catch (_) {}
    }
    // Lock the currently visible code to avoid processing the same frame repeatedly.
    if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
    scannerUnlockTimer = setTimeout(() => { scannerLastValue = ""; scannerUnlockTimer = null; }, 750);
    if (value === scannerLastValue) return;
    scannerLastValue = value;
    scannerLastAcceptedAt = now;

    // The scanner is a lookup device only: unknown codes are silently ignored in every mode.
    const normalized = normalizeBarcode(value);
    const matches = db.products.filter(p => normalizeBarcode(p.barcode) === normalized);
    // If old/corrupt data contains duplicate barcodes, do not guess which product is correct.
    if (matches.length !== 1) return;
    const product = matches[0];

    scannerCount += 1;
    $("scannerResult").textContent = value;
    $("scannerCounter").textContent = scannerCount.toLocaleString("fa-IR") + " اسکن";

    if (scannerTarget === "inventory") {
      // A known code may open an existing product for editing; the scanner never creates a product.
      closeScanner(false).then(() => {
        goPage("inventory");
        editProduct(product.id);
      });
      return;
    }

    if (num(product.quantity) < 1) {
      scannerStatus("موجودی این کالا صفر است؛ به فاکتور اضافه نشد.");
      toast("موجودی این کالا تمام شده است.");
      return;
    }
    if (!addToCart(product, 1)) {
      scannerStatus("موجودی کافی نیست؛ کالا به فاکتور اضافه نشد.");
      return;
    }
    scannerSaleOrder = scannerSaleOrder.filter(id => id !== product.id);
    scannerSaleOrder.unshift(product.id);
    renderScannerSaleList();
    $("saleLookup").value = "";
    $("saleQty").value = "1";
    $("saleMatches").classList.add("hidden");
    scannerStatus("«" + product.name + "» به فاکتور اضافه شد؛ بارکد بعدی را نشان بده.");
    if ("vibrate" in navigator) { try { navigator.vibrate(55); } catch {} }
  }
  function renderScannerSaleList() {
    const list = $("scannerSaleItems");
    const total = $("scannerSaleTotal");
    if (!list || !total) return;
    const active = scannerSaleOrder
      .map(id => cart.find(item => item.productId === id))
      .filter(Boolean);
    list.innerHTML = active.length ? active.map(item => `
      <div class="scanner-sale-row">
        <div class="scanner-sale-name"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.barcode || "بدون بارکد")} · ${money(item.salePrice)} تومان</small></div>
        <div class="scanner-sale-qty">
          <button type="button" data-scanner-cart-step="${item.productId}" data-delta="-1" aria-label="کم کردن ${escapeHtml(item.name)}">−</button>
          <span>${num(item.quantity).toLocaleString("fa-IR")}</span>
          <button type="button" data-scanner-cart-step="${item.productId}" data-delta="1" aria-label="زیاد کردن ${escapeHtml(item.name)}">+</button>
        </div>
      </div>`).join("") : '<p class="scanner-sale-empty">هنوز کالایی اسکن نشده است.</p>';
    total.textContent = money(cart.reduce((sum, item) => sum + num(item.quantity) * num(item.salePrice), 0)) + " تومان";
  }
  $("scannerSaleItems").addEventListener("click", e => {
    const button = e.target.closest("[data-scanner-cart-step]");
    if (!button) return;
    const id = button.dataset.scannerCartStep;
    const item = cart.find(x => x.productId === id);
    const product = db.products.find(x => x.id === id);
    if (!item || !product) return;
    const next = item.quantity + Number(button.dataset.delta);
    if (next < 1) {
      cart = cart.filter(x => x.productId !== id);
      scannerSaleOrder = scannerSaleOrder.filter(x => x !== id);
    } else if (next > num(product.quantity)) {
      toast("موجودی کافی نیست.");
      return;
    } else item.quantity = next;
    renderCart();
    renderScannerSaleList();
  });
  async function stopScanner(hideLoading = true) {
    scannerActive = false;
    if (scannerNativeFrame) cancelAnimationFrame(scannerNativeFrame);
    scannerNativeFrame = 0;
    scannerNativeDetector = null;
    scannerNativeBusy = false;
    if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
    scannerUnlockTimer = null;
    scannerLastValue = "";
    try { if (scannerControls && typeof scannerControls.stop === "function") scannerControls.stop(); } catch {}
    scannerControls = null;
    if (scannerZoomTimer) clearInterval(scannerZoomTimer);
    scannerZoomTimer = null;
    scannerCameraTrack = null;
    scannerCurrentZoom = 1;
    try { if (scannerReader && typeof scannerReader.reset === "function") scannerReader.reset(); } catch {}
    scannerReader = null;
    const video = $("scannerVideo");
    if (video && video.srcObject) {
      try { video.srcObject.getTracks().forEach(track => track.stop()); } catch {}
      video.srcObject = null;
    }
    if (hideLoading) setScannerLoading(false);
  }
  async function closeScanner(restoreFocus = true) {
    await stopScanner();
    $("scannerModal").classList.add("hidden");
    $("scannerModal").setAttribute("aria-hidden", "true");
    document.body.classList.remove("scanner-open");
    if (restoreFocus) (scannerTarget === "sale" ? $("saleLookup") : $("barcode")).focus({ preventScroll: true });
  }
  async function switchScannerCamera() {
    scannerFacing = scannerFacing === "environment" ? "user" : "environment";
    await startScanner();
  }

  function exportBackup() {
    const blob=new Blob([JSON.stringify({format:"MAHSHAP-LITE-BACKUP",version:1,exportedAt:new Date().toISOString(),data:db},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`mahshap-backup-${todayKey()}.json`; a.click(); URL.revokeObjectURL(url);
    toast("درخواست خروجی بکاپ انجام شد.");
  }

  $("connectFolderBtn").addEventListener("click",()=>connectFolder(true));
  document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>goPage(b.dataset.page)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>goPage(b.dataset.go)));
  function handleInvoiceActionClick(e) {
    const view=e.target.closest("[data-view-invoice]");
    const print=e.target.closest("[data-print-invoice]");
    if(view) viewInvoice(view.dataset.viewInvoice);
    if(print) printInvoice(print.dataset.printInvoice);
  }
  $("invoiceTable").addEventListener("click",handleInvoiceActionClick);
  $("recentInvoices").addEventListener("click",handleInvoiceActionClick);
  $("invoiceModalClose").addEventListener("click",closeInvoiceModal);
  $("invoiceModal").addEventListener("click",e=>{if(e.target===$("invoiceModal"))closeInvoiceModal();});
  $("scanBtn").addEventListener("click",()=>openScanner("inventory"));
  $("externalScannerBtn").addEventListener("click",()=>openScanner("inventory"));
  $("saleScanBtn").addEventListener("click",()=>openScanner("sale"));
  $("scannerClose").addEventListener("click",()=>closeScanner());
  $("scannerStop").addEventListener("click",()=>closeScanner());
  $("scannerSwitch").addEventListener("click",switchScannerCamera);
  $("scannerModal").addEventListener("click",e=>{if(e.target===$("scannerModal"))closeScanner();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("scannerModal").classList.contains("hidden"))closeScanner();});
  $("cancelEdit").addEventListener("click",resetProductForm);
  $("inventorySearch").addEventListener("input",renderInventory);
  $("invoiceSearch").addEventListener("input",renderInvoices);
  $("productForm").addEventListener("submit",e=>{
    e.preventDefault();
    if(!loadDb()){toast("دیتابیس متصل نیست؛ ذخیره متوقف شد.");return;}
    const id=$("productId").value, barcode=digits($("barcode").value).trim(), name=$("productName").value.trim();
    const normalized=normalizeBarcode(barcode);
    const duplicate=normalized ? db.products.find(p=>normalizeBarcode(p.barcode)===normalized&&p.id!==id) : null;
    if(duplicate){toast(`این بارکد قبلاً برای کالای «${duplicate.name}» ثبت شده است. هر بارکد فقط برای یک کالا مجاز است.`);$("barcode").focus();return;}
    const product={id:id||("p_"+Date.now()+"_"+Math.random().toString(36).slice(2,7)),barcode,name,purchasePrice:num($("purchasePrice").value),salePrice:num($("salePrice").value),quantity:Math.floor(num($("quantity").value)),updatedAt:Date.now()};
    if(id){
      const old=db.products.find(p=>p.id===id); if(old&&old.quantity!==product.quantity) db.movements.push({id:"m_"+Date.now(),productId:id,type:"adjustment",delta:product.quantity-old.quantity,at:Date.now(),note:"اصلاح موجودی از فرم کالا"});
      db.products=db.products.map(p=>p.id===id?product:p); toast("اطلاعات کالا ویرایش شد.");
    } else { db.products.push(product); db.movements.push({id:"m_"+Date.now(),productId:product.id,type:"initial",delta:product.quantity,at:Date.now(),note:"ثبت کالای جدید"}); toast("کالا به انبار اضافه شد."); }
    if(saveDb()){resetProductForm();renderAll();}
  });
  $("inventoryTable").addEventListener("click",e=>{
    const edit=e.target.closest("[data-edit]"), del=e.target.closest("[data-delete]");
    if(edit) editProduct(edit.dataset.edit);
    if(del){const p=db.products.find(x=>x.id===del.dataset.delete);if(!p)return;if(!confirm(`کالای «${p.name}» حذف شود؟ سوابق فاکتورهای قبلی باقی می‌مانند.`))return;db.products=db.products.filter(x=>x.id!==p.id);saveDb();renderAll();toast("کالا حذف شد.");}
  });
  $("addToCartForm").addEventListener("submit",e=>{
    e.preventDefault(); const q=$("saleLookup").value.trim().toLowerCase();
    const product=db.products.find(p=>normalizeBarcode(p.barcode)===normalizeBarcode(q))||db.products.find(p=>p.name.toLowerCase()===q);
    if(!product){toast("کالا پیدا نشد؛ نام یا بارکد را دقیق وارد کن.");showMatches(q);return;}
    if(addToCart(product,$("saleQty").value)){ $("saleLookup").value=""; $("saleQty").value=1; $("saleMatches").classList.add("hidden"); }
  });
  function showMatches(q){
    const matches=db.products.filter(p=>p.name.toLowerCase().includes(q)||String(p.barcode||"").toLowerCase().includes(q)).slice(0,6);
    const box=$("saleMatches"); box.classList.toggle("hidden",!matches.length);
    box.innerHTML=matches.map(p=>`<button type="button" class="suggestion" data-pick="${p.id}"><span>${escapeHtml(p.name)}</span><small>${money(p.quantity)} عدد · ${money(p.salePrice)} تومان</small></button>`).join("");
  }
  $("saleLookup").addEventListener("input",()=>{const q=$("saleLookup").value.trim().toLowerCase();if(q.length>=2)showMatches(q);else $("saleMatches").classList.add("hidden");});
  $("saleMatches").addEventListener("click",e=>{const b=e.target.closest("[data-pick]");if(!b)return;const p=db.products.find(x=>x.id===b.dataset.pick);if(p){if(addToCart(p,$("saleQty").value)){$("saleLookup").value="";$("saleMatches").classList.add("hidden");}}});
  $("cartItems").addEventListener("change",e=>{
    const input=e.target.closest("[data-cart-qty]");if(!input)return;
    const item=cart.find(x=>x.productId===input.dataset.cartQty), p=db.products.find(x=>x.id===input.dataset.cartQty);if(!item||!p)return;
    const qty=Math.floor(num(input.value));
    if(qty<1||qty>num(p.quantity)){toast("تعداد معتبر نیست یا از موجودی بیشتر است.");renderCart();return;}
    item.quantity=qty;renderCart();
  });
  $("cartItems").addEventListener("click",e=>{
    const b=e.target.closest("[data-cart-remove]");if(b){cart=cart.filter(x=>x.productId!==b.dataset.cartRemove);scannerSaleOrder=scannerSaleOrder.filter(x=>x!==b.dataset.cartRemove);renderCart();return;}
    const step=e.target.closest("[data-cart-step]");if(!step)return;
    const id=step.dataset.cartStep, item=cart.find(x=>x.productId===id), p=db.products.find(x=>x.id===id);if(!item||!p)return;
    const next=item.quantity+Number(step.dataset.delta);
    if(next<1){cart=cart.filter(x=>x.productId!==id);scannerSaleOrder=scannerSaleOrder.filter(x=>x!==id);}else if(next>num(p.quantity)){toast("موجودی کافی نیست.");return;}else item.quantity=next;
    renderCart();
  });
  $("clearCartBtn").addEventListener("click",()=>{cart=[];scannerSaleOrder=[];renderCart();});
  $("checkoutBtn").addEventListener("click",()=>{
    if(!cart.length){toast("فاکتور خالی است.");return;}
    if(!loadDb()){toast("دیتابیس متصل نیست؛ فروش ثبت نشد.");return;}
    for(const item of cart){const p=db.products.find(x=>x.id===item.productId);if(!p||num(p.quantity)<item.quantity){toast(`موجودی ${item.name} کافی نیست.`);return;}}
    const items=cart.map(x=>({...x}));
    items.forEach(item=>{const p=db.products.find(x=>x.id===item.productId);p.quantity-=item.quantity;db.movements.push({id:"m_"+Date.now()+"_"+Math.random().toString(36).slice(2,5),productId:p.id,type:"sale",delta:-item.quantity,at:Date.now(),note:"فروش"});});
    const invoice={id:"i_"+Date.now(),number:"MAHSHAP-"+String(db.invoices.length+1).padStart(5,"0"),createdAt:Date.now(),items,total:items.reduce((s,x)=>s+x.quantity*x.salePrice,0)};
    db.invoices.push(invoice);
    if(saveDb()){cart=[];scannerSaleOrder=[];renderAll();goPage("sales");toast(`فاکتور ${invoice.number} ثبت شد.`);}
  });
  // The user may scan with a keyboard-emulating scanner or return a shared/copied barcode.
  // Enter on the barcode field triggers lookup when used in the sales form.
  $("saleLookup").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("addToCartForm").requestSubmit();}});
  window.addEventListener("storage",()=>{if(loadDb())renderAll();});
  window.addEventListener("focus",()=>{if(loadDb())renderAll();});
  (async()=>{
    // Restore cached data first. Permission prompts cannot reliably be requested on page load
    // on Android, especially after returning from an external scanner.
    let cached=null;
    try { cached=JSON.parse(localStorage.getItem(DB_KEY)||"null"); } catch {}
    if(cached&&typeof cached==="object"){
      db={products:Array.isArray(cached.products)?cached.products:[],invoices:Array.isArray(cached.invoices)?cached.invoices:[],movements:Array.isArray(cached.movements)?cached.movements:[],settings:cached.settings&&typeof cached.settings==="object"?cached.settings:{vipLocal:false}};
      folderReady=true; cacheOnlyMode=true;
    }
    try {
      directoryHandle=await getStoredHandle();
      if(directoryHandle){
        const perm=await directoryHandle.queryPermission({mode:"readwrite"});
        if(perm==="granted" && folderReady && localStorage.getItem("biza_lite_cache_dirty")==="yes"){
          cacheOnlyMode=false; await persistFiles(); localStorage.removeItem("biza_lite_cache_dirty");
          setConnection("ok"," دیتابیس متصل و اطلاعات همگام شد");
        } else if(perm==="granted") await loadFolderData();
        else if(folderReady) setConnection("bad","اطلاعات بازیابی شد؛ برای همگام‌سازی ، دکمه اتصال را بزن");
        else setConnection("bad"," دیتابیس را یک‌بار وصل کن");
      }
    } catch(err){console.warn("Folder handle not available",err);}
    // The app opens directly without a username/password screen; cached data remains available
    // if folder permission temporarily needs to be restored.
    showApp();
    const urlNow=new URL(location.href);
    const returnedTarget=urlNow.searchParams.get("biza_scan_target")||localStorage.getItem("biza_scan_target");
    const savedPage=returnedTarget?(returnedTarget==="sale"?"sales":"inventory"):(localStorage.getItem("biza_lite_current_page")||"home");
    goPage(["home","inventory","sales"].includes(savedPage)?savedPage:"home");
  })();
})();
