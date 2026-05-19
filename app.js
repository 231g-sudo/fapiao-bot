// ============================================================
// FapiaoBot — 电子发票提取工具 (纯浏览器端)
// 基于坐标位置的 PDF/OFD 解析引擎
// ============================================================

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const CONFIG = {
  FREE_LIMIT: 3,
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  SUPPORTED_TYPES: ['.pdf', '.ofd'],
  STORAGE_KEY_PREFIX: 'fapiao_bot_usage_',
  XIANYU_URL: 'https://m.tb.cn/h.xxxxx',
};

const FIELD_META = [
  { key: 'invoiceNo',    label: '发票号码',     width: '150px' },
  { key: 'invoiceCode',  label: '发票代码',     width: '140px' },
  { key: 'date',         label: '开票日期',     width: '130px' },
  { key: 'buyerName',    label: '购买方名称',   width: '140px' },
  { key: 'buyerTaxId',   label: '购买方税号',   width: '160px' },
  { key: 'sellerName',   label: '销售方名称',   width: '140px' },
  { key: 'sellerTaxId',  label: '销售方税号',   width: '160px' },
  { key: 'items',        label: '商品信息',     width: '220px' },
  { key: 'amount',       label: '金额',         width: '110px' },
  { key: 'tax',          label: '税额',         width: '110px' },
  { key: 'total',        label: '价税合计',     width: '110px' },
];

const NUMERIC_FIELDS = new Set(['amount', 'tax', 'total']);
const WRAP_FIELDS = new Set(['items']);

// === 激活码验证系统（函数名/逻辑已混淆，防 F12 篡改）===
function _s(i) {
  for (var _ = 0, h = 0; _ < i.length; _++) { h = ((h << 5) - h) + i.charCodeAt(_); h |= 0; }
  var a = Math.abs(h) + '', c = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', r = '';
  for (var _ = 0; _ < 5; _++) { var d = (parseInt(a[_] || '0', 10) + _ * 7 + h) % 36; r = c[(d + 36) % 36] + r; a += h % (_ + 1); }
  return r;
}
function _v(c) {
  if (typeof c != 'string' || !/^FP-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c)) return false;
  var p = c.split('-');
  return p[2] === _s(p[1]);
}
function _checkActivation() {
  try {
    var fp = localStorage.getItem('_fp_act') || '';
    var st = localStorage.getItem('_fp_st') || '';
    if (fp && st && st === _s(fp)) return true;
  } catch(e) {}
  try {
    var q = new URLSearchParams(window.location.search);
    var c = q.get('c');
    if (c && _v(c)) {
      var fp = '';
      try { fp = localStorage.getItem('fapiao_bot_usage_fp') || ''; } catch(e) {}
      if (!fp) { fp = '_fp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
      localStorage.setItem('_fp_act', fp);
      localStorage.setItem('_fp_st', _s(fp));
      return true;
    }
  } catch(e) {}
  return false;
}

const state = { invoices: [], fingerprint: null, isPro: false };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const els = {};

function cacheElements() {
  els.uploadZone    = $('#uploadZone');
  els.fileInput     = $('#fileInput');
  els.tableWrapper  = $('#tableWrapper');
  els.tableHead     = $('#invoiceTable thead tr');
  els.tableBody     = $('#invoiceTable tbody');
  els.exportBtn     = $('#exportBtn');
  els.clearBtn      = $('#clearBtn');
  els.status        = $('#status');
  els.totalRow      = $('#totalRow');
  els.usageCount    = $('#usageCount');
  els.upgradeBtn    = $('#upgradeBtn');
  els.upgradeModal  = $('#upgradeModal');
  els.closeModal    = $('#closeModal');
  els.goUpgrade     = $('#goUpgrade');
  els.loadingOverlay = $('#loadingOverlay');
  els.loadingText   = $('#loadingText');
}

document.addEventListener('DOMContentLoaded', async () => {
  state.isPro = window.PRO_MODE === true || _checkActivation();
  cacheElements();
  setupEventListeners();
  buildTableHeader();
  await initTracker();
  updateUsageDisplay();
  if (state.isPro) document.body.classList.add('is-pro');
});

function setupEventListeners() {
  els.uploadZone.addEventListener('click', () => els.fileInput.click());
  els.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); els.uploadZone.classList.add('dragover'); });
  els.uploadZone.addEventListener('dragleave', () => els.uploadZone.classList.remove('dragover'));
  els.uploadZone.addEventListener('drop', (e) => { e.preventDefault(); els.uploadZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  els.fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  els.exportBtn.addEventListener('click', exportExcel);
  els.clearBtn.addEventListener('click', clearAll);
  els.upgradeBtn?.addEventListener('click', () => els.upgradeModal?.classList.add('show'));
  els.closeModal?.addEventListener('click', () => els.upgradeModal?.classList.remove('show'));
  els.goUpgrade?.addEventListener('click', () => window.open(CONFIG.XIANYU_URL, '_blank'));
  els.upgradeModal?.addEventListener('click', (e) => { if (e.target === els.upgradeModal) els.upgradeModal.classList.remove('show'); });
  els.activateBtn = $('#activateBtn');
  els.activationInput = $('#activationInput');
  els.activationMsg = $('#activationMsg');
  els.activateBtn?.addEventListener('click', handleActivation);
  els.activationInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleActivation(); });
  els.activationInput?.addEventListener('input', () => {
    els.activationMsg.style.display = 'none';
    els.activationInput.value = els.activationInput.value.toUpperCase();
  });
}

