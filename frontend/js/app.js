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
  // 缩放到最小值时自动居中
  if (zoom === getMinZoom()) {
    canvasContainer.scrollLeft = 0;
    canvasContainer.scrollTop = 0;
  }
}

// 移动端缩放按钮 +/-
function adjustZoom(delta) {
  var newZoom = zoom + delta;
  newZoom = Math.max(20, Math.min(300, newZoom));
  setZoom(newZoom);
}

// --- 妫版粏澹婇弰鍓с仛閺囧瓨鏌?---
function updateColorDisplay(hex, label, extra) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  document.getElementById('colorSwatch').style.background = hex;
  document.getElementById('colorLabel').textContent = label || 'Brush';
  var info = 'RGB(' + r + ', ' + g + ', ' + b + ')<br>' + hex;
  // 官方模式下查找色号
  if (paletteMode === 'official') {
    var entry = findPaletteEntry(hex);
    if (entry && paletteCode(entry)) {
      info += '<br>色号: ' + paletteCode(entry);
    }
  }
  if (extra) info += '<br>' + extra;
  document.getElementById('colorInfo').innerHTML = info;
}

// --- 瀹搞儱鍙块崚鍥ㄥ床 ---
function setTool(tool) {
  currentTool = tool;
  document.getElementById('brushTool').classList.toggle('active', tool === 'brush');
  document.getElementById('eraserTool').classList.toggle('active', tool === 'eraser');
  document.getElementById('inspectTool').classList.toggle('active', tool === 'inspect');

  if (tool === 'eraser') {
    updateColorDisplay('#FFFFFF', 'Eraser');
  } else if (tool === 'inspect') {
    document.getElementById('colorLabel').textContent = 'Inspector';
    document.getElementById('colorInfo').textContent = 'Click a pixel to inspect';
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
  // 如果当前是画布用色模式, 也用官方色板(至少MARD_DATA)
  if (palette.length === 0) palette = MARD_DATA;

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

// --- 色板渲染 ---
const PALETTE_SLOTS = 24; // 色板最大槽位

// 获取当前模式下的纯hex颜色数组
function getCurrentPaletteColors() {
  if (paletteMode === 'official' && OFFICIAL_COLORS.length > 0) {
    return OFFICIAL_COLORS.map(paletteHex);
  }
  return getUsedColors();
}

// 感知色差 (人眼对G最敏感, 权重: R×2 G×4 B×3)
function colorDistRGB(r1, g1, b1, r2, g2, b2) {
  var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 2*dr*dr + 4*dg*dg + 3*db*db;
}

// ============================================================
// 色板选择系统 (下拉面板)
// ============================================================
function togglePalettePicker() {
  var picker = document.getElementById('palettePicker');
  var menu = document.getElementById('palettePickerMenu');
  if (menu.style.display !== 'none') {
    menu.style.display = 'none';
    picker.classList.remove('open');
  } else {
    renderPaletteMenu();
    menu.style.display = 'block';
    picker.classList.add('open');
  }
}

function renderPaletteMenu() {
  var menu = document.getElementById('palettePickerMenu');
  menu.innerHTML = '';
  PALETTE_DEFS.forEach(function(def) {
    var item = document.createElement('button');
    item.className = 'palette-picker-item';
    if (def.id === currentPaletteId) item.classList.add('active');
    if (def.colors.length === 0 && def.id !== 'exhibition') {
      item.classList.add('empty');
      item.textContent = def.label;
      item.disabled = true;
    } else {
      item.innerHTML = '<span class="item-dot" style="background:' + def.color + '"></span>' + def.label;
    }
    item.addEventListener('click', function() {
      selectPalette(def.id);
    });
    menu.appendChild(item);
  });
}

function selectPalette(id) {
  var def = PALETTE_DEFS.find(function(d) { return d.id === id; });
  if (!def) return;

  currentPaletteId = id;
  documentMetadata.sourceMode = 'canvas';
  documentMetadata.paletteId = id;
  documentMetadata.editorPaletteId = id;
  documentMetadata.paletteVersion = null;
  documentMetadata.converterVersion = null;
  OFFICIAL_COLORS = def.colors;
  buildHexCodeMap();

  // 更新按钮外观
  var btn = document.getElementById('palettePickerBtn');
  var label = document.getElementById('palettePickerLabel');
  label.textContent = '色板: ' + def.label;
  btn.style.background = def.colors.length > 0 ? '#C57820' : '#3A6BC5';

  paletteMode = (def.colors.length > 0) ? 'official' : 'canvas';
  currentPaletteIdx = 0;

  // 有颜色数据时自动匹配替换
  var snapped = 0;
  if (def.colors.length > 0) {
    currentColor = paletteHex(def.colors[0]);
    currentTool = 'brush';

    var officialRGB = def.colors.map(function(e) {
      var h = e.hex;
      return { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16), hex: h };
    });

    pushUndo();
    for (var y = 0; y < GRID_SIZE; y++) {
      for (var x = 0; x < GRID_SIZE; x++) {
        var c = pixelData[y][x];
        if (c === '#FFFFFF') continue;
        var r = parseInt(c.slice(1,3),16);
        var g = parseInt(c.slice(3,5),16);
        var b = parseInt(c.slice(5,7),16);
        var best = officialRGB[0], bestD = Infinity;
        for (var i = 0; i < officialRGB.length; i++) {
          var d = colorDistRGB(r, g, b, officialRGB[i].r, officialRGB[i].g, officialRGB[i].b);
          if (d < bestD) { bestD = d; best = officialRGB[i]; }
        }
        if (best.hex !== c) {
          pixelData[y][x] = best.hex;
          snapped++;
        }
      }
    }
  }

  // 关闭菜单
  document.getElementById('palettePickerMenu').style.display = 'none';
  document.getElementById('palettePicker').classList.remove('open');

  renderColorGrid();
  renderCanvas();
  renderNavigator();

  if (snapped > 0) {
    showToast('已匹配 ' + snapped + ' 个像素到' + def.label + '色板 (Ctrl+Z可撤销)');
  }
}

// 点击外部关闭下拉
document.addEventListener('click', function(e) {
  var picker = document.getElementById('palettePicker');
  if (picker && !picker.contains(e.target)) {
    document.getElementById('palettePickerMenu').style.display = 'none';
    picker.classList.remove('open');
  }
});

function renderColorGrid() {
  const grid = document.getElementById('colorGrid');
  const palette = getCurrentPaletteColors();
  grid.innerHTML = '';

  // 官方模式支持翻页 (291色 > 24槽位)
  var totalPages = Math.ceil(palette.length / PALETTE_SLOTS);
  if (currentPaletteIdx >= totalPages) currentPaletteIdx = 0;
  var startIdx = currentPaletteIdx * PALETTE_SLOTS;

  for (let i = 0; i < PALETTE_SLOTS; i++) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    var dataIdx = startIdx + i;
    if (dataIdx < palette.length) {
      const color = palette[dataIdx];
      swatch.style.background = color;

      // 官方模式显示色号标签
      var code = '';
      if (paletteMode === 'official') {
        code = paletteCode(OFFICIAL_COLORS[dataIdx]);
      }
      if (code) {
        swatch.title = code + ' ' + color;
        // MARD色号无80-前缀，直接显示 (如 A1, B15)
        var shortCode = code.replace(/^80-/, '');
        var label = document.createElement('span');
        label.className = 'swatch-code';
        label.textContent = shortCode;
        swatch.appendChild(label);
      } else {
        swatch.title = color;
      }

      if (color === currentColor && currentTool === 'brush') {
        swatch.classList.add('active');
      }
      swatch.addEventListener('click', () => selectColor(color, swatch));
    } else {
      swatch.style.background = '#2C2C30';
      swatch.style.borderColor = 'rgba(255,255,255,0.12)';
      swatch.title = 'Empty slot';
      swatch.style.cursor = 'default';
    }
    grid.appendChild(swatch);
  }

  // 更新翻页按钮文字
  if (paletteMode === 'official' && totalPages > 1) {
    var btn = document.querySelector('.more-colors-btn');
    btn.textContent = '↻ ' + (currentPaletteIdx + 1) + '/' + totalPages;
    btn.title = '翻页 (' + totalPages + '页共' + palette.length + '色)';
  }
  updateColorUsageSummary();
}

