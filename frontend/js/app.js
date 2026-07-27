function getMinZoom() {
  return Math.max(20, Math.min(85, Math.floor(400 / (GRID_SIZE * BASE_CELL_SIZE) * 100)));
}

function updateZoomControlState() {
  var slider = document.getElementById('zoomSlider');
  if (!slider) return;
  slider.value = zoom;
  var min = parseFloat(slider.min) || 20;
  var max = parseFloat(slider.max) || 300;
  var progress = max > min ? (zoom - min) / (max - min) * 100 : 0;
  progress = Math.max(0, Math.min(100, progress));
  slider.style.setProperty('--zoom-progress', progress + '%');
}

function setZoom(value) {
  zoom = parseInt(value);
  updateZoomControlState();
  updateCanvasSize();
  renderCanvas();
  // 滑块和按钮缩放后保持画布中心位于视口中央。
  canvasContainer.scrollLeft = Math.max(
    0,
    (canvasContainer.scrollWidth - canvasContainer.clientWidth) / 2
  );
  canvasContainer.scrollTop = Math.max(
    0,
    (canvasContainer.scrollHeight - canvasContainer.clientHeight) / 2
  );
  updateNavigatorViewport();
}

function fitCanvasToViewport() {
  var availableSize = Math.max(
    1,
    Math.min(canvasContainer.clientWidth, canvasContainer.clientHeight) - 24
  );
  var targetZoom = Math.floor(
    availableSize / (GRID_SIZE * BASE_CELL_SIZE) * 100
  );
  targetZoom = Math.max(20, Math.min(300, targetZoom));
  setZoom(targetZoom);
  showToast('画布已适应当前视口');
}

// --- 妫版粏澹婇弰鍓с仛閺囧瓨鏌?---
function updateColorDisplay(hex, label, extra) {
  var swatch = document.getElementById('colorSwatch');
  var labelElement = document.getElementById('colorLabel');
  var infoElement = document.getElementById('colorInfo');
  if (!swatch || !labelElement || !infoElement) return;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  swatch.style.background = hex;
  labelElement.textContent = label || 'Brush';
  var info = 'RGB(' + r + ', ' + g + ', ' + b + ')<br>' + hex;
  // 官方模式下查找色号
  if (paletteMode === 'official') {
    var entry = findPaletteEntry(hex);
    if (entry && paletteCode(entry)) {
      info += '<br>色号: ' + paletteCode(entry);
    }
  }
  if (extra) info += '<br>' + extra;
  infoElement.innerHTML = info;
}

// --- 瀹搞儱鍙块崚鍥ㄥ床 ---
function setTool(tool) {
  currentTool = 'brush';
  if (tool === 'eraser') {
    selectColor('#FFFFFF');
  } else {
    updateColorDisplay(currentColor, 'Brush');
  }
}

// --- 鐎光剝鐓￠崓蹇曠 ---
function inspectPixel(gx, gy) {
  if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return;
  const hex = pixelData[gy][gx];
  currentColor = hex;
  updateColorDisplay(hex, 'Brush');
  setTool('brush');
}

// --- 点击色卡取色 ---
function onSwatchClick(e) {
  e.stopPropagation();
  // 从色块DOM直接读取实际显示的颜色(避免currentColor未同步)
  var hex = document.getElementById('colorSwatch').style.background;
  // 处理浏览器可能转换的rgb()格式
  if (hex.slice(0,3) === 'rgb') {
    var m = hex.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      hex = '#' + ((1 << 24) + (parseInt(m[0]) << 16) + (parseInt(m[1]) << 8) + parseInt(m[2])).toString(16).slice(1).toUpperCase();
    }
  }
  if (!hex || hex === '#FFFFFF' && currentTool === 'eraser') return;
  var rect = document.getElementById('colorSwatch').getBoundingClientRect();
  showColorPickPopup(hex, rect);
}

// --- 导航缩略图：视口框与画布定位 ---
var navigatorDragging = false;