// ============================================================
// 文件处理
// ============================================================
async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f =>
    CONFIG.SUPPORTED_TYPES.some(ext => f.name.toLowerCase().endsWith(ext))
  );
  if (files.length === 0) { showStatus('请上传 PDF 或 OFD 格式的发票文件', 'error'); return; }
  const oversized = files.find(f => f.size > CONFIG.MAX_FILE_SIZE);
  if (oversized) { showStatus(`文件过大（超过 10MB）：${oversized.name}`, 'error'); return; }

  if (!state.isPro) {
    const currentUsage = await getUsageCount();
    const remaining = CONFIG.FREE_LIMIT - currentUsage;
    if (remaining <= 0) { showStatus('免费额度已用尽（3/3 张）。请购买完整版以继续使用。', 'error'); showUpgradeModal(); return; }
    if (files.length > remaining) { showStatus(`免费额度仅剩 ${remaining} 张，本次只处理前 ${remaining} 张。`, 'warn'); files.splice(remaining); }
  }

  showLoading(true);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    updateLoadingText(`正在解析 (${i + 1}/${files.length}): ${file.name}`);
    try {
      const parseResult = await parseFile(file);
      const extracted = extractFields(parseResult);
      state.invoices.push({
        id: Date.now() + '_' + i,
        fileName: file.name,
        ...extracted.fields,
        missingCount: extracted.missingCount,
      });
      if (!state.isPro) await incrementUsage();
    } catch (err) {
      showStatus(`解析失败: ${file.name} — ${err.message}`, 'error');
    }
  }
  showLoading(false);
  renderTable();
  updateTotals();
  updateUsageDisplay();
  if (state.invoices.length > 0) showStatus(`成功解析 ${state.invoices.length} 张发票，请核对后导出 Excel`, 'success');
}

async function parseFile(file) {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (ext === '.pdf') return await parsePDF(file);
  if (ext === '.ofd') return await parseOFD(file);
  throw new Error('不支持的文件格式');
}

// ============================================================
// PDF 解析（基于坐标位置）
// ============================================================
async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let allItems = [];
  let rawText = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const pageH = viewport.height;
    const content = await page.getTextContent();

    rawText += content.items.map(item => item.str).join(' ') + '\n';

    const offsetY = (p - 1) * 2000;
    for (const item of content.items) {
      const t = item.str;
      if (!t.trim()) continue;
      allItems.push({
        text: t,
        x: Math.round(item.transform[4]),
        y: Math.round(pageH - item.transform[5]) + offsetY,
        page: p,
      });
    }
  }

  const lines = groupIntoLines(allItems);
  const cleaned = normalizeText(rawText);

  return { text: cleaned, lines };
}

