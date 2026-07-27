function getMinZoom() {
  return Math.max(20, Math.min(85, Math.floor(400 / (GRID_SIZE * BASE_CELL_SIZE) * 100)));
}

function setZoom(value) {
  zoom = parseInt(value);
  document.getElementById('zoomValue').textContent = zoom + '%';
  // 同步移动端缩放显示
  var mbVal = document.getElementById('zoomValueMb');
  if (mbVal) mbVal.textContent = zoom + '%';
  var slider = document.getElementById('zoomSlider');
  if (slider) slider.value = zoom;
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
}

// 移动端缩放按钮 +/-
function adjustZoom(delta) {
  var newZoom = zoom + delta;
  newZoom = Math.max(20, Math.min(300, newZoom));
  setZoom(newZoom);
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

// --- 吸管点击导航器取色 ---
function onNavClick(e) {
  // 仅在吸管模式下响应
  if (currentTool !== 'inspect') return;

  var rect = navCanvas.getBoundingClientRect();
  var sx = e.clientX - rect.left;
  var sy = e.clientY - rect.top;
  if (sx < 0 || sy < 0 || sx >= rect.width || sy >= rect.height) return;

  // 从navCanvas读取像素颜色 (navCanvas尺寸 128×128)
  var navW = navCanvas.width;
  var navH = navCanvas.height;
  var px = Math.floor(sx / rect.width * navW);
  var py = Math.floor(sy / rect.height * navH);
  if (px < 0 || px >= navW || py < 0 || py >= navH) return;

  var pixel = navCtx.getImageData(px, py, 1, 1).data;
  var r = pixel[0], g = pixel[1], b = pixel[2];
  // 跳过纯白(空像素)
  if (r === 255 && g === 255 && b === 255) return;

  var hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();

  // 显示取色弹窗
  showColorPickPopup(hex, rect);
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
function onKeyDown(e) {
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