function updateNavigatorViewport() {
  var indicator = document.getElementById('navViewportIndicator');
  if (!indicator || !mainCanvas || !canvasContainer) return;

  var canvasRect = mainCanvas.getBoundingClientRect();
  var viewportRect = canvasContainer.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return;

  var visibleLeft = Math.max(canvasRect.left, viewportRect.left);
  var visibleTop = Math.max(canvasRect.top, viewportRect.top);
  var visibleRight = Math.min(canvasRect.right, viewportRect.right);
  var visibleBottom = Math.min(canvasRect.bottom, viewportRect.bottom);

  var leftRatio = Math.max(0, Math.min(1, (visibleLeft - canvasRect.left) / canvasRect.width));
  var topRatio = Math.max(0, Math.min(1, (visibleTop - canvasRect.top) / canvasRect.height));
  var widthRatio = Math.max(0, Math.min(1 - leftRatio, (visibleRight - visibleLeft) / canvasRect.width));
  var heightRatio = Math.max(0, Math.min(1 - topRatio, (visibleBottom - visibleTop) / canvasRect.height));

  indicator.style.left = (leftRatio * 100) + '%';
  indicator.style.top = (topRatio * 100) + '%';
  indicator.style.width = (widthRatio * 100) + '%';
  indicator.style.height = (heightRatio * 100) + '%';
}

function positionCanvasFromNavigator(e) {
  var rect = document.getElementById('navPreviewWrap').getBoundingClientRect();
  var ratioX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  var ratioY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  var maxScrollX = Math.max(0, canvasContainer.scrollWidth - canvasContainer.clientWidth);
  var maxScrollY = Math.max(0, canvasContainer.scrollHeight - canvasContainer.clientHeight);

  canvasContainer.scrollLeft = Math.max(
    0,
    Math.min(maxScrollX, ratioX * mainCanvas.clientWidth - canvasContainer.clientWidth / 2)
  );
  canvasContainer.scrollTop = Math.max(
    0,
    Math.min(maxScrollY, ratioY * mainCanvas.clientHeight - canvasContainer.clientHeight / 2)
  );
  updateNavigatorViewport();
}

function onNavigatorPointerDown(e) {
  if (e.button !== 0) return;
  navigatorDragging = true;
  e.currentTarget.setPointerCapture(e.pointerId);
  positionCanvasFromNavigator(e);
  e.preventDefault();
}

function onNavigatorPointerMove(e) {
  if (!navigatorDragging) return;
  positionCanvasFromNavigator(e);
}

function onNavigatorPointerUp(e) {
  navigatorDragging = false;
  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
    e.currentTarget.releasePointerCapture(e.pointerId);
  }
}

function onNavigatorKeyDown(e) {
  var stepX = Math.max(20, canvasContainer.clientWidth * 0.12);
  var stepY = Math.max(20, canvasContainer.clientHeight * 0.12);
  if (e.key === 'ArrowLeft') canvasContainer.scrollLeft -= stepX;
  else if (e.key === 'ArrowRight') canvasContainer.scrollLeft += stepX;
  else if (e.key === 'ArrowUp') canvasContainer.scrollTop -= stepY;
  else if (e.key === 'ArrowDown') canvasContainer.scrollTop += stepY;
  else return;
  e.preventDefault();
  updateNavigatorViewport();
}

function showColorPickPopup(hex, navRect) {
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);

  // 查找精确匹配的色号
  var entry = findPaletteEntry(hex);
  var code = entry ? paletteCode(entry) : '';

  // 更新顶部: 色块 + RGB + 色号
  document.getElementById('pickSwatch').style.background = hex;
  var infoHtml = 'RGB(' + r + ', ' + g + ', ' + b + ') ' + hex;
  if (code) {
    infoHtml += ' <span class=\"pick-code\">' + code + '</span>';
  }
  document.getElementById('pickInfo').innerHTML = infoHtml;

  // 查找5个最接近的色板颜色
  var top5 = findTop5Closest(r, g, b);
  var optionsEl = document.getElementById('pickOptions');
  optionsEl.innerHTML = '';
  top5.forEach(function(item) {
    var opt = document.createElement('div');
    opt.className = 'pick-option';
    opt.style.background = item.hex;
    opt.title = item.code + ' ' + item.hex;
    // 色号标签
    var codeLabel = document.createElement('span');
    codeLabel.className = 'pick-option-code';
    codeLabel.textContent = item.code.replace(/^80-/, '');
    opt.appendChild(codeLabel);
    // 点击选择该颜色
    opt.addEventListener('click', function(ev) {
      ev.stopPropagation();
      selectPickOption(item.hex);
    });
    optionsEl.appendChild(opt);
  });

  // 定位弹窗: 在导航器右侧
  var popup = document.getElementById('colorPickPopup');
  var top = navRect.top;
  var left = navRect.right + 8;
  // 避免超出屏幕右侧
  if (left + 308 > window.innerWidth) {
    left = navRect.left - 308;
  }
  // 避免超出屏幕底部
  if (top + 100 > window.innerHeight) {
    top = window.innerHeight - 110;
  }
  if (top < 0) top = 8;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
  popup.classList.add('show');
}

