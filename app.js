// ============================================================
// FapiaoBot — 电子发票提取工具 (纯浏览器端)
// ============================================================

// === 由 HTML 页面在加载此脚本前设置 ===
// window.PRO_MODE = true  (pro.html 会设置)

// pdf.js worker 路径
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ============================================================
// 配置
// ============================================================
const CONFIG = {
  FREE_LIMIT: 3,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  SUPPORTED_TYPES: ['.pdf', '.ofd'],
  STORAGE_KEY_PREFIX: 'fapiao_bot_usage_',
  XIANYU_URL: 'https://m.tb.cn/h.xxxxx', // TODO: 替换为实际闲鱼链接
};

const FIELD_META = [
  { key: 'invoiceNo',    label: '发票号码',     width: '140px' },
  { key: 'invoiceCode',  label: '发票代码',     width: '140px' },
  { key: 'date',         label: '开票日期',     width: '120px' },
  { key: 'buyerName',    label: '购买方名称',   width: '150px' },
  { key: 'buyerTaxId',   label: '购买方税号',   width: '170px' },
  { key: 'sellerName',   label: '销售方名称',   width: '150px' },
  { key: 'sellerTaxId',  label: '销售方税号',   width: '170px' },
  { key: 'amount',       label: '金额',         width: '110px' },
  { key: 'tax',          label: '税额',         width: '110px' },
  { key: 'total',        label: '价税合计',     width: '110px' },
];

const NUMERIC_FIELDS = new Set(['amount', 'tax', 'total']);

// ============================================================
// 状态
// ============================================================
const state = {
  invoices: [],
  fingerprint: null,
  isPro: false,
};

// ============================================================
// DOM 缓存
// ============================================================
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
  els.usageInfo     = $('#usageInfo');
  els.totalRow      = $('#totalRow');
  els.usageCount    = $('#usageCount');
  els.upgradeBtn    = $('#upgradeBtn');
  els.upgradeModal  = $('#upgradeModal');
  els.closeModal    = $('#closeModal');
  els.goUpgrade     = $('#goUpgrade');
  els.dragHint      = $('#dragHint');
  els.loadingOverlay = $('#loadingOverlay');
  els.loadingText   = $('#loadingText');
}

// ============================================================
// 初始化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  state.isPro = window.PRO_MODE === true;

  cacheElements();
  setupEventListeners();
  buildTableHeader();
  await initTracker();
  updateUsageDisplay();

  if (state.isPro) {
    document.body.classList.add('is-pro');
  }
});

// ============================================================
// 事件绑定
// ============================================================
function setupEventListeners() {
  els.uploadZone.addEventListener('click', () => els.fileInput.click());

  els.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadZone.classList.add('dragover');
  });

  els.uploadZone.addEventListener('dragleave', () => {
    els.uploadZone.classList.remove('dragover');
  });

  els.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  els.fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  els.exportBtn.addEventListener('click', exportExcel);
  els.clearBtn.addEventListener('click', clearAll);

  els.upgradeBtn?.addEventListener('click', () => {
    els.upgradeModal?.classList.add('show');
  });

  els.closeModal?.addEventListener('click', () => {
    els.upgradeModal?.classList.remove('show');
  });

  els.goUpgrade?.addEventListener('click', () => {
    window.open(CONFIG.XIANYU_URL, '_blank');
  });

  els.upgradeModal?.addEventListener('click', (e) => {
    if (e.target === els.upgradeModal) {
      els.upgradeModal.classList.remove('show');
    }
  });
}

// ============================================================
// 文件处理
// ============================================================
async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f =>
    CONFIG.SUPPORTED_TYPES.some(ext => f.name.toLowerCase().endsWith(ext))
  );

  if (files.length === 0) {
    showStatus('请上传 PDF 或 OFD 格式的发票文件', 'error');
    return;
  }

  const oversized = files.find(f => f.size > CONFIG.MAX_FILE_SIZE);
  if (oversized) {
    showStatus(`文件过大（超过 10MB）：${oversized.name}`, 'error');
    return;
  }

  if (!state.isPro) {
    const currentUsage = await getUsageCount();
    const remaining = CONFIG.FREE_LIMIT - currentUsage;
    if (remaining <= 0) {
      showStatus('免费额度已用尽（3/3 张）。请购买完整版以继续使用。', 'error');
      showUpgradeModal();
      return;
    }
    if (files.length > remaining) {
      showStatus(`免费额度仅剩 ${remaining} 张，本次只处理前 ${remaining} 张。`, 'warn');
      files.splice(remaining);
    }
  }

  showLoading(true);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    updateLoadingText(`正在解析 (${i + 1}/${files.length}): ${file.name}`);
    try {
      const text = await parseFile(file);
      const result = extractFields(text);
      state.invoices.push({
        id: Date.now() + '_' + i,
        fileName: file.name,
        ...result.fields,
        missingCount: result.missingCount,
      });

      if (!state.isPro) {
        await incrementUsage();
      }
    } catch (err) {
      showStatus(`解析失败: ${file.name} — ${err.message}`, 'error');
    }
  }

  showLoading(false);
  renderTable();
  updateTotals();
  updateUsageDisplay();

  if (state.invoices.length > 0) {
    showStatus(`成功解析 ${state.invoices.length} 张发票，请核对后导出 Excel`, 'success');
  }
}

