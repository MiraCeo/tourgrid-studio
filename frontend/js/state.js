/* ============================================================
   閸嶅繒绀岄悽鑽ょ椽鏉堟垵娅?- 閺嶇绺鹃柅鏄忕帆
   ============================================================ */

// --- 鐢悂鍣?---
const GRID_SIZE = 24;
const BASE_CELL_SIZE = 50 / 3; // 100% 为 400px，400% 为 1600px
const NAV_CELL_SIZE = 4;   // 鐎佃壈鍩呴崳銊︾槨娑擃亜鍎氱槐鐘崇壐閻ㄥ嫬鏄傜€?
const API_BASE_URL = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';
const DEFAULT_PALETTE_ID = 'natural-64-v1';
const DEFAULT_PALETTE_VERSION = TOURGRID_NATURAL_64_V1.version;
let documentMetadata = TourgridStorage.defaultMetadata();

// --- 閼瑰弶婢橀弫鐗堝祦閿涘牆濮╅幀浣瑰絹閸欐牜鏁剧敮鍐ц厬娴ｈ法鏁ゆ０婊嗗閿?--
function getUsedColors() {
  const colorCount = {};
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const c = pixelData[y][x];
      colorCount[c] = (colorCount[c] || 0) + 1;
    }
  }
  // 閹稿濞囬悽銊╊暥濞嗭繝妾锋惔蹇ョ礉閹烘帡娅庣痪顖滄閼冲本娅?
  const sorted = Object.entries(colorCount)
    .filter(([color]) => color !== '#FFFFFF')
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  // 婵绮撻崠鍛儓姒涙垼澹婇崪宀€娅ч懝璇х礄閸╄櫣顢呴懝璇х礆
  if (!sorted.includes('#000000')) sorted.push('#000000');
  sorted.push('#FFFFFF');
  return sorted;
}

function updateColorUsageSummary() {
  var summary = document.getElementById('colorUsageSummary');
  if (!summary || !pixelData.length) return;
  var counts = {};
  var total = 0;
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var color = pixelData[y][x].toUpperCase();
      counts[color] = (counts[color] || 0) + 1;
      total++;
    }
  }
  summary.textContent = '已使用 ' + Object.keys(counts).length + ' 种颜色 · 共 ' + total + ' 格';
  updateConversionResultSummary();
}

function updateConversionResultSummary() {
  var summaries = document.querySelectorAll('.conversion-result-summary');
  if (!summaries.length) return;
  var sourceLabels = {
    canvas: '当前画布',
    server: '服务器转换',
    local: '浏览器本地转换',
    shared: '分享作品'
  };
  var parts = [sourceLabels[documentMetadata.sourceMode] || '当前画布'];
  if (documentMetadata.paletteId) parts.push(documentMetadata.paletteId);
  if (documentMetadata.paletteVersion !== null) {
    parts.push('色板 v' + documentMetadata.paletteVersion);
  }
  if (documentMetadata.converterVersion) {
    parts.push('转换器 ' + documentMetadata.converterVersion);
  }
  summaries.forEach(function(summary) {
    summary.textContent = parts.join(' · ');
  });
}

function updateTopWorkIdentity() {
  var titleElement = document.getElementById('topWorkTitle');
  var metaElement = document.getElementById('topWorkMeta');
  if (!titleElement || !metaElement) return;

  var isShared = (
    documentMetadata.sourceMode === 'shared' &&
    documentMetadata.sharedCode
  );
  if (!isShared) {
    titleElement.textContent = '《巡展像素》非官方编辑器';
    metaElement.textContent = '';
    metaElement.hidden = true;
    return;
  }

  var title = documentMetadata.sharedTitle || '很糊的画';
  var author = documentMetadata.sharedAuthorName || '博士';
  var views = Number.isInteger(documentMetadata.sharedViewCount)
    ? documentMetadata.sharedViewCount
    : 0;
  titleElement.textContent = '《' + title + '》';
  metaElement.textContent = (
    '作者：' + author +
    ' · 分享次数：' + views +
    ' · 分享码：' + documentMetadata.sharedCode
  );
  metaElement.hidden = false;
}

function markSharedWorkAsEdited() {
  if (documentMetadata.sourceMode !== 'shared') return;
  documentMetadata = Object.assign({}, documentMetadata, {
    sourceMode: 'canvas',
    sharedCode: null,
    sharedTitle: null,
    sharedAuthorName: null,
    sharedViewCount: null
  });
  if (typeof activeSharedWorkCode !== 'undefined') {
    activeSharedWorkCode = null;
  }
  updateTopWorkIdentity();
}

let overlayVisible = false;   // overlay toggle state
let overlayOpacity = 0.4;      // overlay opacity
let referenceState = TourgridStorage.defaultReference();
let currentColor = '#222222';
let currentTool = 'brush';
let eyedropperActive = false;
let moveCanvasActive = false;
let paletteMode = 'official';
let palettePanelMode = 'palette';
let statisticsHighlightColor = null;
let statisticsSortMode = 'count-desc';
let replicationCompletedColors = new Set();
let replicationPreviewMode = 'target';
let paletteColorBeforeReplication = null;
let replicationSelectionChanged = false;
let canvasGuidesVisible = true;

