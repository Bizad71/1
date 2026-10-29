(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { directoryHandle: null, products: [], invoices: [], movements: [], settings: {}, fileNames: [], loaded: false };
  const FILES = ['biza-products.json', 'biza-invoices.json', 'biza-stock-movements.json', 'biza-settings.json'];
  const money = (n) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0;
  const dateOf = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
  const jalaliFormatter = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'});
  const jalaliLocalFormatter = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {year:'numeric',month:'2-digit',day:'2-digit'});
  const faDigits = (s) => String(s ?? '').replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  const toFaDigits = (s) => String(s).replace(/\d/g, c => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]);
  const jalaliParts = (d) => { const p = Object.fromEntries(jalaliFormatter.formatToParts(d).map(x=>[x.type,x.value])); return {year:Number(p.year),month:Number(p.month),day:Number(p.day)}; };
  // Use local calendar dates for real invoice timestamps; keep the UTC helper for calendar-grid iteration.
  const jalaliLocalParts = (d) => { const p = Object.fromEntries(jalaliLocalFormatter.formatToParts(d).map(x=>[x.type,x.value])); return {year:Number(p.year),month:Number(p.month),day:Number(p.day)}; };
  const jalaliLabel = (d, monthOnly=false) => { if(!d || Number.isNaN(d.getTime())) return 'نامشخص'; const p=jalaliLocalParts(d); return toFaDigits(monthOnly ? `${p.year}/${String(p.month).padStart(2,'0')}` : `${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`); };
  const jalaliInputToDate = (value, end=false) => { if(!value) return null; const m=faDigits(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); if(!m) throw new Error('تاریخ را به شکل شمسی سال/ماه/روز وارد کن؛ نمونه: ۱۴۰۵/۰۷/۳۰'); const jy=+m[1], jm=+m[2], jd=+m[3]; if(jm<1||jm>12||jd<1||jd>31) throw new Error('تاریخ شمسی واردشده معتبر نیست.'); const start=Date.UTC(jy+621,0,1), stop=Date.UTC(jy+623,0,1); for(let t=start;t<stop;t+=86400000){const d=new Date(t), q=jalaliParts(d); if(q.year===jy&&q.month===jm&&q.day===jd) return new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),end?23:0,end?59:0,end?59:0,end?999:0);} throw new Error('این تاریخ شمسی وجود ندارد؛ روز و ماه را بررسی کن.'); };
  const dateLabel = (value) => { const d = dateOf(value); return d ? jalaliLabel(d) : 'نامشخص'; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setStatus = (message, kind = '') => { const el = $('statusMessage'); el.textContent = message; el.className = `status-message ${kind}`.trim(); };
  const parseJSON = (text, name) => { try { return JSON.parse(text); } catch { throw new Error(`فایل «${name}» JSON معتبر نیست.`); } };
  function normalizeArray(value, name) { if (!Array.isArray(value)) throw new Error(`ساختار فایل «${name}» معتبر نیست؛ انتظار آرایه می‌رفت.`); return value; }

  async function readFromDirectoryHandle(handle) {
    const out = {};
    for (const name of FILES) {
      try {
        const fileHandle = await handle.getFileHandle(name);
        const file = await fileHandle.getFile();
        out[name] = parseJSON(await file.text(), name);
      } catch (err) {
        if (err && err.name === 'NotFoundError') {
          out[name] = name === 'biza-settings.json' ? {} : [];
          continue;
        }
        throw err;
      }
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
  function applyData(data, shouldPersist = true) {
    state.loaded = true;
    if (shouldPersist) { try { sessionStorage.setItem('mahshapAnalyticsData', JSON.stringify(data)); } catch (_) { /* storage may be unavailable or full; current session still works */ } }
    state.products = normalizeArray(data['biza-products.json'], 'biza-products.json');
    state.invoices = normalizeArray(data['biza-invoices.json'], 'biza-invoices.json');
    state.movements = normalizeArray(data['biza-stock-movements.json'], 'biza-stock-movements.json');
    state.settings = data['biza-settings.json'] && typeof data['biza-settings.json'] === 'object' ? data['biza-settings.json'] : {};
    if (!state.products.length && !state.invoices.length) setStatus('پوشه وصل شد، اما فعلاً کالا یا فاکتوری در فایل‌ها نیست.', 'success');
    else setStatus(`پوشه متصل شد؛ ${money(state.products.length)} کالا و ${money(state.invoices.length)} فاکتور خوانده شد.`, 'success');
    $('refreshBtn').disabled = !state.directoryHandle;
    renderDashboard();
  }
  const SHARED_HANDLE_DB = 'biza_lite_handles';
  const SHARED_HANDLE_STORE = 'handles';

  function openSharedHandleDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SHARED_HANDLE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SHARED_HANDLE_STORE)) request.result.createObjectStore(SHARED_HANDLE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function getSharedDirectoryHandle() {
    const idb = await openSharedHandleDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = idb.transaction(SHARED_HANDLE_STORE, 'readonly').objectStore(SHARED_HANDLE_STORE).get('directory');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally { idb.close(); }
  }

  async function readConnectedHandle(handle, requestPermission = false) {
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted' && requestPermission && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'read' });
    }
    if (permission !== 'granted') return false;
    setStatus('در حال خواندن دیتابیس فروشگاه…');
    const data = await readFromDirectoryHandle(handle);
    state.directoryHandle = handle;
    applyData(data);
    return true;
  }

  async function connectFolder() {
    try {
      // The main store page saves its directory handle here. Reuse it before opening another picker.
      let savedHandle = null;
      try { savedHandle = await getSharedDirectoryHandle(); } catch (_) {}
      if (savedHandle && await readConnectedHandle(savedHandle, true)) return;

      if (window.showDirectoryPicker) {
        try {
          const handle = await window.showDirectoryPicker({ mode: 'read' });
          if (handle.requestPermission) {
            const permission = await handle.requestPermission({ mode: 'read' });
            if (permission !== 'granted') throw new Error('اجازهٔ خواندن پوشه داده نشد.');
          }
          setStatus('در حال خواندن دیتابیس فروشگاه…');
          const data = await readFromDirectoryHandle(handle);
          state.directoryHandle = handle;
          applyData(data);
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          if (!(err && /showDirectoryPicker/.test(String(err)))) {
            setStatus(err.message || 'اتصال پوشه انجام نشد.', 'error');
            return;
          }
        }
      }
      setStatus('این مرورگر اتصال مستقیم پوشه را پشتیبانی نمی‌کند؛ فایل‌های دیتابیس را با انتخاب‌گر فایل انتخاب کن.');
      $('folderInput').click();
    } catch (err) {
      setStatus(err.message || 'اتصال دیتابیس فروشگاه ناموفق بود.', 'error');
    }
  }
  async function refreshData() {
    if (!state.directoryHandle) { setStatus('برای تازه‌سازی، چهار فایل JSON دیتابیس را دوباره انتخاب کن.'); $('folderInput').click(); return; }
    try { setStatus('در حال به‌روزرسانی…'); const data = await readFromDirectoryHandle(state.directoryHandle); applyData(data); }
    catch (err) { setStatus(err.message || 'خواندن دوبارهٔ فایل‌ها ناموفق بود.', 'error'); }
  }
  function getAnalytics() {
    const soldById = new Map(), soldByName = new Map();
    const salesById = new Map(), salesByName = new Map();
    const profitById = new Map(), profitByName = new Map();
    let totalSales = 0, totalProfit = 0, cogs = 0, totalSoldUnits = 0;
    const validInvoices = state.invoices.filter(inv => inv && Array.isArray(inv.items));
    for (const inv of validInvoices) {
      for (const item of inv.items) {
        const q = Math.max(0, num(item.quantity)); const sale = num(item.salePrice); const buy = num(item.purchasePrice);
        const sales = sale * q, profit = (sale - buy) * q;
        totalSales += sales; totalProfit += profit; cogs += buy * q; totalSoldUnits += q;
        const id = item.productId || item.name || 'unknown';
        const name = item.name || id;
        soldById.set(id, (soldById.get(id) || 0) + q);
        salesById.set(id, (salesById.get(id) || 0) + sales);
        profitById.set(id, (profitById.get(id) || 0) + profit);
        soldByName.set(name, (soldByName.get(name) || 0) + q);
        salesByName.set(name, (salesByName.get(name) || 0) + sales);
        profitByName.set(name, (profitByName.get(name) || 0) + profit);
      }
    }
    const products = state.products.map(p => {
      const id = p.id || p.barcode || p.name;
      const sold = soldById.has(id) ? soldById.get(id) : (soldByName.get(p.name) || 0);
      const profitPerUnit = num(p.salePrice) - num(p.purchasePrice);
      const actualSales = salesById.has(id) ? salesById.get(id) : (salesByName.has(p.name) ? salesByName.get(p.name) : sold * num(p.salePrice));
      const actualProfit = profitById.has(id) ? profitById.get(id) : (profitByName.has(p.name) ? profitByName.get(p.name) : sold * profitPerUnit);
      return { ...p, _id: id, _qty: num(p.quantity), _sold: sold, _profitPerUnit: profitPerUnit, _sales: actualSales, _profit: actualProfit };
    });
    const stockUnits = products.reduce((s,p) => s + Math.max(0,p._qty), 0);
    const stockValue = products.reduce((s,p) => s + Math.max(0,p._qty) * Math.max(0,num(p.purchasePrice)), 0);
    const dates = validInvoices.map(i => dateOf(i.createdAt)).filter(Boolean).sort((a,b) => a-b);
    const civilDayIndex = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const historyDays = dates.length ? Math.max(1, civilDayIndex(dates[dates.length-1]) - civilDayIndex(dates[0]) + 1) : 0;
    const today = new Date(); const todayStart = new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
    const todayInvoices = validInvoices.filter(i => { const d = dateOf(i.createdAt); return d && d.getTime() >= todayStart; }).length;
    return { products, validInvoices, totalSales, totalProfit, cogs, totalSoldUnits, stockUnits, stockValue, historyDays, dates, todayInvoices, soldByName };
  }
  function renderDashboard() {
    const a = getAnalytics();
    const analysisReady = a.historyDays >= 30;
    $('dashboard').hidden = !analysisReady;
    $('analysisLockedState').hidden = analysisReady;
    $('welcomeState').hidden = Boolean(state.loaded);
    if (!analysisReady) {
      $('lockedProductCount').textContent = `کالاها: ${money(state.products.length)}`;
      $('lockedInvoiceCount').textContent = `فاکتورها: ${money(a.validInvoices.length)}`;
      $('analysisLockedText').textContent = a.validInvoices.length
        ? `دیتابیس متصل است، اما سابقهٔ فروش موجود حدود ${money(a.historyDays)} روز است. برای نمایش همهٔ گزارش‌ها و پیشنهادهای هوشمند، فاکتورهای ثبت‌شده باید دست‌کم ۳۰ روز را پوشش دهند.`
        : 'دیتابیس متصل است، اما هنوز فاکتور فروش معتبری وجود ندارد. پس از ثبت فروش و ایجاد دست‌کم ۳۰ روز سابقه، همهٔ گزارش‌ها و پیشنهادهای هوشمند فعال می‌شوند.';
      return;
    }
    $('totalSales').textContent = money(a.totalSales);
    $('totalProfit').textContent = money(a.totalProfit);
    $('profitMargin').textContent = a.totalSales ? `حاشیه سود ناخالص ${money(a.totalProfit / a.totalSales * 100)}٪` : 'هنوز فروش ثبت نشده است';
    $('productCount').textContent = money(a.products.length);
    $('stockUnits').textContent = `مجموع موجودی: ${money(a.stockUnits)} عدد`;
    $('stockValue').textContent = money(a.stockValue);
    $('invoiceCount').textContent = `${money(a.validInvoices.length)} فاکتور ثبت‌شده · امروز ${money(a.todayInvoices)} فاکتور`;
    $('dataDate').textContent = `آخرین بررسی: ${dateLabel(Date.now())}`;
    renderRecommendations(a); renderTopProducts(a); renderInventory(a); renderTrend(a); renderWeekdaySales(a); renderManagerTools(a);
  }
  function renderRecommendations(a) {
    const recs = [];
    const low = a.products.filter(p => p._qty <= 5).sort((x,y) => x._qty-y._qty);
    const noSales = a.products.filter(p => p._qty > 0 && p._sold === 0);
    const stockCoverDays = p => p._qty / Math.max(0.01, p._sold / Math.max(1,a.historyDays));
    const highStockSlow = a.products.filter(p => p._qty >= 20 && p._sold > 0 && stockCoverDays(p) >= 45)
      .sort((x,y) => stockCoverDays(y)-stockCoverDays(x));
    const lossMaking = a.products.filter(p => p._sold > 0 && p._profitPerUnit < 0)
      .sort((x,y) => x._profitPerUnit-y._profitPerUnit);
    const lowMargin = a.products.filter(p => p._sold > 0 && num(p.salePrice) > 0 && p._profitPerUnit >= 0 && p._profitPerUnit / num(p.salePrice) < 0.10)
      .sort((x,y) => (x._profitPerUnit / Math.max(1,num(x.salePrice)))-(y._profitPerUnit / Math.max(1,num(y.salePrice))));
    const fastMoving = a.products.filter(p => p._sold > 0 && p._qty > 0 && (p._qty / Math.max(0.01, p._sold / Math.max(1,a.historyDays))) <= 7)
      .sort((x,y) => (x._qty / Math.max(0.01,x._sold / Math.max(1,a.historyDays)))-(y._qty / Math.max(0.01,y._sold / Math.max(1,a.historyDays))));
    const highProfit = [...a.products].filter(p => p._sold > 0).sort((x,y) => y._profit-x._profit)[0];
    const bestVolume = [...a.products].filter(p => p._sold > 0).sort((x,y) => y._sold-x._sold)[0];
    const weekdayNames = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
    const weekdayTotals = Array(7).fill(0);
    a.validInvoices.forEach(inv => {
      const date = invoiceDate(inv);
      if (!date) return;
      weekdayTotals[(date.getDay()+1)%7] += invoiceSales(inv);
    });
    const bestWeekdayIndex = weekdayTotals.reduce((best,value,index) => value>weekdayTotals[best]?index:best,0);
    const weekdayHasSales = weekdayTotals.some(value => value > 0);

    if (low.length) recs.push({kind:'warn',icon:'!',title:`${money(low.length)} کالا با موجودی کم`,body:`${low.slice(0,3).map(p=>`${p.name} (${money(p._qty)} عدد)`).join('، ')}${low.length>3?' و موارد دیگر':''}. سرعت فروش و زمان تأمین کالا را برای سفارش بعدی بررسی کن.`});
    if (fastMoving.length) recs.push({kind:'warn',icon:'↗',title:'کالاهای در آستانه اتمام بر اساس سرعت فروش',body:`${fastMoving.slice(0,3).map(p=>`${p.name} (حدود ${money(p._qty / Math.max(0.01,p._sold / Math.max(1,a.historyDays)))} روز موجودی)`).join('، ')}. برای جلوگیری از اتمام موجودی، زمان تأمین را بررسی کن.`});
    if (lossMaking.length) recs.push({kind:'warn',icon:'−',title:'فروش با زیان ثبت‌شده',body:`قیمت فروش ${lossMaking.slice(0,3).map(p=>p.name).join('، ')} از قیمت خرید ثبت‌شده کمتر است. قیمت‌ها و تخفیف‌ها را بررسی کن.`});
    if (lowMargin.length) recs.push({kind:'warn',icon:'٪',title:'حاشیه سود کمتر از ۱۰٪',body:`حاشیه سود ${lowMargin.slice(0,3).map(p=>p.name).join('، ')} پایین است. هزینه‌های جانبی و قیمت فروش را بررسی کن.`});
    if (noSales.length) recs.push({kind:'warn',icon:'◷',title:'موجودی بدون فروش ثبت‌شده',body:`${noSales.slice(0,3).map(p=>p.name).join('، ')} موجودی دارند ولی در فاکتورهای موجود فروش ندارند. قبل از سفارش مجدد، تقاضا و مدت ماندگاری را بررسی کن.`});
    if (highStockSlow.length) recs.push({kind:'warn',icon:'↓',title:'احتمال خواب سرمایه بر اساس پوشش موجودی',body:`موجودی ${highStockSlow.slice(0,3).map(p=>`${p.name} (حدود ${money(stockCoverDays(p))} روز پوشش فروش)`).join('، ')} با نرخ فروش ثبت‌شده برای دست‌کم ۴۵ روز کافی به نظر می‌رسد؛ سفارش مجدد را با احتیاط بررسی کن.`});
    if (highProfit) recs.push({kind:'good',icon:'↗',title:`بیشترین سود ثبت‌شده: ${highProfit.name}`,body:`سود ناخالص محاسبه‌شده از فاکتورهای موجود: ${money(highProfit._profit)}. موجودی و تداوم تقاضای این کالا را زیر نظر بگیر.`});
    if (bestVolume) recs.push({kind:'good',icon:'★',title:`پرفروش‌ترین کالا از نظر تعداد: ${bestVolume.name}`,body:`در سابقهٔ موجود ${money(bestVolume._sold)} واحد فروخته شده است. موجودی و امکان تأمین این کالا را متناسب با تقاضا نگه دار.`});
    if (weekdayHasSales) recs.push({kind:'',icon:'۷',title:`روز پرفروش هفته: ${weekdayNames[bestWeekdayIndex]}`,body:`بیشترین مجموع فروش در روز ${weekdayNames[bestWeekdayIndex]} ثبت شده است. این الگو را برای زمان‌بندی موجودی و نیروی فروش در نظر بگیر.`});
    if (!a.validInvoices.length) recs.push({kind:'',icon:'i',title:'هنوز فاکتوری برای تحلیل وجود ندارد',body:'پس از ثبت فروش، سود و عملکرد کالاها در این بخش محاسبه می‌شود.'});
    if (!recs.length) recs.push({kind:'good',icon:'✓',title:'هشدار فوری شناسایی نشد',body:'با اطلاعات فعلی هشدار مشخصی پیدا نشد. با ثبت فروش‌های بیشتر، پیشنهادها دقیق‌تر می‌شوند.'});
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
    if (a.historyDays < 30) {
      panel.innerHTML = `<div class="trend-empty">برای نمایش نمودار، دست‌کم ۳۰ روز سابقهٔ فروش لازم است.</div>`;
      return;
    }

    const yearSelect = $('trendYear');
    const monthSelect = $('trendMonth');
    const currentYear = jalaliLocalParts(new Date()).year;
    const yearsFromSales = a.validInvoices.map(inv => invoiceDate(inv)).filter(Boolean).map(date => jalaliLocalParts(date).year);
    const minYear = yearsFromSales.length ? Math.min(...yearsFromSales) : currentYear;
    const maxYear = Math.max(currentYear, ...(yearsFromSales.length ? yearsFromSales : [currentYear]));
    const years = Array.from({ length: maxYear - minYear + 1 }, (_,index) => minYear + index);
    const previousYear = Number(yearSelect.value);
    const selectedYear = years.includes(previousYear) ? previousYear : Math.max(...years);
    yearSelect.innerHTML = years.map(year => `<option value="${year}">${toFaDigits(year)}</option>`).join('');
    yearSelect.value = String(selectedYear);

    const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
    const currentMonth = jalaliLocalParts(new Date()).month;
    const previousMonth = Number(monthSelect.value);
    const selectedMonth = previousMonth >= 1 && previousMonth <= 12 ? previousMonth : currentMonth;
    monthSelect.innerHTML = monthNames.map((name,index) => `<option value="${index+1}">${name}</option>`).join('');
    monthSelect.value = String(selectedMonth);

    const view = $('trendView').value === 'month' ? 'month' : 'year';
    $('trendMonthField').hidden = view !== 'month';
    let values = [];
    if (view === 'year') {
      values = monthNames.map((name,index) => {
        const month = index + 1;
        const sales = a.validInvoices.reduce((sum,inv) => {
          const date = invoiceDate(inv);
          if (!date) return sum;
          const parts = jalaliLocalParts(date);
          return parts.year === selectedYear && parts.month === month ? sum + invoiceSales(inv) : sum;
        },0);
        return { label:name, sales };
      });
    } else {
      const monthStart = findJalaliMonthStart(selectedYear, selectedMonth);
      if (!monthStart) {
        panel.innerHTML = '<div class="trend-empty">نمایش این ماه ممکن نیست.</div>';
        return;
      }
      for (let offset=0; offset<32; offset++) {
        const date = new Date(monthStart.getTime() + offset * 86400000);
        const parts = jalaliParts(date);
        if (parts.year !== selectedYear || parts.month !== selectedMonth) break;
        const sales = a.validInvoices.reduce((sum,inv) => {
          const invoiceWhen = invoiceDate(inv);
          if (!invoiceWhen) return sum;
          const invoiceParts = jalaliLocalParts(invoiceWhen);
          return invoiceParts.year === selectedYear && invoiceParts.month === selectedMonth && invoiceParts.day === parts.day
            ? sum + invoiceSales(inv) : sum;
        },0);
        values.push({ label:toFaDigits(parts.day), sales });
      }
    }
    const max = Math.max(1,...values.map(value => value.sales));
    const className = view === 'month' ? 'trend-bars trend-bars-month' : 'trend-bars';
    panel.innerHTML = `<div class="${className}">${values.map(value=>`<div class="trend-bar-wrap"><div class="trend-bar" title="${esc(value.label)} · ${money(value.sales)} تومان" style="height:${Math.max(2,value.sales/max*82)}%"></div><span class="trend-label">${esc(value.label)}</span></div>`).join('')}</div><p class="trend-caption">${view==='year' ? `مجموع فروش هر ماه شمسی در سال ${toFaDigits(selectedYear)}؛ برای ماهانه‌دیدن، نوع نمودار را تغییر بده.` : `مجموع فروش هر روز ${monthNames[selectedMonth-1]} ${toFaDigits(selectedYear)}.`}</p>`;
  }

  function renderWeekdaySales(a) {
    const panel = $('weekdayPanel');
    const names = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
    const totals = Array(7).fill(0);
    a.validInvoices.forEach(inv => {
      const date = invoiceDate(inv);
      if (!date) return;
      totals[(date.getDay()+1)%7] += invoiceSales(inv);
    });
    const max = Math.max(1,...totals);
    const bestIndex = totals.reduce((best,value,index) => value>totals[best]?index:best,0);
    panel.innerHTML = `<div class="weekday-bars">${names.map((name,index)=>`<div class="weekday-column"><span class="weekday-value">${money(totals[index])}</span><div class="weekday-track"><div class="weekday-bar" style="height:${Math.max(2,totals[index]/max*100)}%"></div></div><span class="weekday-label">${name}</span></div>`).join('')}</div><p class="trend-caption">${totals.some(value=>value>0) ? `پرفروش‌ترین روز هفته: ${names[bestIndex]} با ${money(totals[bestIndex])} تومان فروش ثبت‌شده.` : 'در فاکتورهای موجود فروشی برای مقایسهٔ روزهای هفته ثبت نشده است.'}</p>`;
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
    const fromDate=jalaliInputToDate($('dateFrom').value,false), toDate=jalaliInputToDate($('dateTo').value,true); const span=fromDate&&toDate?Math.max(1,toDate.getTime()-fromDate.getTime()+1):null;
    let previous='برای مقایسهٔ دقیق، تاریخ شروع و پایان را انتخاب کن.';
    if(span){const currentStart=fromDate.getTime();const prevStart=currentStart-span;const prevEnd=currentStart-1;const old=a.validInvoices.filter(i=>{const d=invoiceDate(i);return d&&d.getTime()>=prevStart&&d.getTime()<=prevEnd;}).reduce((s,i)=>s+invoiceSales(i),0);const delta=old?((current-old)/old*100):null;previous=`فروش دورهٔ انتخابی: ${money(current)}؛ دورهٔ قبل: ${money(old)}؛ تغییر: ${delta===null?'مبنای مقایسه ندارد':(delta>0?'+':'')+money(delta)+'٪'}.`}
    $('compareTools').innerHTML=`<p class="tool-note">${esc(previous)}</p>`;
  }

  // Mobile-friendly Persian/Jalali date picker. Uses Intl's Persian calendar, no external library.
  const calendarState = { target: null, year: 0, month: 0 };
  const jalaliMonthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const calendarLayer = $('jalaliCalendar');
  function findJalaliMonthStart(year, month) {
    const begin = Date.UTC(year + 620, 0, 1), finish = Date.UTC(year + 623, 0, 1);
    for (let t = begin; t < finish; t += 86400000) {
      const d = new Date(t), p = jalaliParts(d);
      if (p.year === year && p.month === month && p.day === 1) return d;
    }
    return null;
  }
  function calendarRender() {
    $('calendarTitle').textContent = `${jalaliMonthNames[calendarState.month-1]} ${toFaDigits(calendarState.year)}`;
    const first = findJalaliMonthStart(calendarState.year, calendarState.month);
    const host = $('calendarDays'); host.innerHTML = '';
    if (!first) { host.innerHTML = '<p class="empty">نمایش این ماه ممکن نیست.</p>'; return; }
    const offset = (first.getUTCDay() + 1) % 7; // Saturday-first week
    for (let i=0; i<offset; i++) { const blank=document.createElement('span'); blank.className='calendar-blank'; blank.setAttribute('aria-hidden','true'); host.appendChild(blank); }
    const dates=[]; const begin=first.getTime(); const end=Date.UTC(calendarState.year+623,0,1);
    for(let t=begin;t<end;t+=86400000){ const d=new Date(t), p=jalaliParts(d); if(p.year===calendarState.year&&p.month===calendarState.month) dates.push(p); else if(dates.length) break; }
    const chosen = calendarState.target?.value ? jalaliInputToDate(calendarState.target.value,false) : null;
    const chosenParts = chosen ? jalaliParts(new Date(Date.UTC(chosen.getFullYear(),chosen.getMonth(),chosen.getDate()))) : null;
    const nowParts = jalaliLocalParts(new Date());
    dates.forEach(p=>{
      const b=document.createElement('button'); b.type='button'; b.className='calendar-day'; b.textContent=toFaDigits(p.day);
      b.setAttribute('aria-label',`${p.year}/${p.month}/${p.day}`);
      if(p.year===nowParts.year&&p.month===nowParts.month&&p.day===nowParts.day)b.classList.add('is-today');
      if(chosenParts&&p.year===chosenParts.year&&p.month===chosenParts.month&&p.day===chosenParts.day)b.classList.add('is-selected');
      b.addEventListener('click',()=>{calendarState.target.value=`${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`;calendarState.target.dispatchEvent(new Event('change',{bubbles:true}));closeCalendar();updatePeriodSafely();});
      host.appendChild(b);
    });
  }
  function openCalendar(target){
    calendarState.target=target;
    let p=null; if(target.value){try{const d=jalaliInputToDate(target.value,false);if(d)p=jalaliParts(new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())));}catch{}}
    if(!p)p=jalaliLocalParts(new Date()); calendarState.year=p.year;calendarState.month=p.month;
    calendarLayer.hidden=false;calendarLayer.setAttribute('aria-hidden','false');document.body.classList.add('calendar-open');calendarRender();$('calendarClose').focus();
  }
  function closeCalendar(){calendarLayer.hidden=true;calendarLayer.setAttribute('aria-hidden','true');document.body.classList.remove('calendar-open');if(calendarState.target)calendarState.target.focus();calendarState.target=null;}
  function updatePeriodSafely(){if(!(state.products.length||state.invoices.length))return;try{renderManagerTools(getAnalytics());setStatus('گزارش با تاریخ انتخاب‌شده به‌روزرسانی شد.','success');}catch(e){setStatus(e.message||'به‌روزرسانی گزارش ناموفق بود.','error');}}
  ['dateFrom','dateTo'].forEach(id=>{const input=$(id);input.addEventListener('click',()=>openCalendar(input));input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCalendar(input);}});});
  $('calendarPrev').addEventListener('click',()=>{calendarState.month--;if(calendarState.month<1){calendarState.month=12;calendarState.year--;}calendarRender();});
  $('calendarNext').addEventListener('click',()=>{calendarState.month++;if(calendarState.month>12){calendarState.month=1;calendarState.year++;}calendarRender();});
  $('calendarClose').addEventListener('click',closeCalendar);
  $('calendarToday').addEventListener('click',()=>{const p=jalaliLocalParts(new Date());if(calendarState.target)calendarState.target.value=`${p.year}/${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`;closeCalendar();updatePeriodSafely();});
  $('calendarClear').addEventListener('click',()=>{if(calendarState.target)calendarState.target.value='';closeCalendar();updatePeriodSafely();});
  calendarLayer.addEventListener('click',e=>{if(e.target===calendarLayer)closeCalendar();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!calendarLayer.hidden)closeCalendar();});

  ['trendView','trendYear','trendMonth'].forEach(id => {
    $(id).addEventListener('change', () => {
      if (!state.loaded) return;
      const analytics = getAnalytics();
      if (analytics.historyDays >= 30) renderTrend(analytics);
    });
  });

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
  async function restoreInitialData() {
    let restoredSession = false;
    // A session snapshot is only a fallback; prefer the current files in the shared store folder.
    try {
      const saved = sessionStorage.getItem('mahshapAnalyticsData');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && FILES.every(name => Object.prototype.hasOwnProperty.call(parsed, name))) {
          applyData(parsed, false);
          setStatus('اطلاعات همین نشست بازیابی شد؛ برای آخرین تغییرات دیتابیس را تازه کن.', 'success');
          restoredSession = true;
        }
      }
    } catch (_) { /* ignore stale or unavailable session cache */ }

    try {
      const handle = await getSharedDirectoryHandle();
      if (handle) {
        const permission = await handle.queryPermission({ mode: 'read' });
        if (permission === 'granted') {
          setStatus('در حال اتصال خودکار به دیتابیس فروشگاه…');
          const data = await readFromDirectoryHandle(handle);
          state.directoryHandle = handle;
          applyData(data, false);
          setStatus('دیتابیس مشترک فروشگاه Mahshap متصل شد و گزارش‌ها به‌روز هستند.', 'success');
          return;
        }
        if (!restoredSession) setStatus('دیتابیس فروشگاه شناسایی شد؛ برای تأیید دسترسی، دکمهٔ اتصال را بزن.');
      } else if (!restoredSession) {
        setStatus('برای شروع، دیتابیس فروشگاه را از دکمهٔ اتصال برقرار کن.');
      }
    } catch (err) {
      if (!restoredSession) setStatus(err.message || 'اتصال خودکار دیتابیس انجام نشد؛ دکمهٔ اتصال را بزن.');
    }
  }
  restoreInitialData();
})();
