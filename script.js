(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const DB_KEY = "biza_lite_db_v1";
  const HANDLE_DB = "biza_lite_handles";
  const HANDLE_STORE = "handles";
  let directoryHandle = null;
  let folderReady = false;
  let writeQueue = Promise.resolve();
  const LOGIN_USER = "bizad";
  const LOGIN_PASS = "1234";
  let db = { products: [], invoices: [], movements: [], settings: { vipLocal: false } };
  let cart = [];
  let toastTimer;

  const num = v => Number(v || 0);
  const money = v => Math.round(num(v)).toLocaleString("fa-IR");
  const digits = v => String(v).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
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
    // Migrate existing data from the previous localStorage-based build instead of silently starting empty.
    if(products===null&&invoices===null&&movements===null){
      try{const old=JSON.parse(localStorage.getItem(DB_KEY)||"null");if(old){products=old.products||[];invoices=old.invoices||[];movements=old.movements||[];settings=old.settings||{vipLocal:false};}}catch{}
    }
    db={products:Array.isArray(products)?products:[],invoices:Array.isArray(invoices)?invoices:[],movements:Array.isArray(movements)?movements:[],settings:settings&&typeof settings==="object"?settings:{vipLocal:false}};
    folderReady=true;
    await persistFiles();
    setConnection("ok","پوشه دیتابیس متصل است");
    return true;
  }
  async function persistFiles() {
    if(!directoryHandle||!folderReady) throw new Error("پوشه دیتابیس متصل نیست");
    await writeJsonFile("biza-products.json",db.products);
    await writeJsonFile("biza-invoices.json",db.invoices);
    await writeJsonFile("biza-stock-movements.json",db.movements);
    await writeJsonFile("biza-settings.json",db.settings);
  }
  function loadDb() { return folderReady; }
  function saveDb() {
    if(!folderReady||!directoryHandle){setConnection("bad","دیتابیس متصل نیست");toast("اول پوشه دیتابیس را وصل کن؛ اطلاعات ذخیره نشد.");return false;}
    setConnection("ok","در حال ذخیره اطلاعات…");
    writeQueue=writeQueue.then(()=>persistFiles()).then(()=>{setConnection("ok","پوشه دیتابیس متصل است");}).catch(err=>{setConnection("bad","خطا در ذخیره دیتابیس");toast("ذخیره فایل ناموفق بود. فضای گوشی و اجازه پوشه را بررسی کن.");console.error(err);});
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
      const ok=await loadFolderData();
      if(ok){toast("پوشه دیتابیس وصل شد.");if(loggedIn())showApp();}
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
    return `<table><thead><tr><th>شماره فاکتور</th><th>تاریخ</th><th>تعداد اقلام</th><th>مبلغ کل</th></tr></thead><tbody>${items.map(i=>`<tr><td>${escapeHtml(i.number)}</td><td>${dateFa(i.createdAt)}</td><td>${i.items.reduce((s,x)=>s+num(x.quantity),0).toLocaleString("fa-IR")}</td><td>${money(i.total)} تومان</td></tr>`).join("")}</tbody></table>`;
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
  function requestExternalScanner(target) {
    const input=target==="sale"?$("saleLookup"):$("barcode");
    sessionStorage.setItem("biza_scan_target",target);
    input.dataset.scanTarget=target;
    const returnUrl=location.origin+location.pathname+"?biza_scan_target="+encodeURIComponent(target)+"&result={RESULT}";
    const scannerUrl="https://markusfisch.de/BinaryEye?ret="+encodeURIComponent(returnUrl);
    if(location.protocol==="file:"){toast("برای برگشت خودکار بارکد، سایت باید روی HTTPS اجرا شود.");return;}
    location.href=scannerUrl;
  }
  function processScanReturn(){
    const url=new URL(location.href); const result=url.searchParams.get("result");
    const target=url.searchParams.get("biza_scan_target")||sessionStorage.getItem("biza_scan_target")||"inventory";
    if(!result)return;
    const input=target==="sale"?$("saleLookup") : $("barcode");
    input.value=result; input.focus(); sessionStorage.removeItem("biza_scan_target");
    url.searchParams.delete("result");url.searchParams.delete("biza_scan_target");history.replaceState({},"",url.pathname+url.search+url.hash);
    if(target==="sale") { showMatches(result.toLowerCase()); }
    toast("بارکد برگشت داده شد.");
  }
  function exportBackup() {
    const blob=new Blob([JSON.stringify({format:"BIZA-LITE-BACKUP",version:1,exportedAt:new Date().toISOString(),data:db},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`biza-backup-${todayKey()}.json`; a.click(); URL.revokeObjectURL(url);
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
  $("backupBtn").addEventListener("click",exportBackup);
  $("scanBtn").addEventListener("click",()=>requestExternalScanner("inventory"));
  $("externalScannerBtn").addEventListener("click",()=>requestExternalScanner("inventory"));
  $("saleScanBtn").addEventListener("click",()=>requestExternalScanner("sale"));
  $("cancelEdit").addEventListener("click",resetProductForm);
  $("inventorySearch").addEventListener("input",renderInventory);
  $("productForm").addEventListener("submit",e=>{
    e.preventDefault();
    if(!loadDb()){toast("دیتابیس متصل نیست؛ ذخیره متوقف شد.");return;}
    const id=$("productId").value, barcode=$("barcode").value.trim(), name=$("productName").value.trim();
    const duplicate=db.products.find(p=>barcode&&p.barcode===barcode&&p.id!==id);
    if(duplicate){toast("این بارکد قبلاً برای کالای دیگری ثبت شده است.");return;}
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
    const invoice={id:"i_"+Date.now(),number:"BIZA-"+String(db.invoices.length+1).padStart(5,"0"),createdAt:Date.now(),items,total:items.reduce((s,x)=>s+x.quantity*x.salePrice,0)};
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
    processScanReturn();
    try { directoryHandle=await getStoredHandle(); if(directoryHandle){const perm=await directoryHandle.queryPermission({mode:"readwrite"});if(perm==="granted")await loadFolderData();else setConnection("bad","برای دسترسی، اتصال پوشه را بزن");} }
    catch(err){console.warn("Folder handle not available",err);}
    if(loggedIn()&&folderReady)showApp();else if(loggedIn()&&!folderReady){showLogin();toast("برای دسترسی به اطلاعات، یک‌بار پوشه دیتابیس را وصل کن.");}else showLogin();
  })();
})();