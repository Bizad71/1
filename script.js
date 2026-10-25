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
  const LOGIN_USER = "bizad";
  const LOGIN_PASS = "1234";
  let db = { products: [], invoices: [], movements: [], settings: { vipLocal: false } };
  // Keep the in-progress invoice across the round-trip to Binary Eye, which may reload this page.
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
    if(permission!=="granted"){folderReady=false;setConnection("bad","برای دسترسی، اتصال پوشه را بزن");return false;}
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
    setConnection("ok","پوشه دیتابیس متصل است");
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
    if(cacheOnlyMode||!directoryHandle){localStorage.setItem("biza_lite_cache_dirty","yes");setConnection("bad","ذخیره محلی فعال است؛ پوشه فعلاً اجازه دسترسی نداده");toast("تغییرات در حافظه مرورگر ذخیره شد؛ برای همگام‌سازی فایل‌های پوشه، اتصال پوشه را بزن.");return true;}
    setConnection("ok","در حال ذخیره اطلاعات…");
    writeQueue=writeQueue.then(()=>persistFiles()).then(()=>{setConnection("ok","پوشه دیتابیس متصل است");}).catch(err=>{cacheOnlyMode=true;localStorage.setItem(DB_KEY,JSON.stringify(db));setConnection("bad","ذخیره محلی؛ دسترسی پوشه موقتاً قطع شد");toast("اجازه پوشه موقتاً قطع شد؛ تغییرات در مرورگر نگه داشته شد.");console.error(err);});
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
          setConnection("ok","پوشه دیتابیس متصل است"); ok=true;
        }
      } else ok=await loadFolderData();
      if(ok){toast("پوشه دیتابیس وصل و همگام شد.");if(loggedIn())showApp();}
      return ok;
    } catch(err){if(err.name!=="AbortError") {console.error(err);toast("اتصال پوشه انجام نشد؛ اجازه دسترسی را بررسی کن.");}return false;}
  }
  function loggedIn() { return localStorage.getItem("biza_lite_logged_in") === "yes"; }
  function showApp() {
    $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("logoutBtn").classList.remove("hidden");
    renderAll();
  }
  function showLogin() {
    $("loginView").classList.remove("hidden"); $("appView").classList.add("hidden"); $("logoutBtn").classList.add("hidden");
  }
  function goPage(page) {
    document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
    const el=$("page-"+page); if(el) el.classList.remove("hidden");
    // Remember the current panel so refreshes and scanner round-trips return to the same section.
    try { localStorage.setItem("biza_lite_current_page", page); } catch {}
    window.scrollTo({top:0,behavior:"smooth"});
    if(page==="vip") renderVip();
  }
  function renderAll() { renderHome(); renderInventory(); renderCart(); renderInvoices(); renderVip(); }
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
    return `<div class="invoice-paper"><div class="invoice-head"><div><h2>Bizaap</h2><p>فاکتور فروش</p></div><div><b>${escapeHtml(invoice.number||"—")}</b><p>${escapeHtml(dateFa(invoice.createdAt))}</p></div></div><table class="invoice-lines"><thead><tr><th>ردیف</th><th>شرح کالا</th><th>بارکد</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>${rows}</tbody></table><div class="invoice-grand-total">مبلغ کل: <strong>${money(invoice.total)} تومان</strong></div><p class="invoice-thanks">با تشکر از خرید شما</p></div>`;
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
  function renderInvoices() { $("invoiceTable").innerHTML=invoiceTableHtml([...db.invoices].sort((a,b)=>b.createdAt-a.createdAt)); }
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
  function renderVip() {
    const sold={}; let revenue=0, profit=0;
    db.invoices.forEach(inv=>{ revenue+=num(inv.total); inv.items.forEach(item=>{sold[item.productId]=(sold[item.productId]||0)+num(item.quantity); profit+=num(item.quantity)*(num(item.salePrice)-num(item.purchasePrice));}); });
    $("vipRevenue").textContent=money(revenue); $("vipProfit").textContent=money(profit); $("vipInvoices").textContent=db.invoices.length.toLocaleString("fa-IR"); $("vipAverage").textContent=money(db.invoices.length?revenue/db.invoices.length:0);
    const sorted=[...db.products].sort((a,b)=>(sold[b.id]||0)-(sold[a.id]||0));
    const top=sorted.filter(p=>(sold[p.id]||0)>0).slice(0,5);
    $("topProducts").classList.toggle("empty-state",!top.length);
    $("topProducts").innerHTML=top.length?top.map((p,i)=>`<div class="rank-item"><span class="rank-number">${(i+1).toLocaleString("fa-IR")}</span><div><b>${escapeHtml(p.name)}</b><small>${money(p.quantity)} عدد موجودی</small></div><span class="rank-value">${money(sold[p.id])} عدد</span></div>`).join(""):'هنوز اطلاعات کافی ثبت نشده است.';
    const slow=sorted.filter(p=>(sold[p.id]||0)===0).slice(0,5);
    $("slowProducts").classList.toggle("empty-state",!slow.length);
    $("slowProducts").innerHTML=slow.length?slow.map(p=>`<div class="rank-item"><span class="rank-number">·</span><div><b>${escapeHtml(p.name)}</b><small>بدون فروش ثبت‌شده</small></div><span class="rank-value">${money(p.quantity)} عدد</span></div>`).join(""):'همه کالاها دست‌کم یک فروش ثبت‌شده دارند.';
    const days=[]; for(let n=6;n>=0;n--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-n);const key=todayKey(d);const total=db.invoices.filter(i=>todayKey(new Date(i.createdAt))===key).reduce((s,i)=>s+num(i.total),0);days.push({label:d.toLocaleDateString("fa-IR",{weekday:"short"}),total});}
    const max=Math.max(...days.map(d=>d.total),1);
    $("salesChart").classList.toggle("empty-state",!revenue);
    $("salesChart").innerHTML=revenue?days.map(d=>`<div class="bar-column"><span class="bar-value">${d.total?money(d.total):"—"}</span><div class="bar" style="height:${Math.max(d.total?5:2,d.total/max*95)}px"></div><span class="bar-label">${d.label}</span></div>`).join(""):'برای نمایش نمودار، فروش ثبت کن.';
    const advice=[];
    const low=db.products.filter(p=>num(p.quantity)<=5);
    if(low.length) advice.push({icon:"!",title:"موجودی کم",text:`${low.length} کالا موجودی ۵ عدد یا کمتر دارند؛ پیش از سفارش مجدد بررسی‌شان کن.`});
    if(top.length) advice.push({icon:"↗",title:"کالای پرفروش",text:`«${top[0].name}» با ${money(sold[top[0].id])} عدد، بیشترین تعداد فروش ثبت‌شده را دارد.`});
    if(slow.length) advice.push({icon:"◇",title:"کالاهای بدون فروش",text:`${slow.length} کالا هنوز فروش ثبت‌شده ندارند. تاریخ ورود و بازه بررسی را هم در نظر بگیر.`});
    if(!db.invoices.length) advice.push({icon:"i",title:"شروع تحلیل",text:"بعد از ثبت چند فاکتور، گزارش پرفروش‌ها، سود و روند فروش معنادارتر می‌شود."});
    advice.push({icon:"≈",title:"دقت محاسبه سود",text:"سود فعلی با قیمت خرید ذخیره‌شده در فاکتور محاسبه می‌شود؛ هزینه‌های جانبی و تخفیف‌ها هنوز لحاظ نشده‌اند."});
    $("vipAdvice").innerHTML=advice.map(a=>`<div class="advice"><span class="advice-icon">${a.icon}</span><div><b>${escapeHtml(a.title)}</b><p>${escapeHtml(a.text)}</p></div></div>`).join("");
    $("vipToggle").checked=!!db.settings.vipLocal;
    $("vipLocalStatus").textContent=db.settings.vipLocal?"فعال در همین مرورگر":"محلی";
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
  let scannerPendingProduct = null;

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
    scannerPendingProduct = null;
    $("scannerPending").classList.add("hidden");
    $("scannerProductQty").value = "1";
    scannerLastValue = "";
    scannerLastSeenAt = 0;
    scannerLastAcceptedAt = 0;
    if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
    scannerUnlockTimer = null;
    $("scannerResult").textContent = "—";
    $("scannerCounter").textContent = "۰ اسکن";
    $("scannerTitle").textContent = scannerTarget === "sale" ? "اسکن پیوسته برای فروش" : "اسکن بارکد کالا";
    $("scannerHelp").textContent = scannerTarget === "sale"
      ? "بارکد را بگیر؛ مشخصات کالا پایین تصویر می‌آید. تعداد را وارد کن و تأیید بزن؛ دوربین برای کالای بعدی روشن می‌ماند."
      : "بارکد را مقابل دوربین بگیر. پس از ثبت عدد، می‌توانی نام و مشخصات کالا را خودت وارد کنی.";
    $("scannerModal").classList.remove("hidden");
    $("scannerModal").setAttribute("aria-hidden", "false");
    document.body.classList.add("scanner-open");
    startScanner();
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
      await loadScannerLibrary();
      const Reader = window.ZXingBrowser.BrowserMultiFormatReader;
      scannerReader = new Reader(undefined, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 250 });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === "videoinput");
      let deviceId;
      if (scannerFacing === "user") deviceId = cameras[0] && cameras[0].deviceId;
      else {
        const rear = cameras.find(d => /back|rear|environment|پشت/i.test(d.label));
        deviceId = rear ? rear.deviceId : (cameras[cameras.length - 1] && cameras[cameras.length - 1].deviceId);
      }
      scannerActive = true;
      const constraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: scannerFacing };
      scannerControls = await scannerReader.decodeFromConstraints(
        { video: { ...constraints, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, audio: false },
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
      setScannerLoading(false);
      scannerStatus(cameras.length > 1 ? "دوربین روشن است؛ بارکد را داخل کادر بگیر." : "دوربین روشن است؛ بارکد را داخل کادر بگیر.");
    } catch (err) {
      scannerActive = false;
      setScannerLoading(true, /NotAllowedError|Permission/i.test(String(err))
        ? "اجازه دوربین داده نشد. مجوز دوربین سایت را در مرورگر فعال کن."
        : /NotFoundError|DevicesNotFound/i.test(String(err))
          ? "دوربین پیدا نشد."
          : "اسکنر اجرا نشد؛ اتصال اینترنت و مجوز دوربین را بررسی کن.");
      scannerStatus(/NotAllowedError|Permission/i.test(String(err)) ? "دسترسی دوربین مسدود است." : "شروع اسکن ناموفق بود.");
      console.error("BIZA scanner start failed", err);
    }
  }
  function handleScannedBarcode(rawValue) {
    const value = digits(String(rawValue)).trim();
    if (!value) return;
    // While the cashier is choosing quantity for a detected item, ignore other codes without
    // replacing the pending barcode. Keep the current barcode locked while it remains in view.
    if (scannerTarget === "sale" && scannerPendingProduct) {
      if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
      scannerUnlockTimer = setTimeout(() => { scannerLastValue = ""; scannerUnlockTimer = null; }, 750);
      return;
    }
    const now = Date.now();
    scannerLastSeenAt = now;
    // Keep a code locked while it remains visible. Re-arm only after ~750 ms without
    // any successful decode, so one item held in front of the camera is not added repeatedly.
    if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
    scannerUnlockTimer = setTimeout(() => { scannerLastValue = ""; scannerUnlockTimer = null; }, 750);
    if (value === scannerLastValue) return;
    scannerLastValue = value;
    scannerLastAcceptedAt = now;
    scannerCount += 1;
    $("scannerResult").textContent = value;
    $("scannerCounter").textContent = scannerCount.toLocaleString("fa-IR") + " اسکن";
    scannerStatus("بارکد خوانده شد؛ آماده اسکن بعدی.");
    if (scannerTarget === "inventory") {
      $("barcode").value = value;
      $("barcode").dispatchEvent(new Event("input", { bubbles: true }));
      // Inventory mode only fills the barcode field; the user defines the product details.
      stopScanner(false).then(() => closeScanner(false));
      toast("بارکد خوانده شد؛ مشخصات کالا را وارد کن.");
      $("barcode").focus({ preventScroll: true });
      return;
    }
    // Keep the camera active but pause accepting new products until this item is confirmed.
    if (scannerPendingProduct) return;
    $("saleLookup").value = value;
    const normalized = normalizeBarcode(value);
    const product = db.products.find(p => normalizeBarcode(p.barcode) === normalized);
    if (product) {
      scannerPendingProduct = product;
      $("scannerPending").classList.remove("hidden");
      $("scannerProductName").textContent = product.name || "کالای بدون نام";
      $("scannerProductBarcode").textContent = "بارکد: " + (product.barcode || value);
      $("scannerProductStock").textContent = "موجودی: " + num(product.quantity).toLocaleString("fa-IR");
      $("scannerProductPrice").textContent = money(product.salePrice) + " تومان";
      $("scannerProductQty").value = "1";
      $("scannerProductQty").max = String(Math.max(1, num(product.quantity)));
      $("scannerLineTotal").textContent = money(num(product.salePrice)) + " تومان";
      $("scannerProductMessage").classList.remove("error");
      $("scannerProductMessage").textContent = "تعداد را وارد کن و تأیید را بزن؛ دوربین روشن می‌ماند.";
      $("scannerConfirmProduct").disabled = num(product.quantity) < 1;
      scannerStatus("کالا پیدا شد؛ تعداد را در کادر پایین تأیید کن.");
      if ("vibrate" in navigator) { try { navigator.vibrate(45); } catch {} }
    } else {
      scannerStatus("بارکد " + value + " در فهرست کالاها نیست؛ ابتدا کالا را در انبار ثبت کن.");
      $("scannerPending").classList.add("hidden");
      showMatches(value.toLowerCase());
      toast("این بارکد در انبار ثبت نشده است.");
    }
  }
  async function stopScanner(hideLoading = true) {
    scannerActive = false;
    if (scannerUnlockTimer) clearTimeout(scannerUnlockTimer);
    scannerUnlockTimer = null;
    scannerLastValue = "";
    try { if (scannerControls && typeof scannerControls.stop === "function") scannerControls.stop(); } catch {}
    scannerControls = null;
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

  function updateScannerLineTotal() {
    if (!scannerPendingProduct) return;
    const qty = Math.max(0, Math.floor(num($("scannerProductQty").value)));
    $("scannerLineTotal").textContent = money(num(scannerPendingProduct.salePrice) * qty) + " تومان";
    const available = num(scannerPendingProduct.quantity);
    const invalid = qty < 1 || qty > available;
    $("scannerProductMessage").classList.toggle("error", invalid);
    $("scannerProductMessage").textContent = qty < 1
      ? "تعداد باید حداقل ۱ باشد."
      : qty > available
        ? "موجودی کافی نیست؛ موجودی فعلی " + available.toLocaleString("fa-IR") + " عدد است."
        : "پس از تأیید، کالا به فاکتور اضافه می‌شود و دوربین روشن می‌ماند.";
    $("scannerConfirmProduct").disabled = invalid;
  }
  function confirmScannedProduct() {
    if (!scannerPendingProduct) return;
    const product = scannerPendingProduct;
    const qty = Math.floor(num($("scannerProductQty").value));
    if (qty < 1 || qty > num(product.quantity)) { updateScannerLineTotal(); return; }
    if (!addToCart(product, qty)) { updateScannerLineTotal(); return; }
    scannerPendingProduct = null;
    $("scannerPending").classList.add("hidden");
    $("saleLookup").value = "";
    $("saleQty").value = "1";
    $("saleMatches").classList.add("hidden");
    $("scannerProductQty").value = "1";
    scannerStatus("«" + product.name + "» به فاکتور اضافه شد؛ بارکد بعدی را نشان بده.");
    // Do not close or restart the camera. Keep the just-confirmed barcode locked until it leaves view.
    if ("vibrate" in navigator) { try { navigator.vibrate(70); } catch {} }
  }
  $("scannerProductQty").addEventListener("input", updateScannerLineTotal);
  function stepScannerQuantity(delta) {
    if (!scannerPendingProduct) return;
    const current = Math.floor(num($("scannerProductQty").value)) || 1;
    const next = Math.max(1, Math.min(num(scannerPendingProduct.quantity), current + delta));
    $("scannerProductQty").value = String(next);
    updateScannerLineTotal();
  }
  $("scannerQtyMinus").addEventListener("click", () => stepScannerQuantity(-1));
  $("scannerQtyPlus").addEventListener("click", () => stepScannerQuantity(1));
  $("scannerConfirmProduct").addEventListener("click", confirmScannedProduct);
  $("scannerProductQty").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); confirmScannedProduct(); } });

  function exportBackup() {
    const blob=new Blob([JSON.stringify({format:"BIZAAP-LITE-BACKUP",version:1,exportedAt:new Date().toISOString(),data:db},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`bizaap-backup-${todayKey()}.json`; a.click(); URL.revokeObjectURL(url);
    toast("درخواست خروجی بکاپ انجام شد.");
  }

  $("loginForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if($("username").value.trim()===LOGIN_USER && $("password").value===LOGIN_PASS){
      localStorage.setItem("biza_lite_logged_in","yes"); $("loginError").classList.add("hidden");
      if(!folderReady){const ok=await connectFolder(false);if(!ok){toast("برای ادامه، پوشه دیتابیس را وصل کن.");return;}}
      showApp();
    } else $("loginError").classList.remove("hidden");
  });
  $("logoutBtn").addEventListener("click",()=>{localStorage.removeItem("biza_lite_logged_in");showLogin();});
  $("connectFolderBtn").addEventListener("click",()=>connectFolder(true));
  document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>goPage(b.dataset.page)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>goPage(b.dataset.go)));
  $("openVip").addEventListener("click",()=>goPage("vip"));
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
  $("backupBtn").addEventListener("click",exportBackup);
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
    const product=db.products.find(p=>String(p.barcode||"").toLowerCase()===q)||db.products.find(p=>p.name.toLowerCase()===q);
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
    const b=e.target.closest("[data-cart-remove]");if(b){cart=cart.filter(x=>x.productId!==b.dataset.cartRemove);renderCart();return;}
    const step=e.target.closest("[data-cart-step]");if(!step)return;
    const id=step.dataset.cartStep, item=cart.find(x=>x.productId===id), p=db.products.find(x=>x.id===id);if(!item||!p)return;
    const next=item.quantity+Number(step.dataset.delta);
    if(next<1){cart=cart.filter(x=>x.productId!==id);}else if(next>num(p.quantity)){toast("موجودی کافی نیست.");return;}else item.quantity=next;
    renderCart();
  });
  $("clearCartBtn").addEventListener("click",()=>{cart=[];renderCart();});
  $("checkoutBtn").addEventListener("click",()=>{
    if(!cart.length){toast("فاکتور خالی است.");return;}
    if(!loadDb()){toast("دیتابیس متصل نیست؛ فروش ثبت نشد.");return;}
    for(const item of cart){const p=db.products.find(x=>x.id===item.productId);if(!p||num(p.quantity)<item.quantity){toast(`موجودی ${item.name} کافی نیست.`);return;}}
    const items=cart.map(x=>({...x}));
    items.forEach(item=>{const p=db.products.find(x=>x.id===item.productId);p.quantity-=item.quantity;db.movements.push({id:"m_"+Date.now()+"_"+Math.random().toString(36).slice(2,5),productId:p.id,type:"sale",delta:-item.quantity,at:Date.now(),note:"فروش"});});
    const invoice={id:"i_"+Date.now(),number:"BIZAAP-"+String(db.invoices.length+1).padStart(5,"0"),createdAt:Date.now(),items,total:items.reduce((s,x)=>s+x.quantity*x.salePrice,0)};
    db.invoices.push(invoice);
    if(saveDb()){cart=[];renderAll();goPage("sales");toast(`فاکتور ${invoice.number} ثبت شد.`);}
  });
  $("vipToggle").addEventListener("change",e=>{db.settings.vipLocal=e.target.checked;if(saveDb())renderVip();});
  // The user may scan with a keyboard-emulating scanner or return a shared/copied barcode.
  // Enter on the barcode field triggers lookup when used in the sales form.
  $("saleLookup").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("addToCartForm").requestSubmit();}});
  window.addEventListener("storage",()=>{if(loadDb()&&loggedIn())renderAll();});
  window.addEventListener("focus",()=>{if(loadDb()&&loggedIn())renderAll();});
  (async()=>{
    // Restore the remembered login and recovery data first. Permission prompts cannot reliably be
    // requested on page load on Android, especially after returning from Binary Eye.
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
          setConnection("ok","پوشه دیتابیس متصل و اطلاعات همگام شد");
        } else if(perm==="granted") await loadFolderData();
        else if(folderReady) setConnection("bad","اطلاعات بازیابی شد؛ برای همگام‌سازی پوشه، دکمه اتصال را بزن");
        else setConnection("bad","پوشه دیتابیس را یک‌بار وصل کن");
      }
    } catch(err){console.warn("Folder handle not available",err);}
    // A successful login is remembered. A temporary folder-permission issue must never send
    // the user back to the login screen; cached data is shown and the folder can be reconnected.
    if(loggedIn()) {
      showApp();
      const urlNow=new URL(location.href);
      const returnedTarget=urlNow.searchParams.get("biza_scan_target")||localStorage.getItem("biza_scan_target");
      const savedPage=returnedTarget?(returnedTarget==="sale"?"sales":"inventory"):(localStorage.getItem("biza_lite_current_page")||"home");
      goPage(["home","inventory","sales","vip"].includes(savedPage)?savedPage:"home");
    } else showLogin();
  })();
})();