function groupIntoLines(items, tolerance = 4) {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  let cur = [], curY = null;

  for (const item of items) {
    if (curY === null || Math.abs(item.y - curY) <= tolerance) {
      cur.push(item);
      if (curY === null) curY = item.y;
    } else {
      if (cur.length > 0) {
        cur.sort((a, b) => a.x - b.x);
        lines.push({ y: curY, items: [...cur], text: cur.map(i => i.text).join('') });
      }
      cur = [item];
      curY = item.y;
    }
  }
  if (cur.length > 0) {
    cur.sort((a, b) => a.x - b.x);
    lines.push({ y: curY, items: [...cur], text: cur.map(i => i.text).join('') });
  }
  return lines;
}

function normalizeText(text) {
  let t = text;
  t = t.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1');
  t = t.replace(/([\u4e00-\u9fff])\s+(?=\d)/g, '$1');
  t = t.replace(/(\d)\s+(?=[\u4e00-\u9fff])/g, '$1');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ============================================================
// OFD 解析
// ============================================================
async function parseOFD(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const contentPaths = Object.keys(zip.files).filter(name => name.endsWith('Content.xml'));
  if (contentPaths.length === 0) throw new Error('OFD 文件中未找到内容数据');

  let fullText = '';
  for (const path of contentPaths) {
    const xmlStr = await zip.files[path].async('text');
    const xml = new DOMParser().parseFromString(xmlStr, 'text/xml');
    xml.querySelectorAll('TextCode').forEach(el => { fullText += el.textContent + '\n'; });
  }
  const cleaned = normalizeText(fullText);
  if (!cleaned) throw new Error('OFD 文件中未提取到文字内容');
  return { text: cleaned, lines: [] };
}

// ============================================================
// 字段提取
// ============================================================
function extractFields(parseResult) {
  const { text, lines } = parseResult;

  // 方法一：基于坐标位置提取（PDF 用）
  if (lines && lines.length > 0) {
    const posFields = extractPositionBased(lines);
    const posCount = Object.values(posFields).filter(Boolean).length;
    if (posCount >= 4) {
      // 如果还有缺失字段，尝试用正则补充
      const regexFields = extractFieldsRegex(text);
      for (const k of FIELD_META.map(m => m.key)) {
        if (!posFields[k] && regexFields[k]) posFields[k] = regexFields[k];
      }
      const filledCount = Object.values(posFields).filter(Boolean).length;
      return { fields: posFields, missingCount: FIELD_META.length - filledCount };
    }
  }

  // 方法二：正则提取（OFD 或简单 PDF）
  return extractFieldsRegex(text);
}

function extractPositionBased(lines) {
  const fields = {};
  let nameSeen = 0, taxSeen = 0;
  var inTable = false;
  var itemRows = [];

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var items = line.items;
    var lineStr = line.text;

    if (lineStr.includes('发票号码：') || lineStr.includes('发票号码:')) {
      var m = lineStr.match(/(\d{8,20})/);
      if (m) fields.invoiceNo = m[1];
    }
    if (lineStr.includes('发票代码：') || lineStr.includes('发票代码:')) {
      var m = lineStr.match(/(\d{10,12})/);
      if (m) fields.invoiceCode = m[1];
    }
    if (lineStr.includes('开票日期：') || lineStr.includes('开票日期:')) {
      var m = lineStr.match(/(\d{4}[年\-\.\/]\d{1,2}[月\-\.\/]\d{1,2}[日]?)/);
      if (m) fields.date = m[1];
    }

    for (var i = 0; i < items.length - 1; i++) {
      var cur = items[i].text;
      var nxt = items[i + 1].text;
      if (!nxt.trim()) continue;

      if (/^名称[：:]/.test(cur) || cur === '名称：' || cur === '名称:') {
        nameSeen++;
        if (nameSeen === 1) fields.buyerName = nxt.trim();
        else if (nameSeen === 2 && !fields.sellerName) fields.sellerName = nxt.trim();
      }
      if (/纳税人识别号/.test(cur) || /统一社会信用代码/.test(cur)) {
        taxSeen++;
        var m2 = nxt.match(/[A-Za-z0-9]{15,20}/);
        if (m2) {
          if (taxSeen === 1) fields.buyerTaxId = m2[0];
          else if (taxSeen === 2 && !fields.sellerTaxId) fields.sellerTaxId = m2[0];
        }
      }
    }

    // 检测表格区域
    if (/项目名称/.test(lineStr) || /规格型号/.test(lineStr)) {
      inTable = true;
      continue;
    }
    if (inTable && /合\s*计/.test(lineStr) && !/小\s*计/.test(lineStr)) {
      inTable = false;
      var amounts = lineStr.match(/¥?\s*([\d,]+\.\d{2})/g);
      if (amounts && amounts.length >= 2) {
        fields.amount = amounts[0].replace(/,/g, '').trim();
        fields.tax = amounts[1].replace(/,/g, '').trim();
      }
      continue;
    }
    if (inTable && /小\s*计/.test(lineStr)) {
      inTable = false;
      continue;
    }

    // 提取表格内的商品行（基于 X 坐标定位列）
    if (inTable) {
      // 判断是否为商品数据行：至少 4 个 item，且包含数字类数据
      var numCount = 0;
      for (var _i = 0; _i < items.length; _i++) { if (/[\d]/.test(items[_i].text)) numCount++; }
      if (numCount >= 3) {
        var nameParts = [], qty = '';
        for (var _i = 0; _i < items.length; _i++) {
          var _it = items[_i];
          var _x = _it.x, _t = _it.text;
          // 商品名称：X < 200 且不是纯数字/标点
          if (_x < 200 && !/^[\d,.%¥\+\-]+$/.test(_t)) {
            nameParts.push(_t);
          }
          // 数量：X 在 250-350 之间且为纯数字（1-999）
          if (_x >= 250 && _x <= 350 && /^\d{1,3}$/.test(_t)) {
            qty = _t;
          }
        }
        var name = nameParts.join('').replace(/\*+/g, ' ').trim();
        if (name && qty && name.length > 1) {
          itemRows.push(name + '×' + qty);
        }
      }
    }

    if (/合\s*计/.test(lineStr) && !/小\s*计/.test(lineStr)) {
      var amounts = [...lineStr.matchAll(/¥?\s*([\d,]+\.\d{2})/g)];
      if (amounts.length >= 2) {
        fields.amount = amounts[0][1].replace(/,/g, '');
        fields.tax = amounts[1][1].replace(/,/g, '');
      }
    }

    if (/价税合计/.test(lineStr) || (lineStr.includes('小写') && lineStr.includes('¥'))) {
      var amounts = [...lineStr.matchAll(/¥?\s*([\d,]+\.\d{2})/g)];
      if (amounts.length >= 1 && !fields.total) {
        fields.total = amounts[amounts.length - 1][1].replace(/,/g, '');
      }
    }
  }

  // 合并相同商品
  if (itemRows.length > 0) {
    var merged = {};
    for (var r = 0; r < itemRows.length; r++) {
      var parts = itemRows[r].split('×');
      var n = parts[0];
      var q = parseInt(parts[1]) || 1;
      if (merged[n]) merged[n] += q;
      else merged[n] = q;
    }
    var summary = [];
    for (var n in merged) {
      summary.push(n + '×' + merged[n]);
    }
    fields.items = summary.join('；');
  }

  return fields;
}