// 巡展像素官方色板(待填入)
const EXHIBITION_DATA = TOURGRID_NATURAL_64_V1.colors.map(function(color) {
  return {code: color.code, hex: color.hex, name: color.name};
});

// 编辑器只使用巡展像素色板。
let OFFICIAL_COLORS = EXHIBITION_DATA;

// 保留单项定义以兼容旧存档恢复流程；旧色板 ID 会回落到巡展像素。
const PALETTE_DEFS = [
  { id: 'exhibition', label: '巡展像素', colors: EXHIBITION_DATA, color: '#80D8F0' }
];
let currentPaletteId = 'exhibition';

function restorePaletteSelection(paletteId) {
  var def = PALETTE_DEFS.find(function(item) { return item.id === paletteId; });
  if (!def) def = PALETTE_DEFS[0];
  currentPaletteId = def.id;
  OFFICIAL_COLORS = def.colors;
  paletteMode = def.colors.length ? 'official' : 'canvas';
  buildHexCodeMap();

}

// hex→色号缩写映射表 (用于画布像素格显示)
let hexToCodeMap = {};
function buildHexCodeMap() {
  hexToCodeMap = {};
  OFFICIAL_COLORS.forEach(function(entry) {
    hexToCodeMap[entry.hex.toUpperCase()] = entry.code.replace(/^80-/, '');
  });
}
buildHexCodeMap();

// 提取色板条目的hex值
function paletteHex(entry) {
  return typeof entry === 'string' ? entry : entry.hex;
}
// 提取色板条目的色号(无则返回空)
function paletteCode(entry) {
  return typeof entry === 'string' ? '' : (entry.code || '');
}
// 通过hex查找色板条目
function findPaletteEntry(hex) {
  return OFFICIAL_COLORS.find(function(e) { return paletteHex(e) === hex; });
}

// --- 閻㈣绔烽悩鑸碘偓?---
let pixelData = [];     // 2D閺佹壆绮?[y][x] = '#rrggbb'
let zoom = 100;         // zoom
let isDrawing = false;
let lastPaintedX = -1;
let lastPaintedY = -1;

// --- 本地存储：自动保存/加载像素数据 ---
var STORAGE_KEY = 'pixel_editor_save';
var MANUAL_CHECKPOINT_KEY = 'pixel_editor_manual_checkpoint';
var CANVAS_GUIDES_STORAGE_KEY = 'tourgrid_canvas_guides_visible';
var REPLICATION_PROGRESS_STORAGE_KEY = 'tourgrid_replication_progress_v1';

function serializeCurrentDocument() {
  return TourgridStorage.serialize({
    gridSize: GRID_SIZE,
    pixels: pixelData.map(function(row) { return row.slice(); }),
    metadata: Object.assign({}, documentMetadata, {
      editorPaletteId: currentPaletteId
    }),
    reference: Object.assign({}, referenceState, {
      visible: overlayVisible,
      opacity: overlayOpacity
    })
  });
}

function saveToStorage(silent) {
  try {
    var data = serializeCurrentDocument();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!silent) showToast('💾 已存档 (' + GRID_SIZE + '×' + GRID_SIZE + ')');
  } catch(e) {
    // localStorage满或不可用，静默忽略
  }
}

function manualSave() {
  try {
    var data = serializeCurrentDocument();
    localStorage.setItem(MANUAL_CHECKPOINT_KEY, JSON.stringify(data));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (typeof scheduleReferenceAssetPrune === 'function') {
      scheduleReferenceAssetPrune();
    }
    showToast('已创建手动保存点');
    return true;
  } catch(e) {
    showToast('无法创建手动保存点');
    return false;
  }
}

function loadFromStorage() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return TourgridStorage.migrate(JSON.parse(raw));
  } catch(e) {
    return null;
  }
}

function loadManualCheckpoint() {
  try {
    var raw = localStorage.getItem(MANUAL_CHECKPOINT_KEY);
    if (!raw) return null;
    return TourgridStorage.migrate(JSON.parse(raw));
  } catch(e) {
    return null;
  }
}

function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
}

// --- 閹锋牗瀚块獮宕囆╅悩鑸碘偓?---
let isPanning = false;
let spaceHeld = false;
let panStartX = 0, panStartY = 0;
let panScrollStartX = 0, panScrollStartY = 0;

// --- 閹俱倝鏀㈤弽?---
const MAX_UNDO = 100;
let undoStack = [];
let redoStack = [];
let historyOperationInProgress = false;

// --- DOM瀵洜鏁?---
let mainCanvas, mainCtx, navCanvas, navCtx;
let canvasContainer, centerPanel;

// --- init ---
