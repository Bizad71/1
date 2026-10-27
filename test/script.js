(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { directoryHandle: null, products: [], invoices: [], movements: [], settings: {}, fileNames: [] };
  const FILES = ['biza-products.json', 'biza-invoices.json', 'biza-stock-movements.json', 'biza-settings.json'];
  const money = (n) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0;
  const dateOf = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
  const jalaliFormatter = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'});
  const faDigits = (s) => String(s ?? '').replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  const jalaliParts = (d) => { const p = Object.fromEntries(jalaliFormatter.formatToParts(d).map(x=>[x.type,x.value])); return {year:Number(p.year),month:Number(p.month),day:Number(p.day)}; };
  const jalaliLabel = (d, monthOnly=false) => { if(!d || Number.isNaN(d.getTime())) return 'نامشخص'; const p=jalaliParts(d); return monthOnly ? `${p.year}/${String(p.month).padStart(2,'0')}` : `${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`; };
  const jalaliInputToDate = (value, end=false) => { if(!value) return null; const m=faDigits(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); if(!m) throw new Error('تاریخ را به شکل شمسی سال/ماه/روز وارد کن؛ نمونه: ۱۴۰۵/۰۷/۳۰'); const jy=+m[1], jm=+m[2], jd=+m[3]; if(jm<1||jm>12||jd<1||jd>31) throw new Error('تاریخ شمسی واردشده معتبر نیست.'); const start=Date.UTC(jy+621,0,1), stop=Date.UTC(jy+623,0,1); for(let t=start;t<stop;t+=86400000){const d=new Date(t), q=jalaliParts(d); if(q.year===jy&&q.month===jm&&q.day===jd) return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),end?23:0,end?59:0,end?59:0,end?999:0);} throw new Error('این تاریخ شمسی وجود ندارد؛ روز و ماه را بررسی کن.'); };
  const dateLabel = (value) => { const d = dateOf(value); return d ? jalaliLabel(d) : 'نامشخص'; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setStatus = (message, kind = '') => { const el = $('statusMessage'); el.textContent = message; el.className = `status-message ${kind}`.trim(); };
  const parseJSON = (text, name) => { try { return JSON.parse(text); } catch { throw new Error(`فایل «${name}» JSON معتبر نیست.`); } };
  function normalizeArray(value, name) { if (!Array.isArray(value)) throw new Error(`ساختار فایل «${name}» معتبر نیست؛ انتظار آرایه می‌رفت.`); return value; }

  async function readFromDirectoryHandle(handle) {
    const out = {};
    for (const name of FILES) {
      try { const fileHandle = await handle.getFileHandle(name); const file = await fileHandle.getFile(); out[name] = parseJSON(await file.text(), name); }
      catch (err) { if (err && (err.name === 'NotFoundError' || /getFileHandle/.test(String(err)))) throw new Error(`فایل «${name}» در پوشهٔ انتخاب‌شده پیدا نشد.`); throw err; }
    }
    return out;
  }
  function readFromInputFiles(fileList) {
    const byName = new Map();
    for (const file of fileList) byName.set(file.name, file);
    const missing = FILES.filter(name => !byName.has(name));
    if (missing.length) throw new Error(`این فایل‌ها در پوشهٔ انتخاب‌شده پیدا نشدند: ${missing.join('، ')}`);
    return Promise.all(FILES.map(async name => [name, parseJSON(await byName.get(name).text(), name)])).then(entries => Object.fromEntries(entries));
  }
  function applyData(data) {
    state.products = normalizeArray(data['biza-products.json'], 'biza-products.json');
    state.invoices = normalizeArray(data['biza-invoices.json'], 'biza-invoices.json');
    state.movements = normalizeArray(data['biza-stock-movements.json'], 'biza-stock-movements.json');
    state.settings = data['biza-settings.json'] && typeof data['biza-settings.json'] === 'object' ? data['biza-settings.json'] : {};
    if (!state.products.length && !state.invoices.length) setStatus('پوشه وصل شد، اما فعلاً کالا یا فاکتوری در فایل‌ها نیست.', 'success');
    else setStatus(`پوشه متصل شد؛ ${money(state.products.length)} کالا و ${money(state.invoices.length)} فاکتور خوانده شد.`, 'success');
    $('dashboard').hidden = false; $('welcomeState').hidden = true; $('refreshBtn').disabled = !state.directoryHandle;
    renderDashboard();
  }
  async function connectFolder() {
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        if (handle.requestPermission) { const permission = await handle.requestPermission({ mode: 'read' }); if (permission !== 'granted') throw new Error('اجازهٔ خواندن پوشه داده نشد.'); }
        setStatus('در حال خواندن فایل‌های دیتابیس…');
        const data = await readFromDirectoryHandle(handle);
        state.directoryHandle = handle; applyData(data); return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (err && /showDirectoryPicker/.test(String(err))) { setStatus('مرورگر این روش اتصال را پشتیبانی نمی‌کند؛ پوشه را با انتخاب‌گر فایل انتخاب کن.'); $('folderInput').click(); return; }
        setStatus(err.message || 'اتصال پوشه انجام نشد.', 'error'); return;
      }
    }
    $('folderInput').click();
  }
  async function refreshData() {
    if (!state.directoryHandle) { $('folderInput').click(); return; }
    try { setStatus('در حال به‌روزرسانی…'); const data = await readFromDirectoryHandle(state.directoryHandle); applyData(data); }
    catch (err) { setStatus(err.message || 'خواندن دوبارهٔ فایل‌ها ناموفق بود.', 'error'); }
  }
  function getAnalytics() {
    const soldById = new Map(), soldByName = new Map(), profitById = new Map();
    let totalSales = 0, totalProfit = 0, cogs = 0, totalSoldUnits = 0;
    const validInvoices = state.invoices.filter(inv => inv && Array.isArray(inv.items));
    for (const inv of validInvoices) {
      for (const item of inv.items) {
        const q = Math.max(0, num(item.quantity)); const sale = num(item.salePrice); const buy = num(item.purchasePrice);
        const sales = sale * q, profit = (sale - buy) * q;
        totalSales += sales; totalProfit += profit; cogs += buy * q; totalSoldUnits += q;
        const id = item.productId || item.name || 'unknown';
        soldById.set(id, (soldById.get(id) || 0) + q); profitById.set(id, (profitById.get(id) || 0) + profit);
        soldByName.set(item.name || id, (soldByName.get(item.name || id) || 0) + q);
      }
    }
    const products = state.products.map(p => {
      const id = p.id || p.barcode || p.name;
      const sold = soldById.get(id) || soldByName.get(p.name) || 0;
      const profitPerUnit = num(p.salePrice) - num(p.purchasePrice);
      return { ...p, _id: id, _qty: num(p.quantity), _sold: sold, _profitPerUnit: profitPerUnit, _sales: sold * num(p.salePrice), _profit: profitById.get(id) || sold * profitPerUnit };
    });
    const stockUnits = products.reduce((s,p) => s + Math.max(0,p._qty), 0);
    const stockValue = products.reduce((s,p) => s + Math.max(0,p._qty) * Math.max(0,num(p.purchasePrice)), 0);
    const dates = validInvoices.map(i => dateOf(i.createdAt)).filter(Boolean).sort((a,b) => a-b);
    const historyDays = dates.length ? Math.max(1, Math.floor((dates[dates.length-1] - dates[0]) / 86400000) + 1) : 0;
    const today = new Date(); const todayStart = new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
    const todayInvoices = validInvoices.filter(i => { const d = dateOf(i.createdAt); return d && d.getTime() >= todayStart; }).length;
    return { products, validInvoices, totalSales, totalProfit, cogs, totalSoldUnits, stockUnits, stockValue, historyDays, dates, todayInvoices, soldByName };
  }
  function renderDashboard() {
    const a = getAnalytics();
    $('totalSales').textContent = money(a.totalSales);
    $('totalProfit').textContent = money(a.totalProfit);
    $('profitMargin').textContent = a.totalSales ? `حاشیه سود ناخالص ${money(a.totalProfit / a.totalSales * 100)}٪` : 'هنوز فروش ثبت نشده است';
    $('productCount').textContent = money(a.products.length);
    $('stockUnits').textContent = `مجموع موجودی: ${money(a.stockUnits)} عدد`;
    $('stockValue').textContent = money(a.stockValue);
    $('invoiceCount').textContent = `${money(a.validInvoices.length)} فاکتور ثبت‌شده · امروز ${money(a.todayInvoices)} فاکتور`;
    $('dataDate').textContent = `آخرین بررسی: ${dateLabel(Date.now())}`;
    renderRecommendations(a); renderTopProducts(a); renderInventory(a); renderTrend(a); renderManagerTools(a);
  }
  function renderRecommendations(a) {
    const recs = [];
    const low = a.products.filter(p => p._qty <= 5).sort((x,y) => x._qty-y._qty);
    const noSales = a.products.filter(p => p._qty > 0 && p._sold === 0);
    const highStockSlow = a.products.filter(p => p._qty >= 20 && p._sold > 0 && p._qty > p._sold * 3).sort((x,y) => (y._qty / Math.max(1,y._sold))-(x._qty / Math.max(1,x._sold)));
    const highProfit = [...a.products].filter(p => p._sold > 0).sort((x,y) => y._profit-x._profit)[0];
    if (low.length) recs.push({kind:'warn',icon:'!',title:`${money(low.length)} کالا با موجودی کم`,body:`${low.slice(0,3).map(p=>`${p.name} (${money(p._qty)} عدد)`).join('، ')}${low.length>3?' و موارد دیگر':''}. مقدار خرید را با سرعت فروش و حداقل سفارش تأمین‌کننده تطبیق بده.`});
    if (noSales.length) recs.push({kind:'warn',icon:'◷',title:'موجودی بدون فروش ثبت‌شده',body:`${noSales.slice(0,3).map(p=>p.name).join('، ')} موجودی دارند ولی در فاکتورهای موجود فروش ندارند. قبل از سفارش مجدد، تقاضا و مدت ماندگاری را بررسی کن.`});
    if (highStockSlow.length) recs.push({kind:'warn',icon:'↓',title:'احتمال خواب سرمایه',body:`موجودی ${highStockSlow.slice(0,3).map(p=>p.name).join('، ')} نسبت به فروش ثبت‌شده بالاست؛ فعلاً سفارش بیشتر را با احتیاط انجام بده.`});
    if (highProfit) recs.push({kind:'good',icon:'↗',title:`بیشترین سود ثبت‌شده: ${highProfit.name}`,body:`سود ناخالص محاسبه‌شده از فروش‌های ثبت‌شده: ${money(highProfit._profit)}. موجودی و تداوم تقاضای این کالا را زیر نظر بگیر.`});
    if (!a.validInvoices.length) recs.push({kind:'',icon:'i',title:'هنوز فاکتوری برای تحلیل وجود ندارد',body:'پس از ثبت فروش، سود و عملکرد کالاها در این بخش محاسبه می‌شود.'});
    if (!recs.length) recs.push({kind:'good',icon:'✓',title:'هشدار فوری شناسایی نشد',body:'با اطلاعات فعلی هشدار مشخصی پیدا نشد. با ثبت فروش‌های بیشتر، پیشنهادها دقیق‌تر می‌شوند.'});
    if (a.historyDays < 30) recs.push({kind:'',icon:'30',title:'برای تحلیل روند هنوز زود است',body:`بازهٔ زمانی فاکتورهای موجود حدود ${money(a.historyDays)} روز است. برای مقایسهٔ قابل‌اتکای روند فروش، دست‌کم ۳۰ روز سابقهٔ فروش لازم است.`});
    $('recommendations').innerHTML = recs.map(r=>`<article class="recommendation ${r.kind}"><span class="rec-icon">${esc(r.icon)}</span><div><strong>${esc(r.title)}</strong><p>${esc(r.body)}</p></div></article>`).join('');
  }
  function renderTopProducts(a) {
    const top = [...a.products].filter(p=>p._sold>0).sort((x,y)=>y._sales-x._sales).slice(0,6);
    if (!top.length) { $('topProducts').innerHTML='<p class="empty">فروش ثبت‌شده‌ای برای نمایش وجود ندارد.</p>'; return; }
    const max = Math.max(1,...top.map(p=>p._sales));
    $('topProducts').innerHTML = top.map(p=>`<div class="rank-row"><span class="rank-name" title="${esc(p.name)}">${esc(p.name||'کالای بدون نام')}</span><div class="rank-track"><div class="rank-fill" style="width:${Math.max(2,p._sales/max*100)}%"></div></div><span class="rank-value">${money(p._sales)}</span></div>`).join('');
  }
  function renderInventory(a) {
    const rows = [...a.products].sort((x,y)=>x._qty-y._qty);
    $('inventoryCount').textContent = `${money(rows.length)} کالا`;
    if (!rows.length) { $('inventoryRows').innerHTML='<tr><td colspan="5" class="empty">فایلی بارگذاری شده اما فهرست کالا خالی است.</td></tr>'; return; }
    $('inventoryRows').innerHTML = rows.map(p=>{
      let status='عادی', cls='ok';
      if (p._qty<=0) { status='ناموجود'; cls='danger'; }
      else if (p._qty<=5) { status='نیازمند بررسی'; cls='warn'; }
      else if (p._sold===0 && p._qty>0) { status='بدون فروش ثبت‌شده'; cls='warn'; }
      else if (p._qty>p._sold*3 && p._qty>=20) { status='موجودی بالا'; cls='warn'; }
      return `<tr><td>${esc(p.name||'—')}<div class="muted">${esc(p.barcode||'')}</div></td><td>${money(p._qty)}</td><td>${money(p._sold)}</td><td>${money(p._profitPerUnit)}</td><td><span class="badge ${cls}">${status}</span></td></tr>`;
    }).join('');
  }
  function renderTrend(a) {
    const panel = $('trendPanel');
    if (a.historyDays < 30) { panel.innerHTML=`<div class="trend-empty">سابقهٔ فروش فعلی حدود <strong>${money(a.historyDays)} روز</strong> است. نمودار مقایسهٔ روند پس از حداقل ۳۰ روز سابقهٔ واقعی قابل‌اتکاتر می‌شود. این محدودیت مانع محاسبهٔ آمار فعلی نیست.</div>`; return; }
    const now = new Date(); const values = [];
    for (let i=6;i>=0;i--) { const d = new Date(now.getFullYear(),now.getMonth(),now.getDate()-i*7); const start = new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); const end = start+7*86400000; const sales = a.validInvoices.filter(inv=>num(inv.createdAt)>=start && num(inv.createdAt)<end).reduce((sum,inv)=>sum+num(inv.total),0); values.push({label: new Intl.DateTimeFormat('fa-IR',{day:'numeric',month:'short'}).format(d),sales}); }
    const max = Math.max(1,...values.map(v=>v.sales));
    panel.innerHTML=`<div class="trend-bars">${values.map(v=>`<div class="trend-bar-wrap"><div class="trend-bar" title="${money(v.sales)}" style="height:${Math.max(3,v.sales/max*80)}%"></div><span class="trend-label">${esc(v.label)}</span></div>`).join('')}</div><p class="trend-caption">مجموع فروش هر بازهٔ هفت‌روزه، بر اساس تاریخ ثبت فاکتور.</p>`;
  }
  function invoiceDate(inv){ return dateOf(inv.createdAt); }
  function invoiceSales(inv){ if(Array.isArray(inv.items)) return inv.items.reduce((s,it)=>s+Math.max(0,num(it.quantity))*num(it.salePrice),0); return num(inv.total); }
  function periodInvoices(a){
    const from=jalaliInputToDate($('dateFrom').value,false)?.getTime() ?? -Infinity;
    const to=jalaliInputToDate($('dateTo').value,true)?.getTime() ?? Infinity;
    if(from>to) throw new Error('تاریخ شروع نباید بعد از تاریخ پایان باشد.');
    return a.validInvoices.filter(i=>{const d=invoiceDate(i);return d&&d.getTime()>=from&&d.getTime()<=to;});
  }
  function listMarkup(items,empty='موردی با داده‌های فعلی پیدا نشد.'){return items.length?items.map((x,i)=>`<div class="tool-row"><span class="tool-rank">${money(i+1)}</span><span class="tool-name">${esc(x.name||x.label||'—')}</span><strong>${esc(x.value||'')}</strong></div>`).join(''):`<p class="empty">${empty}</p>`;}
  function renderManagerTools(a){
    const filtered=periodInvoices(a), mode=$('periodMode').value;
    const sumSales=filtered.reduce((s,i)=>s+invoiceSales(i),0), sumProfit=filtered.reduce((s,i)=>s+(Array.isArray(i.items)?i.items.reduce((t,it)=>t+(num(it.salePrice)-num(it.purchasePrice))*Math.max(0,num(it.quantity)),0):0),0);
    const avg=filtered.length?sumSales/filtered.length:0;
    $('periodSummary').innerHTML=[['فروش بازه',money(sumSales)],['سود ناخالص بازه',money(sumProfit)],['تعداد فاکتور',money(filtered.length)],['میانگین فاکتور',money(avg)],['حاشیه سود',sumSales?money(sumProfit/sumSales*100)+'٪':'—'],['تعداد واحد فروخته‌شده',money(filtered.reduce((s,i)=>s+(i.items||[]).reduce((t,it)=>t+Math.max(0,num(it.quantity)),0),0))]].map(([k,v])=>`<article class="tool-kpi"><span>${k}</span><strong>${v}</strong></article>`).join('');
    const buckets=new Map(); filtered.forEach(i=>{const d=invoiceDate(i);if(!d)return;const key=mode==='month'?jalaliLabel(d,true):jalaliLabel(d);const b=buckets.get(key)||{key,sales:0,profit:0,count:0,units:0};b.sales+=invoiceSales(i);b.count++;(i.items||[]).forEach(it=>{const q=Math.max(0,num(it.quantity));b.units+=q;b.profit+=(num(it.salePrice)-num(it.purchasePrice))*q;});buckets.set(key,b);});
    const rows=[...buckets.values()].sort((x,y)=>x.key.localeCompare(y.key));
    $('periodTable').innerHTML=rows.length?`<table><thead><tr><th>${mode==='month'?'ماه':'روز'}</th><th>فروش</th><th>سود ناخالص</th><th>فاکتور</th><th>تعداد واحد</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.key)}</td><td>${money(r.sales)}</td><td>${money(r.profit)}</td><td>${money(r.count)}</td><td>${money(r.units)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">در بازهٔ انتخابی فاکتور معتبری وجود ندارد.</p>';
    const days=new Map(),months=new Map();a.validInvoices.forEach(i=>{const d=invoiceDate(i);if(!d)return;const dk=jalaliLabel(d),mk=jalaliLabel(d,true);days.set(dk,(days.get(dk)||0)+invoiceSales(i));months.set(mk,(months.get(mk)||0)+invoiceSales(i));});
    $('bestDays').innerHTML=listMarkup([...days].sort((x,y)=>y[1]-x[1]).slice(0,5).map(([name,v])=>({name,value:money(v)})));
    $('bestMonths').innerHTML=listMarkup([...months].sort((x,y)=>y[1]-x[1]).slice(0,5).map(([name,v])=>({name,value:money(v)})));
    $('profitLeaders').innerHTML=listMarkup([...a.products].filter(p=>p._sold>0).sort((x,y)=>y._profit-x._profit).slice(0,5).map(p=>({name:p.name,value:money(p._profit)})));
    $('unitLeaders').innerHTML=listMarkup([...a.products].filter(p=>p._sold>0).sort((x,y)=>y._sold-x._sold).slice(0,5).map(p=>({name:p.name,value:money(p._sold)+' عدد'})));
    $('noSalesTools').innerHTML=listMarkup(a.products.filter(p=>p._qty>0&&p._sold===0).slice(0,8).map(p=>({name:p.name,value:money(p._qty)+' موجودی'})));
    $('lowStockTools').innerHTML=listMarkup(a.products.filter(p=>p._qty<=5).sort((x,y)=>x._qty-y._qty).slice(0,8).map(p=>({name:p.name,value:money(p._qty)+' عدد'})));
    $('deadStockTools').innerHTML=listMarkup(a.products.filter(p=>p._qty>0&&p._sold===0).sort((x,y)=>(y._qty*num(y.purchasePrice))-(x._qty*num(x.purchasePrice))).slice(0,8).map(p=>({name:p.name,value:money(p._qty*num(p.purchasePrice))+' ارزش خرید'})));
    $('kpiTools').innerHTML=listMarkup([{name:'میانگین مبلغ فاکتور',value:money(a.validInvoices.length?a.totalSales/a.validInvoices.length:0)},{name:'میانگین سود فاکتور',value:money(a.validInvoices.length?a.totalProfit/a.validInvoices.length:0)},{name:'حاشیه سود ناخالص',value:(a.totalSales?money(a.totalProfit/a.totalSales*100):'۰')+'٪'},{name:'تعداد فاکتورهای امروز',value:money(a.todayInvoices)},{name:'تعداد واحد فروخته‌شده',value:money(a.totalSoldUnits)}]);
    $('reorderTools').innerHTML=listMarkup(a.products.filter(p=>p._qty<=5).sort((x,y)=>x._qty-y._qty).slice(0,8).map(p=>({name:p.name,value:'بررسی سفارش · موجودی '+money(p._qty)})),'فعلاً کالایی با موجودی ۵ عدد یا کمتر نیست.');
    const current=filtered.reduce((s,i)=>s+invoiceSales(i),0);
    const fromDate=jalaliInputToDate($('dateFrom').value,false), toDate=jalaliInputToDate($('dateTo').value,false); const span=fromDate&&toDate?Math.max(1,toDate.getTime()-fromDate.getTime()+86400000):null;
    let previous='برای مقایسهٔ دقیق، تاریخ شروع و پایان را انتخاب کن.';
    if(span){const currentStart=fromDate.getTime();const prevStart=currentStart-span;const prevEnd=currentStart-1;const old=a.validInvoices.filter(i=>{const d=invoiceDate(i);return d&&d.getTime()>=prevStart&&d.getTime()<=prevEnd;}).reduce((s,i)=>s+invoiceSales(i),0);const delta=old?((current-old)/old*100):null;previous=`فروش دورهٔ انتخابی: ${money(current)}؛ دورهٔ قبل: ${money(old)}؛ تغییر: ${delta===null?'مبنای مقایسه ندارد':(delta>0?'+':'')+money(delta)+'٪'}.`}
    $('compareTools').innerHTML=`<p class="tool-note">${esc(previous)}</p>`;
  }

  $('connectBtn').addEventListener('click', connectFolder);
  $('refreshBtn').addEventListener('click', refreshData);
  $('folderInput').addEventListener('change', async (event) => {
    const files = event.target.files; if (!files || !files.length) return;
    try { setStatus('در حال خواندن فایل‌های انتخاب‌شده…'); const data = await readFromInputFiles(files); state.directoryHandle = null; $('refreshBtn').disabled = true; applyData(data); setStatus('فایل‌ها خوانده شدند. برای تازه‌سازی در این مرورگر، دوباره پوشه را انتخاب کن.', 'success'); }
    catch (err) { setStatus(err.message || 'خواندن فایل‌ها ناموفق بود.', 'error'); }
    event.target.value = '';
  });
  $('applyPeriod').addEventListener('click', () => { try { if (state.products.length || state.invoices.length) renderManagerTools(getAnalytics()); } catch(e) { setStatus(e.message || 'تاریخ واردشده معتبر نیست.','error'); } });
  $('clearPeriod').addEventListener('click', () => { $('dateFrom').value=''; $('dateTo').value=''; $('periodMode').value='month'; if (state.products.length || state.invoices.length) renderManagerTools(getAnalytics()); });
})();