function hideColorPickPopup() {
  document.getElementById('colorPickPopup').classList.remove('show');
}

function selectPickOption(hex) {
  currentColor = hex;
  // 更新吸管颜色显示
  updateColorDisplay(hex, 'Brush');
  // 自动切换到画笔模式
  setTool('brush');
  hideColorPickPopup();
}

// 查找与目标RGB最接近的5个色板颜色
function findTop5Closest(r, g, b) {
  var palette = OFFICIAL_COLORS;
  if (palette.length === 0) palette = EXHIBITION_DATA;

  var results = [];
  for (var i = 0; i < palette.length; i++) {
    var entry = palette[i];
    var hex = paletteHex(entry);
    var pr = parseInt(hex.slice(1,3), 16);
    var pg = parseInt(hex.slice(3,5), 16);
    var pb = parseInt(hex.slice(5,7), 16);
    var d = colorDistRGB(r, g, b, pr, pg, pb);
    results.push({ code: paletteCode(entry), hex: hex, dist: d });
  }
  results.sort(function(a, b) { return a.dist - b.dist; });
  return results.slice(0, 5);
}

// 点击弹窗外部关闭
document.addEventListener('click', function(e) {
  var popup = document.getElementById('colorPickPopup');
  if (popup && popup.classList.contains('show') && !popup.contains(e.target) && e.target !== navCanvas && e.target !== document.getElementById('colorSwatch')) {
    hideColorPickPopup();
  }
  var exportDD = document.getElementById('exportDropdown');
  if (exportDD && exportDD.classList.contains('show') && !exportDD.contains(e.target)) {
    hideExportDropdown();
  }
});

// --- 色板与统计面板 ---
function getCurrentPaletteColors() {
  return EXHIBITION_DATA.map(paletteHex);
}

// 感知色差 (人眼对G最敏感, 权重: R×2 G×4 B×3)
function colorDistRGB(r1, g1, b1, r2, g2, b2) {
  var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 2*dr*dr + 4*dg*dg + 3*db*db;
}

function isStatisticsMode() {
  return palettePanelMode === 'statistics';
}

function getPaletteUsageEntries() {
  var counts = {};
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var color = String(pixelData[y][x]).toUpperCase();
      counts[color] = (counts[color] || 0) + 1;
    }
  }

  var known = {};
  var entries = EXHIBITION_DATA.map(function(entry, index) {
    var hex = paletteHex(entry).toUpperCase();
    known[hex] = true;
    return {
      hex: hex,
      count: counts[hex] || 0,
      paletteEntry: entry,
      paletteIndex: index
    };
  });

  Object.keys(counts).sort().forEach(function(hex, legacyIndex) {
    if (!known[hex]) {
      entries.push({
        hex: hex,
        count: counts[hex],
        paletteEntry: null,
        paletteIndex: EXHIBITION_DATA.length + legacyIndex
      });
    }
  });
  return entries;
}

function sortStatisticsEntries(entries) {
  if (statisticsSortMode === 'palette-order') {
    return entries.slice().sort(function(a, b) {
      return a.paletteIndex - b.paletteIndex;
    });
  }

  return entries.filter(function(entry) {
    return entry.count > 0;
  }).sort(function(a, b) {
    var countDifference = statisticsSortMode === 'count-asc'
      ? a.count - b.count
      : b.count - a.count;
    return countDifference || a.paletteIndex - b.paletteIndex;
  });
}

function renderColorGrid() {
  var grid = document.getElementById('colorGrid');
  var palette = getCurrentPaletteColors();
  grid.innerHTML = '';

  palette.forEach(function(color) {
    var swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.style.background = color;
    swatch.title = color === '#FFFFFF' ? '白色 / 擦除' : color;
    swatch.setAttribute('aria-label', swatch.title);
    swatch.dataset.color = color;

    if (color === currentColor) swatch.classList.add('active');
    swatch.addEventListener('click', function() {
      selectColor(color, swatch);
    });
    grid.appendChild(swatch);
  });

  updateColorUsageSummary();
  if (isStatisticsMode()) renderStatisticsPanel();
}