function selectColor(color, swatchEl) {
  currentColor = color;
  currentTool = 'brush';
  document.getElementById('brushTool').classList.add('active');
  document.getElementById('eraserTool').classList.remove('active');
  document.getElementById('inspectTool').classList.remove('active');

  // 官方模式下显示色号
  var entry = (paletteMode === 'official') ? findPaletteEntry(color) : null;
  var code = entry ? paletteCode(entry) : '';
  var display = 'Brush' + (code ? ' · ' + code : '');
  updateColorDisplay(color, display);

  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  if (swatchEl) {
    swatchEl.classList.add('active');
  } else {
    const swatches = document.querySelectorAll('.color-swatch');
    const palette = getCurrentPaletteColors();
    const idx = palette.indexOf(color);
    if (idx >= 0 && swatches[idx]) swatches[idx].classList.add('active');
  }
}

function cyclePalette() {
  if (paletteMode === 'official') {
    var palette = getCurrentPaletteColors();
    var totalPages = Math.ceil(palette.length / PALETTE_SLOTS);
    currentPaletteIdx = (currentPaletteIdx + 1) % totalPages;
  }
  renderColorGrid();
  if (paletteMode === 'official') {
    var palette = getCurrentPaletteColors();
    var totalPages = Math.ceil(palette.length / PALETTE_SLOTS);
    showToast('色板 ' + (currentPaletteIdx + 1) + '/' + totalPages + ' (' + palette.length + '色)');
  } else {
    showToast('色板已刷新');
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
  } else if (e.key === 'b' || e.key === 'B') {
    setTool('brush');
  } else if (e.key === 'e' || e.key === 'E') {
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