const PATTERNS = [
  { field: 'invoiceNo',   pattern: /发票号码[：:]\s*(\d{8,20})/ },
  { field: 'invoiceCode', pattern: /发票代码[：:]\s*(\d{10,12})/ },
  { field: 'date',        pattern: /开票日期[：:]\s*(\d{4}[年\-\.\/]\d{1,2}[月\-\.\/]\d{1,2}[日]?)/ },
  { field: 'buyerName',   pattern: /购买方[名称]?[：:]\s*([^\n\r]{2,30})/ },
  { field: 'buyerTaxId',  pattern: /购买方纳税人识别号[：:]\s*([A-Za-z0-9]{15,20})/ },
  { field: 'sellerName',  pattern: /销售方[名称]?[：:]\s*([^\n\r]{2,30})/ },
  { field: 'sellerTaxId', pattern: /销售方纳税人识别号[：:]\s*([A-Za-z0-9]{15,20})/ },
  { field: 'amount',      pattern: /金额[^\d]*((?:[\d,]+\.\d{2}))/ },
  { field: 'tax',         pattern: /税额[：:]?\s*((?:[\d,]+\.\d{2}))/ },
  { field: 'total',       pattern: /价税合计[^0-9]*?(?:小写|小写[）\)])[^0-9]*((?:[\d,]+\.\d{2}))/ },
];