function selectColor(color, swatchEl) {
  if (isStatisticsMode()) return;
  currentColor = color;
  currentTool = 'brush';

  document.querySelectorAll('.color-swatch').forEach(function(swatch) {
    swatch.classList.remove('active');
  });
  if (swatchEl) {
    swatchEl.classList.add('active');
  } else {
    var target = document.querySelector('.color-swatch[data-color="' + color + '"]');
    if (target) target.classList.add('active');
  }
}

function renderStatisticsPanel() {
  var grid = document.getElementById('statisticsGrid');
  var hint = document.getElementById('statisticsHint');
  var entries = sortStatisticsEntries(getPaletteUsageEntries());
  grid.innerHTML = '';

  entries.forEach(function(entry) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'statistics-color';
    item.style.background = entry.hex;
    item.dataset.color = entry.hex;
    item.title = entry.hex + ' · ' + entry.count + ' 格';
    item.setAttribute('aria-label', '颜色 ' + entry.hex + '，使用 ' + entry.count + ' 格');
    if (entry.hex === statisticsHighlightColor) item.classList.add('active');

    var count = document.createElement('span');
    count.className = 'statistics-count';
    count.textContent = '×' + entry.count;
    item.appendChild(count);
    item.addEventListener('click', function() {
      selectStatisticsColor(entry.hex);
    });
    grid.appendChild(item);
  });

  updateColorUsageSummary();
  hint.textContent = statisticsHighlightColor
    ? '已高亮 ' + statisticsHighlightColor + '；再次选择可取消'
    : '选择一种颜色，在画布中高亮对应格子';
}

function setStatisticsSortMode(mode) {
  if (!['count-desc', 'count-asc', 'palette-order'].includes(mode)) return;
  statisticsSortMode = mode;
  document.getElementById('statisticsSort').value = mode;

  if (mode !== 'palette-order' && statisticsHighlightColor) {
    var selectedEntry = getPaletteUsageEntries().find(function(entry) {
      return entry.hex === statisticsHighlightColor;
    });
    if (!selectedEntry || selectedEntry.count === 0) statisticsHighlightColor = null;
  }

  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function selectStatisticsColor(color) {
  if (!isStatisticsMode()) return;
  statisticsHighlightColor = statisticsHighlightColor === color ? null : color;
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function renderStatisticsHighlightOverlay() {
  if (!isStatisticsMode() || !statisticsHighlightColor) {
    overlayCanvas.style.display = 'none';
    return;
  }

  var cellSize = BASE_CELL_SIZE * (zoom / 100);
  var canvasSize = GRID_SIZE * cellSize;
  overlayCanvas.width = canvasSize;
  overlayCanvas.height = canvasSize;
  overlayCanvas.style.display = 'block';
  overlayCtx.clearRect(0, 0, canvasSize, canvasSize);
  overlayCtx.fillStyle = 'rgba(16, 18, 22, 0.72)';
  overlayCtx.fillRect(0, 0, canvasSize, canvasSize);
  overlayCtx.strokeStyle = '#72F5F2';
  overlayCtx.lineWidth = Math.max(1.5, Math.min(3, cellSize * 0.12));

  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      if (String(pixelData[y][x]).toUpperCase() !== statisticsHighlightColor) continue;
      var left = x * cellSize;
      var top = y * cellSize;
      overlayCtx.clearRect(left, top, cellSize, cellSize);
      overlayCtx.strokeRect(
        left + overlayCtx.lineWidth / 2,
        top + overlayCtx.lineWidth / 2,
        cellSize - overlayCtx.lineWidth,
        cellSize - overlayCtx.lineWidth
      );
    }
  }
  drawCanvasCenterAxes(overlayCtx, canvasSize, canvasSize);
}

function setPalettePanelMode(mode) {
  if (mode !== 'palette' && mode !== 'statistics') return;
  palettePanelMode = mode;

  var paletteTab = document.getElementById('paletteTab');
  var statisticsTab = document.getElementById('statisticsTab');
  var paletteView = document.getElementById('palettePanelView');
  var statisticsView = document.getElementById('statisticsPanelView');
  var readOnly = isStatisticsMode();

  paletteTab.classList.toggle('active', !readOnly);
  statisticsTab.classList.toggle('active', readOnly);
  paletteTab.setAttribute('aria-selected', String(!readOnly));
  statisticsTab.setAttribute('aria-selected', String(readOnly));
  paletteView.hidden = readOnly;
  statisticsView.hidden = !readOnly;

  document.getElementById('undoBtn').disabled = readOnly;
  document.getElementById('redoBtn').disabled = readOnly;
  canvasContainer.classList.toggle('statistics-readonly', readOnly);

  if (readOnly) {
    isDrawing = false;
    renderStatisticsPanel();
    renderStatisticsHighlightOverlay();
  } else {
    statisticsHighlightColor = null;
    renderColorGrid();
    renderOverlay();
  }
}