async function parseFile(file) {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (ext === '.pdf') return await parsePDF(file);
  if (ext === '.ofd') return await parseOFD(file);
  throw new Error('不支持的文件格式');
}

async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  const cleaned = normalizeText(text);
  if (!cleaned) throw new Error('PDF 中未提取到文字内容');
  return cleaned;
}

async function parseOFD(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const contentPaths = Object.keys(zip.files).filter(name =>
    name.endsWith('Content.xml')
  );
  if (contentPaths.length === 0) {
    throw new Error('OFD 文件中未找到内容数据');
  }

  let fullText = '';
  for (const path of contentPaths) {
    const xmlStr = await zip.files[path].async('text');
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlStr, 'text/xml');
    const textCodes = xml.querySelectorAll('TextCode');
    textCodes.forEach(el => {
      fullText += el.textContent + '\n';
    });
  }

  const cleaned = normalizeText(fullText);
  if (!cleaned) throw new Error('OFD 文件中未提取到文字内容');
  return cleaned;
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
// 字段提取（正则）
// ============================================================
const PATTERNS = [
  { field: 'invoiceNo',   pattern: /发票号码[：:]\s*(\d{8,20})/ },
  { field: 'invoiceCode', pattern: /发票代码[：:]\s*(\d{10,12})/ },
  { field: 'date',        pattern: /开票日期[：:]\s*(\d{4}[年\-\.\/]\d{1,2}[月\-\.\/]\d{1,2}[日]?)/ },
  { field: 'buyerName',   pattern: /(?:购买方名称|购买方)[：:]\s*([^\n\r]{2,30})/ },
  { field: 'buyerTaxId',  pattern: /购买方纳税人识别号[：:]\s*([A-Za-z0-9]{15,20})/ },
  { field: 'sellerName',  pattern: /(?:销售方名称|销售方)[：:]\s*([^\n\r]{2,30})/ },
  { field: 'sellerTaxId', pattern: /销售方纳税人识别号[：:]\s*([A-Za-z0-9]{15,20})/ },
  { field: 'amount',      pattern: /金额[^\d]*((?:[\d,]+\.\d{2}))/ },
  { field: 'tax',         pattern: /税额[：:]?\s*((?:[\d,]+\.\d{2}))/ },
  { field: 'total',       pattern: /价税合计[^0-9]*?(?:小写|小写[）\)])[^0-9]*((?:[\d,]+\.\d{2}))/ },
];

const FALLBACK_PATTERNS = [
  { field: 'total', pattern: /价税合计[^0-9]*((?:[\d,]+\.\d{2}))/ },
  { field: 'total', pattern: /合计[（(]小写[)）][^0-9]*((?:[\d,]+\.\d{2}))/ },
  { field: 'total', pattern: /[（(]小写[)）][^0-9]*((?:[\d,]+\.\d{2}))/ },
  { field: 'tax',   pattern: /税率[：:]?\s*\d+(?:\.\d+)?%[^0-9]*((?:[\d,]+\.\d{2}))/ },
];

function extractFields(text) {
  const fields = {};
  let matchedCount = 0;

  for (const { field, pattern } of PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      fields[field] = match[1].replace(/,/g, '').trim();
      matchedCount++;
    }
  }

  if (!fields.total) {
    for (const { field, pattern } of FALLBACK_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        if (!fields[field]) {
          fields[field] = match[1].replace(/,/g, '').trim();
          matchedCount++;
          break;
        }
      }
    }
  }

  const missingCount = FIELD_META.length - matchedCount;
  return { fields, missingCount };
}

