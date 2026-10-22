(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const DB_KEY = "biza_lite_db_v1";
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
  function loadDb() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const parsed=JSON.parse(raw);
        db={products:Array.isArray(parsed.products)?parsed.products:[],invoices:Array.isArray(parsed.invoices)?parsed.invoices:[],movements:Array.isArray(parsed.movements)?parsed.movements:[],settings:parsed.settings||{vipLocal:false}};
      }
      setConnection("ok","دیتابیس محلی متصل است");
      return true;
    } catch (err) {
      setConnection("bad","دیتابیس متصل نیست");
      return false;
    }
  }
  function saveDb() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      setConnection("ok","دیتابیس محلی متصل است");
      return true;
    } catch (err) {
      setConnection("bad","دیتابیس متصل نیست");
      toast("ذخیره اطلاعات انجام نشد؛ فضای ذخیره‌سازی را بررسی کن.");
      return false;
    }
  }
  function loggedIn() { return sessionStorage.getItem("biza_lite_logged_in") === "yes"; }
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
    $("cartItems").innerHTML=cart.length?cart.map(x=>`<div class="cart-row"><div><b>${escapeHtml(x.name)}</b><small>${money(x.salePrice)} تومان · هر عدد</small></div><input type="number" min="1" step="1" value="${x.quantity}" data-cart-qty="${x.productId}" aria-label="تعداد ${escapeHtml(x.name)}"><button class="cart-remove" data-cart-remove="${x.productId}" aria-label="حذف">×</button></div>`).join(""):'هنوز کالایی اضافه نشده.';
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
    // Websites cannot force-launch an arbitrary installed scanner. Offer the Android intent where supported,
    // and keep the field ready for the scanner's "share/keyboard" return workflow.
    const barcodeInput=target==="sale"?$("saleLookup"):$("barcode");
    barcodeInput.focus();
    barcodeInput.dataset.scanTarget=target;
    toast("اسکنر را باز کن و خروجی بارکد را به این صفحه برگردان یا در کادر وارد کن.");
    const intent='intent://scan/#Intent;scheme=zxing;package=de.markusfisch.android.binaryeye;end';
    const link=document.createElement("a"); link.href=intent; link.style.display="none"; document.body.appendChild(link);
    try { link.click(); } catch {}
    setTimeout(()=>{ try{link.remove();}catch{} },500);
  }
  function exportBackup() {
    const blob=new Blob([JSON.stringify({format:"BIZA-LITE-BACKUP",version:1,exportedAt:new Date().toISOString(),data:db},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`biza-backup-${todayKey()}.json`; a.click(); URL.revokeObjectURL(url);
    toast("درخواست خروجی بکاپ انجام شد.");
  }

  $("loginForm").addEventListener("submit",e=>{
    e.preventDefault();
    if($("username").value.trim()===LOGIN_USER && $("password").value===LOGIN_PASS){
      sessionStorage.setItem("biza_lite_logged_in","yes"); $("loginError").classList.add("hidden");
      if(loadDb()) showApp(); else toast("دیتابیس متصل نیست.");
    } else $("loginError").classList.remove("hidden");
  });
  $("logoutBtn").addEventListener("click",()=>{sessionStorage.removeItem("biza_lite_logged_in");showLogin();});
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
    const qty=Math.floor(num(input.value));const other=cart.filter(x=>x.productId!==item.productId).reduce((s,x)=>s+x.quantity,0);
    if(qty<1||qty>num(p.quantity)){toast("تعداد معتبر نیست یا از موجودی بیشتر است.");renderCart();return;}
    item.quantity=qty;renderCart();
  });
  $("cartItems").addEventListener("click",e=>{const b=e.target.closest("[data-cart-remove]");if(!b)return;cart=cart.filter(x=>x.productId!==b.dataset.cartRemove);renderCart();});
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
  window.addEventListener("focus",()=>{try{if(loadDb()&&loggedIn())renderAll();}catch{}});
  loadDb();
  if(loggedIn())showApp();else showLogin();
})();