const FALLBACK_PATTERNS = [
  { field: 'total', pattern: /价税合计[^0-9]*((?:[\d,]+\.\d{2}))/ },
  { field: 'total', pattern: /合计[（(]小写[)）][^0-9]*((?:[\d,]+\.\d{2}))/ },
  { field: 'total', pattern: /[（(]小写[)）][^0-9]*((?:[\d,]+\.\d{2}))/ },
];

function extractFieldsRegex(text) {
  const fields = {};
  let matchedCount = 0;
  for (const { field, pattern } of PATTERNS) {
    const m = text.match(pattern);
    if (m) { fields[field] = m[1].replace(/,/g, '').trim(); matchedCount++; }
  }
  if (!fields.total) {
    for (const { field, pattern } of FALLBACK_PATTERNS) {
      const m = text.match(pattern);
      if (m && !fields[field]) { fields[field] = m[1].replace(/,/g, '').trim(); matchedCount++; break; }
    }
  }
  return { fields, missingCount: FIELD_META.length - matchedCount };
}

// ============================================================
// 表格
// ============================================================
function buildTableHeader() {
  let html = '<th style="width:32px">#</th>';
  FIELD_META.forEach(m => { html += `<th style="width:${m.width}">${m.label}</th>`; });
  html += '<th style="width:80px">操作</th>';
  els.tableHead.innerHTML = html;
}

function renderTable() {
  if (state.invoices.length === 0) {
    els.tableWrapper.classList.add('empty');
    els.tableBody.innerHTML = '';
    els.exportBtn.disabled = true;
    els.clearBtn.disabled = true;
    els.totalRow.style.display = 'none';
    return;
  }
  els.tableWrapper.classList.remove('empty');
  els.exportBtn.disabled = false;
  els.clearBtn.disabled = false;
  els.totalRow.style.display = '';

  let html = '';
  state.invoices.forEach((inv, idx) => {
    const hasMissing = inv.missingCount > 0;
    html += `<tr data-index="${idx}" class="${hasMissing ? 'has-missing' : ''}">`;
    html += `<td class="row-num">${idx + 1}</td>`;
    FIELD_META.forEach(m => {
      const val = inv[m.key] || '';
      const isNum = NUMERIC_FIELDS.has(m.key);
    const wrap = m.key === 'items';
      html += `<td contenteditable="true" data-field="${m.key}" class="${isNum ? 'num-cell' : ''} ${wrap ? 'wrap-cell' : ''} ${!val ? 'empty-cell' : ''}" data-index="${idx}">${val}</td>`;
    });
    html += `<td><button class="btn-icon delete-row" data-index="${idx}" title="删除">✕</button></td></tr>`;
  });
  els.tableBody.innerHTML = html;

  els.tableBody.querySelectorAll('td[contenteditable]').forEach(td => {
    td.addEventListener('blur', onCellEdit);
    td.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } });
  });
  els.tableBody.querySelectorAll('.delete-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      state.invoices.splice(idx, 1);
      renderTable();
      updateTotals();
    });
  });
}

function onCellEdit(e) {
  const td = e.target;
  const idx = parseInt(td.dataset.index);
  const field = td.dataset.field;
  const val = td.textContent.trim();
  state.invoices[idx][field] = val;
  if (!val) td.classList.add('empty-cell');
  else td.classList.remove('empty-cell');
  updateTotals();
}

function updateTotals() {
  const sums = { amount: 0, tax: 0, total: 0 };
  state.invoices.forEach(inv => {
    NUMERIC_FIELDS.forEach(f => { const v = parseFloat(inv[f]); if (!isNaN(v)) sums[f] += v; });
  });
  els.totalRow.querySelectorAll('[data-total]').forEach(el => {
    const field = el.dataset.total;
    el.textContent = sums[field] ? sums[field].toFixed(2) : '0.00';
  });
}