// ============================================================
// 表格渲染
// ============================================================
function buildTableHeader() {
  let html = '<th style="width:32px">#</th>';
  FIELD_META.forEach(m => {
    html += `<th style="width:${m.width}">${m.label}</th>`;
  });
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
      html += `<td contenteditable="true"
                    data-field="${m.key}"
                    class="${isNum ? 'num-cell' : ''} ${!val ? 'empty-cell' : ''}"
                    data-index="${idx}">${val}</td>`;
    });

    html += `<td><button class="btn-icon delete-row" data-index="${idx}" title="删除">✕</button></td>`;
    html += '</tr>';
  });

  els.tableBody.innerHTML = html;

  // 事件：编辑单元格
  els.tableBody.querySelectorAll('td[contenteditable]').forEach(td => {
    td.addEventListener('blur', onCellEdit);
    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
    });
  });

  // 事件：删除行
  els.tableBody.querySelectorAll('.delete-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      state.invoices.splice(idx, 1);
      renderTable();
      updateTotals();
      showStatus('已删除一行', 'info');
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

// ============================================================
// 合计
// ============================================================
function updateTotals() {
  const sums = { amount: 0, tax: 0, total: 0 };
  state.invoices.forEach(inv => {
    NUMERIC_FIELDS.forEach(f => {
      const v = parseFloat(inv[f]);
      if (!isNaN(v)) sums[f] += v;
    });
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
  if (state.invoices.length === 0) {
    showStatus('没有数据可导出', 'warn');
    return;
  }

  const headers = FIELD_META.map(m => m.label);
  const data = state.invoices.map(inv => {
    return FIELD_META.map(m => {
      const val = inv[m.key] || '';
      if (NUMERIC_FIELDS.has(m.key) && val) {
        const num = parseFloat(val);
        return isNaN(num) ? val : num;
      }
      return val;
    });
  });

  // 合计行
  const sums = { amount: 0, tax: 0, total: 0 };
  state.invoices.forEach(inv => {
    NUMERIC_FIELDS.forEach(f => {
      const v = parseFloat(inv[f]);
      if (!isNaN(v)) sums[f] += v;
    });
  });

  const totalRow = FIELD_META.map(m => {
    if (m.key === 'invoiceNo') return '合计';
    if (NUMERIC_FIELDS.has(m.key)) {
      const v = sums[m.key];
      return v ? Math.round(v * 100) / 100 : 0;
    }
    return '';
  });

  const wsData = [headers, ...data, totalRow];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 列宽
  ws['!cols'] = FIELD_META.map(m => ({ wch: Math.max(m.label.length * 2, 12) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '发票清单');

  const filename = `发票提取_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  showStatus(`已导出: ${filename}`, 'success');
}

// ============================================================
// 使用追踪（localStorage + 浏览器指纹）
// ============================================================
async function initTracker() {
  if (state.isPro) return;
  try {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    state.fingerprint = result.visitorId;
  } catch {
    // 降级：基于时间戳的随机 ID
    state.fingerprint = 'fp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
}

function getUsageKey() {
  return CONFIG.STORAGE_KEY_PREFIX + (state.fingerprint || 'unknown');
}

async function getUsageCount() {
  if (state.isPro) return 0;
  const key = getUsageKey();
  const val = parseInt(localStorage.getItem(key)) || 0;
  return val;
}

async function incrementUsage() {
  if (state.isPro) return;
  const key = getUsageKey();
  const current = await getUsageCount();
  localStorage.setItem(key, current + 1);
}

function updateUsageDisplay() {
  if (!els.usageCount) return;
  if (state.isPro) {
    els.usageCount.textContent = '完整版 · 无限使用';
    els.usageCount.className = 'pro-badge';
    if (els.upgradeBtn) els.upgradeBtn.style.display = 'none';
    return;
  }
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
  if (type !== 'error') {
    els.status._timer = setTimeout(() => {
      els.status.style.display = 'none';
    }, 5000);
  }
}

function showLoading(show) {
  els.loadingOverlay.classList.toggle('show', show);
}

function updateLoadingText(text) {
  els.loadingText.textContent = text;
}

function clearAll() {
  if (state.invoices.length === 0) return;
  if (!confirm('确认清空所有数据？')) return;
  state.invoices = [];
  renderTable();
  updateTotals();
  showStatus('已清空', 'info');
}

function showUpgradeModal() {
  els.upgradeModal?.classList.add('show');
}
