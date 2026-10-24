(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { directoryHandle: null, products: [], invoices: [], movements: [], settings: {}, fileNames: [] };
  const FILES = ['biza-products.json', 'biza-invoices.json', 'biza-stock-movements.json', 'biza-settings.json'];
  const money = (n) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const num = (n) => Number.isFinite(Number(n)) ? Number(n) : 0;
  const dateOf = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
  const dateLabel = (value) => { const d = dateOf(value); return d ? new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d) : 'نامشخص'; };
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
    const soldById = new Map(), soldByName = new Map(), salesById = new Map(), salesByName = new Map(), profitById = new Map(), profitByName = new Map();
    let totalSales = 0, totalProfit = 0, cogs = 0, totalSoldUnits = 0;
    const validInvoices = state.invoices.filter(inv => inv && Array.isArray(inv.items));
    for (const inv of validInvoices) {
      for (const item of inv.items) {
        const q = Math.max(0, num(item.quantity)); const sale = num(item.salePrice); const buy = num(item.purchasePrice);
        const sales = sale * q, profit = (sale - buy) * q;
        totalSales += sales; totalProfit += profit; cogs += buy * q; totalSoldUnits += q;
        const id = item.productId || item.name || 'unknown';
        soldById.set(id, (soldById.get(id) || 0) + q); salesById.set(id, (salesById.get(id) || 0) + sales); profitById.set(id, (profitById.get(id) || 0) + profit);
        soldByName.set(item.name || id, (soldByName.get(item.name || id) || 0) + q);
        salesByName.set(item.name || id, (salesByName.get(item.name || id) || 0) + sales); profitByName.set(item.name || id, (profitByName.get(item.name || id) || 0) + profit);
      }
    }
    const products = state.products.map(p => {
      const id = p.id || p.barcode || p.name;
      const sold = soldById.get(id) || soldByName.get(p.name) || 0;
      const profitPerUnit = num(p.salePrice) - num(p.purchasePrice);
      const actualSales = salesById.has(id) ? salesById.get(id) : (salesByName.get(p.name) ?? sold * num(p.salePrice));
      const actualProfit = profitById.has(id) ? profitById.get(id) : (profitByName.get(p.name) ?? sold * profitPerUnit);
      return { ...p, _id: id, _qty: num(p.quantity), _sold: sold, _profitPerUnit: profitPerUnit, _sales: actualSales, _profit: actualProfit };
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
    renderRecommendations(a); renderTopProducts(a); renderInventory(a); renderTrend(a);
  }
  function renderRecommendations(a) {
    const recs = [];
    const invoices = a.validInvoices.map(inv => ({...inv, _date: dateOf(inv.createdAt)})).filter(inv => inv._date);
    const lastDate = invoices.length ? new Date(Math.max(...invoices.map(i => i._date.getTime()))) : new Date();
    const dayMs = 86400000;
    const recentStart = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate() - 29).getTime();
    const previousStart = recentStart - 30 * dayMs;
    const recentInvoices = invoices.filter(i => i._date.getTime() >= recentStart && i._date.getTime() < new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate() + 1).getTime());
    const previousInvoices = invoices.filter(i => i._date.getTime() >= previousStart && i._date.getTime() < recentStart);
    const recentSales = recentInvoices.reduce((s,i) => s + num(i.total), 0);
    const previousSales = previousInvoices.reduce((s,i) => s + num(i.total), 0);
    const low = a.products.filter(p => p._qty <= 5).sort((x,y) => x._qty-y._qty);
    const noSales = a.products.filter(p => p._qty > 0 && p._sold === 0);
    const highStockSlow = a.products.filter(p => p._qty >= 10 && p._sold > 0 && p._qty > p._sold * 2.5).sort((x,y) => (y._qty / Math.max(1,y._sold))-(x._qty / Math.max(1,x._sold)));
    const soldProducts = [...a.products].filter(p => p._sold > 0);
    const highProfit = [...soldProducts].sort((x,y) => y._profit-x._profit)[0];
    const fastMover = [...soldProducts].sort((x,y) => y._sold-x._sold)[0];
    const lowMargin = soldProducts.filter(p => p._profitPerUnit <= 0 || (num(p.salePrice) > 0 && (num(p.salePrice)-num(p.purchasePrice))/num(p.salePrice) < 0.1));
    const lossProducts = a.products.filter(p => num(p.salePrice) > 0 && num(p.purchasePrice) > num(p.salePrice));
    const totalProductSales = a.products.reduce((s,p) => s + Math.max(0,p._sales), 0);
    const topRevenue = [...a.products].sort((x,y) => y._sales-x._sales)[0];
    const revenueShare = topRevenue && totalProductSales > 0 ? topRevenue._sales / totalProductSales : 0;
    const coverageRisk = a.products.filter(p => p._sold > 0 && p._qty > 0 && (p._qty / Math.max(0.01, p._sold / Math.max(1,a.historyDays))) < 7).sort((x,y) => x._qty/Math.max(0.01,x._sold/Math.max(1,a.historyDays))-y._qty/Math.max(0.01,y._sold/Math.max(1,a.historyDays)));
    if (low.length) recs.push({kind:'warn',icon:'!',title:`${money(low.length)} کالا با موجودی کم`,body:`${low.slice(0,4).map(p=>`${p.name} (${money(p._qty)} عدد)`).join('، ')}. موجودی و زمان تأمین را پیش از تمام‌شدن کالا بررسی کن.`});
    if (coverageRisk.length) recs.push({kind:'warn',icon:'⌛',title:'احتمال اتمام موجودی در کمتر از ۷ روز',body:`با میانگین فروش ثبت‌شده، موجودی ${coverageRisk.slice(0,4).map(p=>p.name).join('، ')} ممکن است کمتر از یک هفته دوام بیاورد. این برآورد به کامل‌بودن سابقه فروش وابسته است.`});
    if (lossProducts.length) recs.push({kind:'danger',icon:'−',title:'قیمت فروش کمتر از قیمت خرید',body:`${lossProducts.slice(0,4).map(p=>p.name).join('، ')} در قیمت‌های فعلی زیان‌ده است. قیمت‌ها و تخفیف‌های ثبت‌شده را بررسی کن.`});
    if (lowMargin.length) recs.push({kind:'warn',icon:'٪',title:'حاشیه سود پایین یا منفی',body:`${lowMargin.slice(0,4).map(p=>p.name).join('، ')} حاشیه سود کمتر از ۱۰٪ یا سود واحد غیرمثبت دارند. هزینه‌ها، قیمت خرید و قیمت فروش را بازبینی کن.`});
    if (noSales.length) recs.push({kind:'warn',icon:'◷',title:`${money(noSales.length)} کالای دارای موجودی بدون فروش`,body:`${noSales.slice(0,5).map(p=>`${p.name} (${money(p._qty)} عدد)`).join('، ')} در فاکتورهای فعلی فروش ثبت‌شده ندارند. اگر بازهٔ دیتابیس کوتاه است، این مورد را نشانه قطعی نبود تقاضا ندان.`});
    if (highStockSlow.length) recs.push({kind:'warn',icon:'↓',title:'احتمال خواب سرمایه در انبار',body:`موجودی ${highStockSlow.slice(0,4).map(p=>p.name).join('، ')} نسبت به فروش ثبت‌شده زیاد است. خرید مجدد را تا بررسی گردش کالا محدود کن.`});
    if (highProfit) recs.push({kind:'good',icon:'↗',title:`بیشترین سود ناخالص: ${highProfit.name}`,body:`سود محاسبه‌شده از اقلام فاکتورها ${money(highProfit._profit)} است. موجودی و روند فروش این کالا را پیگیری کن.`});
    if (fastMover) recs.push({kind:'good',icon:'⚡',title:`بیشترین تعداد فروش: ${fastMover.name}`,body:`در فاکتورهای موجود ${money(fastMover._sold)} عدد ثبت شده است. برای جلوگیری از کمبود، موجودی آن را مرتب کنترل کن.`});
    if (revenueShare > 0.35 && topRevenue) recs.push({kind:'',icon:'◉',title:'وابستگی فروش به یک کالا',body:`حدود ${money(revenueShare*100)}٪ از فروش محاسبه‌شده مربوط به «${topRevenue.name}» است. تنوع کالاهای پرفروش می‌تواند ریسک وابستگی را کاهش دهد.`});
    if (recentInvoices.length && previousInvoices.length) {
      const change = previousSales ? (recentSales-previousSales)/previousSales*100 : null;
      if (change !== null && change <= -15) recs.push({kind:'warn',icon:'↘',title:'افت فروش در مقایسه با ۳۰ روز قبل',body:`فروش ۳۰ روز اخیر ${money(recentSales)} و دورهٔ ۳۰ روز قبل ${money(previousSales)} بوده؛ تغییر حدود ${money(Math.abs(change))}٪ کاهش است. فصل، تعطیلات و کامل‌بودن فاکتورها را هم بررسی کن.`});
      else if (change !== null && change >= 15) recs.push({kind:'good',icon:'↗',title:'رشد فروش در ۳۰ روز اخیر',body:`فروش از ${money(previousSales)} به ${money(recentSales)} رسیده و حدود ${money(change)}٪ رشد داشته است. بررسی کن کدام کالاها بیشترین سهم را در این رشد داشته‌اند.`});
    }
    if (!a.validInvoices.length) recs.push({kind:'',icon:'i',title:'فاکتور کافی برای تحلیل وجود ندارد',body:'پس از ثبت فاکتورهای فروش، پیشنهادهای مربوط به سود، سرعت فروش و روند تقاضا دقیق‌تر می‌شوند.'});
    if (!recs.length) recs.push({kind:'good',icon:'✓',title:'هشدار مهمی شناسایی نشد',body:'با داده‌های فعلی هشدار مشخصی پیدا نشد. نتیجه‌ها به کامل‌بودن فاکتورها و قیمت‌های ثبت‌شده وابسته‌اند.'});
    if (a.historyDays < 60) recs.push({kind:'',icon:'i',title:'محدودیت سابقهٔ داده‌ها',body:`بازهٔ فروش ثبت‌شده حدود ${money(a.historyDays)} روز است. مقایسه‌های دوره‌ای با سابقهٔ طولانی‌تر قابل‌اتکاتر می‌شوند.`});
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
  function invoiceDate(inv) { return dateOf(inv && inv.createdAt); }
  const persianPartsFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {year:'numeric',month:'numeric',day:'numeric'});
  function getPersianParts(date) {
    const parts = Object.fromEntries(persianPartsFormatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
    return {year:parts.year, month:parts.month, day:parts.day};
  }
  function persianMonthName(date) { return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {month:'long'}).format(date); }
  function persianYear(date) { return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {year:'numeric'}).format(date); }
  function persianYearNumber(date) { return getPersianParts(date).year; }
  function persianMonthDates(year, month) {
    const startScan = new Date(year + 621, 2, 15);
    const endScan = new Date(year + 622, 3, 10);
    const found = [];
    for (let d = new Date(startScan); d <= endScan; d.setDate(d.getDate()+1)) {
      const p = getPersianParts(d);
      if (p.year === year && p.month === month) found.push(new Date(d.getFullYear(),d.getMonth(),d.getDate()));
    }
    return found;
  }
  function persianDayKey(date) { const p=getPersianParts(date); return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`; }
  function invoiceSalesInRange(invoices, start, end) {
    return invoices.reduce((sum, inv) => { const d = invoiceDate(inv); return d && d >= start && d < end ? sum + num(inv.total) : sum; }, 0);
  }
  function drawBars(values) {
    const max = Math.max(1, ...values.map(v => v.sales));
    return `<div class="trend-bars">${values.map(v => `<div class="trend-bar-wrap"><div class="trend-bar" title="${esc(v.label)}: ${money(v.sales)}" style="height:${Math.max(v.sales ? 4 : 1, v.sales/max*78)}%"></div><span class="trend-label">${esc(v.shortLabel || v.label)}</span></div>`).join('')}</div>`;
  }
  function drawDataGrid(values) { return `<div class="trend-data-grid">${values.map(v=>`<div class="trend-data-item"><span>${esc(v.label)}</span><strong>${money(v.sales)}</strong></div>`).join('')}</div>`;
  }
  function initTrendControls(a) {
    const dates = a.validInvoices.map(invoiceDate).filter(Boolean);
    const years = [...new Set(dates.map(persianYearNumber))].sort((x,y)=>y-x);
    const yearSelect = $('trendYear'), monthSelect = $('trendMonth');
    const oldYear = yearSelect.value, oldMonth = monthSelect.value;
    yearSelect.innerHTML = years.map(y => `<option value="${y}">${new Intl.NumberFormat('fa-IR').format(y)}</option>`).join('');
    const defaultYear = years.includes(Number(oldYear)) ? Number(oldYear) : (years[0] || persianYearNumber(new Date()));
    yearSelect.value = String(defaultYear);
    monthSelect.innerHTML = Array.from({length:12},(_,i)=>{
      const month=i+1, days=persianMonthDates(defaultYear,month), sample=days[0] || new Date(defaultYear+621,2,21);
      return `<option value="${month}">${esc(persianMonthName(sample))}</option>`;
    }).join('');
    monthSelect.value = String(Number(oldMonth)>=1 && Number(oldMonth)<=12 ? Number(oldMonth) : (dates.length ? getPersianParts(dates.reduce((latest,d)=>d>latest?d:latest,dates[0])).month : 1));
    $('trendMonthLabel').hidden = $('trendMode').value === 'annual';
  }
  function renderTrend(a) {
    const panel = $('trendPanel');
    const dates = a.validInvoices.map(invoiceDate).filter(Boolean);
    if (!dates.length) {
      panel.innerHTML = '<div class="trend-empty">فاکتور تاریخ‌دار برای رسم نمودار پیدا نشد.</div>';
      $('trendSummary').textContent = 'برای نمایش عدد فروش، ابتدا فاکتورهای دارای تاریخ را به پوشه اضافه کن.';
      $('weekdayPanel').innerHTML = '<div class="trend-empty">فاکتور تاریخ‌دار کافی نیست.</div>';
      $('trendYear').innerHTML = ''; $('trendMonth').innerHTML = ''; return;
    }
    initTrendControls(a);
    const mode = $('trendMode').value;
    const year = Number($('trendYear').value);
    let values = [], total = 0, title = '';
    const salesByPersianDay = new Map();
    for (const inv of a.validInvoices) {
      const d=invoiceDate(inv); if (!d) continue;
      const key=persianDayKey(d);
      salesByPersianDay.set(key,(salesByPersianDay.get(key)||0)+num(inv.total));
    }
    if (mode === 'annual') {
      for (let m=1;m<=12;m++) {
        const monthDates=persianMonthDates(year,m);
        const sales=monthDates.reduce((sum,d)=>sum+(salesByPersianDay.get(persianDayKey(d))||0),0);
        const sample=monthDates[0] || new Date(year+621,2,21);
        total += sales;
        const label=persianMonthName(sample);
        values.push({label,shortLabel:label.slice(0,3),sales});
      }
      title = `مجموع فروش سال ${new Intl.NumberFormat('fa-IR').format(year)}`;
      panel.innerHTML = drawBars(values) + drawDataGrid(values) + '<p class="trend-caption">هر ستون مجموع فروش یک ماه شمسی را نشان می‌دهد؛ ماه‌های بدون فاکتور با مقدار صفر نمایش داده می‌شوند.</p>';
    } else {
      const month = Number($('trendMonth').value);
      const monthDates=persianMonthDates(year,month);
      if (!monthDates.length) {
        panel.innerHTML = '<div class="trend-empty">تقویم این ماه در مرورگر قابل محاسبه نیست.</div>';
        $('trendSummary').textContent = 'ماه دیگری را انتخاب کن.';
      } else {
        for (const d of monthDates) {
          const key=persianDayKey(d), sales=salesByPersianDay.get(key)||0;
          total += sales;
          values.push({label:`${new Intl.NumberFormat('fa-IR').format(getPersianParts(d).day)} ${persianMonthName(d)}`,shortLabel:new Intl.NumberFormat('fa-IR').format(getPersianParts(d).day),sales});
        }
        const sample=monthDates[0];
        title = `مجموع فروش ${persianMonthName(sample)} ${new Intl.NumberFormat('fa-IR').format(year)}`;
        panel.innerHTML = drawBars(values) + drawDataGrid(values) + '<p class="trend-caption">نمودار و فهرست بالا مبلغ فروش ثبت‌شده برای تک‌تک روزهای ماه شمسی را نشان می‌دهند.</p>';
      }
    }
    if (values.length) $('trendSummary').innerHTML = `<strong>${esc(title)}</strong><span>فروش کل این بازه: <b>${money(total)}</b></span>`;
    const weekdays = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
    const weekTotals = weekdays.map((label,day)=>({label,shortLabel:label,sales:0}));
    for (const inv of a.validInvoices) { const d=invoiceDate(inv); if (d) weekTotals[d.getDay()].sales += num(inv.total); }
    const bestDay = [...weekTotals].sort((x,y)=>y.sales-x.sales)[0];
    $('weekdayPanel').innerHTML = drawBars(weekTotals) + drawDataGrid(weekTotals) + `<p class="trend-caption">بر اساس تمام فاکتورهای تاریخ‌دار موجود در پوشه. بیشترین فروش در روز <strong>${bestDay.label}</strong> ثبت شده است (${money(bestDay.sales)}).</p>`;
  }
  $('connectBtn').addEventListener('click', connectFolder);
  $('refreshBtn').addEventListener('click', refreshData);
  $('trendMode').addEventListener('change', () => { $('trendMonthLabel').hidden = $('trendMode').value === 'annual'; if (state.invoices.length) renderTrend(getAnalytics()); });
  $('trendYear').addEventListener('change', () => { if (state.invoices.length) renderTrend(getAnalytics()); });
  $('trendMonth').addEventListener('change', () => { if (state.invoices.length) renderTrend(getAnalytics()); });
  $('folderInput').addEventListener('change', async (event) => {
    const files = event.target.files; if (!files || !files.length) return;
    try { setStatus('در حال خواندن فایل‌های انتخاب‌شده…'); const data = await readFromInputFiles(files); state.directoryHandle = null; $('refreshBtn').disabled = true; applyData(data); setStatus('فایل‌ها خوانده شدند. برای تازه‌سازی در این مرورگر، دوباره پوشه را انتخاب کن.', 'success'); }
    catch (err) { setStatus(err.message || 'خواندن فایل‌ها ناموفق بود.', 'error'); }
    event.target.value = '';
  });
})();