// ============================================================
// Excel 导出
// ============================================================
function exportExcel() {
  if (state.invoices.length === 0) { showStatus('没有数据可导出', 'warn'); return; }
  const headers = FIELD_META.map(m => m.label);
  const data = state.invoices.map(inv => FIELD_META.map(m => {
    const val = inv[m.key] || '';
    if (NUMERIC_FIELDS.has(m.key) && val) { const n = parseFloat(val); return isNaN(n) ? val : n; }
    return val;
  }));
  const sums = { amount: 0, tax: 0, total: 0 };
  state.invoices.forEach(inv => { NUMERIC_FIELDS.forEach(f => { const v = parseFloat(inv[f]); if (!isNaN(v)) sums[f] += v; }); });
  const totalRow = FIELD_META.map(m => {
    if (m.key === 'invoiceNo') return '合计';
    if (NUMERIC_FIELDS.has(m.key)) { const v = sums[m.key]; return v ? Math.round(v * 100) / 100 : 0; }
    return '';
  });
  const wsData = [headers, ...data, totalRow];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = FIELD_META.map(m => ({ wch: Math.max(m.label.length * 2, 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '发票清单');
  XLSX.writeFile(wb, `发票提取_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showStatus('导出成功', 'success');
}

// ============================================================
// 使用追踪
// ============================================================
async function initTracker() {
  if (state.isPro) return;
  try {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    state.fingerprint = result.visitorId;
  } catch {
    state.fingerprint = 'fp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
}
function getUsageKey() { return CONFIG.STORAGE_KEY_PREFIX + (state.fingerprint || 'unknown'); }
async function getUsageCount() { if (state.isPro) return 0; return parseInt(localStorage.getItem(getUsageKey())) || 0; }
async function incrementUsage() { if (state.isPro) return; const key = getUsageKey(); localStorage.setItem(key, (parseInt(localStorage.getItem(key)) || 0) + 1); }
function updateUsageDisplay() {
  if (!els.usageCount) return;
  if (state.isPro) { els.usageCount.textContent = '完整版 · 无限使用'; els.usageCount.className = 'pro-badge'; if (els.upgradeBtn) els.upgradeBtn.style.display = 'none'; return; }
  const key = getUsageKey();
  const val = parseInt(localStorage.getItem(key)) || 0;
  const remaining = Math.max(0, CONFIG.FREE_LIMIT - val);
  els.usageCount.textContent = `免费版 · 剩余 ${remaining}/${CONFIG.FREE_LIMIT} 张`;
  els.usageCount.className = remaining > 0 ? '' : 'exhausted';
}

// ============================================================
// UI 辅助
// ============================================================
function showStatus(msg, type) {
  els.status.textContent = msg;
  els.status.className = 'status ' + (type || 'info');
  els.status.style.display = 'block';
  clearTimeout(els.status._timer);
  if (type !== 'error') els.status._timer = setTimeout(() => { els.status.style.display = 'none'; }, 5000);
}
function showLoading(show) { els.loadingOverlay.classList.toggle('show', show); }
function updateLoadingText(text) { els.loadingText.textContent = text; }
function clearAll() { if (state.invoices.length === 0) return; if (!confirm('确认清空所有数据？')) return; state.invoices = []; renderTable(); updateTotals(); }
function showUpgradeModal() { els.upgradeModal?.classList.add('show'); }

function handleActivation() {
  var inp = els.activationInput;
  var msg = els.activationMsg;
  if (!inp || !msg) return;
  var code = inp.value.trim().toUpperCase();
  if (!code) { msg.textContent = '请输入激活码'; msg.style.color = '#dc2626'; msg.style.display = 'block'; return; }
  if (_v(code)) {
    try {
      var fp = localStorage.getItem('fapiao_bot_usage_fp') || '';
      if (!fp) { fp = '_fp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
      localStorage.setItem('_fp_act', fp);
      localStorage.setItem('_fp_st', _s(fp));
    } catch(e) {}
    state.isPro = true;
    document.body.classList.add('is-pro');
    updateUsageDisplay();
    msg.textContent = '✅ 激活成功！已解锁全部功能';
    msg.style.color = '#16a34a';
    msg.style.display = 'block';
    inp.value = '';
    setTimeout(function() { els.upgradeModal?.classList.remove('show'); }, 1200);
  } else {
    msg.textContent = '❌ 激活码无效，请检查后重试';
    msg.style.color = '#dc2626';
    msg.style.display = 'block';
  }
}