// --- 闁款喚娲忚箛顐ｅ祹闁?---
var authorModalTrigger = null;
var announcementModalTrigger = null;

function openAnnouncementModal() {
  var modal = document.getElementById('announcementModal');
  if (!modal) return;
  announcementModalTrigger = document.activeElement;
  modal.hidden = false;
  requestAnimationFrame(function() {
    modal.classList.add('show');
    var closeButton = modal.querySelector('.announcement-close-btn');
    if (closeButton) closeButton.focus();
  });
}

function closeAnnouncementModal() {
  var modal = document.getElementById('announcementModal');
  if (!modal || modal.hidden) return;
  modal.classList.remove('show');
  window.setTimeout(function() {
    if (!modal.classList.contains('show')) modal.hidden = true;
  }, 180);
  if (announcementModalTrigger && typeof announcementModalTrigger.focus === 'function') {
    announcementModalTrigger.focus();
  }
}

function closeAnnouncementModalFromBackdrop(e) {
  if (e.target === e.currentTarget) closeAnnouncementModal();
}

function openAuthorModal() {
  var modal = document.getElementById('authorModal');
  if (!modal) return;
  authorModalTrigger = document.activeElement;
  modal.hidden = false;
  requestAnimationFrame(function() {
    modal.classList.add('show');
    var closeButton = modal.querySelector('.author-close-btn');
    if (closeButton) closeButton.focus();
  });
}

function closeAuthorModal() {
  var modal = document.getElementById('authorModal');
  if (!modal || modal.hidden) return;
  modal.classList.remove('show');
  window.setTimeout(function() {
    if (!modal.classList.contains('show')) modal.hidden = true;
  }, 180);
  if (authorModalTrigger && typeof authorModalTrigger.focus === 'function') {
    authorModalTrigger.focus();
  }
}

function closeAuthorModalFromBackdrop(e) {
  if (e.target === e.currentTarget) closeAuthorModal();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    var announcementModal = document.getElementById('announcementModal');
    if (announcementModal && !announcementModal.hidden) {
      e.preventDefault();
      closeAnnouncementModal();
      return;
    }
    var authorModal = document.getElementById('authorModal');
    if (authorModal && !authorModal.hidden) {
      e.preventDefault();
      closeAuthorModal();
      return;
    }
  }
  // 缁岀儤鐗搁幐澶夌瑓閿涘牅绗夐崷銊ㄧ翻閸忋儲顢嬮崘鍜冪礆閳?閸氼垳鏁ら幏鏍ㄥ楠炲磭些
  if (e.code === 'Space' && !e.target.closest('input,textarea,button')) {
    e.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
      mainCanvas.style.cursor = 'grab';
      canvasContainer.style.cursor = 'grab';
    }
    return;
  }
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    redo();
  } else if (!isStatisticsMode() && (e.key === 'b' || e.key === 'B')) {
    setTool('brush');
  } else if (!isStatisticsMode() && (e.key === 'e' || e.key === 'E')) {
    setTool('eraser');
  } else if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    exportRawPixelImage();
  }
}

function onKeyUp(e) {
  if (e.code === 'Space') {
    spaceHeld = false;
    if (!isPanning) {
      mainCanvas.style.cursor = 'crosshair';
      canvasContainer.style.cursor = '';
    }
  }
}

// --- Toast ---
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// --- 启动 ---
document.addEventListener('DOMContentLoaded', init);

// --- 移动端横竖屏检测（比CSS orientation更可靠）---
function checkOrientation() {
  var hint = document.getElementById('rotateHint');
  if (!hint) return;
  var isPortrait = window.innerWidth < window.innerHeight;
  var isNarrow = window.innerWidth < 768;
  if (isNarrow && isPortrait) {
    hint.classList.add('show');
  } else {
    hint.classList.remove('show');
  }
}
window.addEventListener('load', checkOrientation);
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', function() {
  // orientationchange回调时尺寸可能还没更新，延迟检查
  setTimeout(checkOrientation, 200);
});
