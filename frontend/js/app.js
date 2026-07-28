function getMinZoom() {
  return 20;
}

function updateZoomControlState() {
  var slider = document.getElementById('zoomSlider');
  if (!slider) return;
  slider.value = zoom;
  var min = parseFloat(slider.min) || 20;
  var max = parseFloat(slider.max) || 400;
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
  targetZoom = Math.max(20, Math.min(400, targetZoom));
  setZoom(targetZoom);
  showToast('画布已适应当前视口');
}

// --- 绘制工具 ---
function setTool(tool) {
  currentTool = 'brush';
  if (typeof setEyedropperActive === 'function') setEyedropperActive(false);
  if (typeof setMoveCanvasActive === 'function') setMoveCanvasActive(false);
  if (tool === 'eraser') {
    selectColor('#FFFFFF');
  }
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

// 点击弹窗外部关闭
document.addEventListener('click', function(e) {
  var exportDD = document.getElementById('exportDropdown');
  if (exportDD && exportDD.classList.contains('show') && !exportDD.contains(e.target)) {
    hideExportDropdown();
  }
});

// --- 色板与复刻面板 ---
function getCurrentPaletteColors() {
  return EXHIBITION_DATA.map(paletteHex);
}

// 感知色差 (人眼对G最敏感, 权重: R×2 G×4 B×3)
function colorDistRGB(r1, g1, b1, r2, g2, b2) {
  var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 2*dr*dr + 4*dg*dg + 3*db*db;
}

function findClosestPaletteColor(sourceHex) {
  var colors = getCurrentPaletteColors();
  if (!colors.length) return '#FFFFFF';

  var source = String(sourceHex || '').toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(source)) return colors[0].toUpperCase();
  var r = parseInt(source.slice(1, 3), 16);
  var g = parseInt(source.slice(3, 5), 16);
  var b = parseInt(source.slice(5, 7), 16);
  var closest = colors[0].toUpperCase();
  var closestDistance = Infinity;

  colors.forEach(function(color) {
    var hex = color.toUpperCase();
    var distance = colorDistRGB(
      r,
      g,
      b,
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    );
    if (distance < closestDistance) {
      closest = hex;
      closestDistance = distance;
    }
  });
  return closest;
}

function setEyedropperActive(active) {
  if (active && moveCanvasActive) setMoveCanvasActive(false);
  eyedropperActive = Boolean(active);
  var button = document.getElementById('eyedropperBtn');
  if (button) {
    button.classList.toggle('active', eyedropperActive);
    button.setAttribute('aria-pressed', String(eyedropperActive));
  }
  if (canvasContainer) {
    canvasContainer.classList.toggle('eyedropper-active', eyedropperActive);
  }
}

function toggleEyedropper() {
  setEyedropperActive(!eyedropperActive);
  showToast(eyedropperActive ? '吸管已启用：请选择画布格子' : '已取消吸管');
}

function setMoveCanvasActive(active) {
  if (active && eyedropperActive) setEyedropperActive(false);
  moveCanvasActive = Boolean(active);
  isDrawing = false;
  isPanning = false;

  var button = document.getElementById('moveCanvasBtn');
  if (button) {
    button.classList.toggle('active', moveCanvasActive);
    button.setAttribute('aria-pressed', String(moveCanvasActive));
    button.title = moveCanvasActive
      ? '退出移动画布模式（M）'
      : '切换移动画布模式（M）';
  }
  if (canvasContainer) {
    canvasContainer.classList.toggle(
      'move-canvas-active',
      moveCanvasActive
    );
    canvasContainer.classList.remove('panning');
  }
}

function toggleMoveCanvas() {
  setMoveCanvasActive(!moveCanvasActive);
  showToast(moveCanvasActive ? '移动画布已启用' : '已恢复画笔');
}

function focusPanelColor(selector, scrollId, color) {
  requestAnimationFrame(function() {
    var target = document.querySelector(selector + '[data-color="' + color + '"]');
    var scroller = document.getElementById(scrollId);
    if (!target || !scroller) return;
    requestAnimationFrame(function() {
      target.focus({ preventScroll: true });
      var targetRect = target.getBoundingClientRect();
      var scrollerRect = scroller.getBoundingClientRect();
      var centeredScrollTop = scroller.scrollTop +
        targetRect.top + targetRect.height / 2 -
        (scrollerRect.top + scrollerRect.height / 2);
      var maximumScrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight
      );
      scroller.scrollTop = Math.max(
        0,
        Math.min(centeredScrollTop, maximumScrollTop)
      );
    });
  });
}

function sampleCanvasColor(gx, gy) {
  if (!eyedropperActive) return false;
  if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return false;

  var sampledColor = String(pixelData[gy][gx]).toUpperCase();
  var matchedColor = findClosestPaletteColor(sampledColor);

  if (isStatisticsMode()) {
    replicationSelectionChanged = true;
    statisticsHighlightColor = matchedColor;
    currentColor = matchedColor;
    renderStatisticsPanel();
    renderStatisticsHighlightOverlay();
    focusPanelColor('.statistics-color', 'statisticsColorScroll', matchedColor);
  } else {
    selectColor(matchedColor);
    focusPanelColor('.color-swatch', 'paletteColorScroll', matchedColor);
  }

  setEyedropperActive(false);
  showToast(
    sampledColor === matchedColor
      ? '已选取 ' + matchedColor
      : '已匹配最近颜色：' + sampledColor + ' → ' + matchedColor
  );
  return true;
}

function isStatisticsMode() {
  return palettePanelMode === 'statistics';
}

function replicationWorkFingerprint() {
  try {
    return TourgridWorkCodec.packPixels(pixelData, EXHIBITION_DATA);
  } catch (error) {
    return null;
  }
}

function readReplicationProgressStore() {
  try {
    var parsed = JSON.parse(
      localStorage.getItem(REPLICATION_PROGRESS_STORAGE_KEY) || '{}'
    );
    if (!parsed || parsed.version !== 1 || !parsed.works) {
      return { version: 1, works: {} };
    }
    return parsed;
  } catch (error) {
    return { version: 1, works: {} };
  }
}

function writeReplicationProgressStore(store) {
  try {
    var entries = Object.keys(store.works).map(function(fingerprint) {
      return {
        fingerprint: fingerprint,
        updatedAt: Number(store.works[fingerprint].updatedAt) || 0
      };
    }).sort(function(a, b) {
      return b.updatedAt - a.updatedAt;
    });
    entries.slice(40).forEach(function(entry) {
      delete store.works[entry.fingerprint];
    });
    localStorage.setItem(
      REPLICATION_PROGRESS_STORAGE_KEY,
      JSON.stringify(store)
    );
  } catch (error) {
    // 复刻进度不应阻断编辑器的正常使用。
  }
}

function saveReplicationProgress() {
  var fingerprint = replicationWorkFingerprint();
  if (!fingerprint) return;
  var store = readReplicationProgressStore();
  if (replicationCompletedColors.size === 0) {
    delete store.works[fingerprint];
  } else {
    store.works[fingerprint] = {
      completedColors: Array.from(replicationCompletedColors),
      updatedAt: Date.now()
    };
  }
  writeReplicationProgressStore(store);
}

function restoreReplicationProgress() {
  var fingerprint = replicationWorkFingerprint();
  var store = readReplicationProgressStore();
  var saved = fingerprint ? store.works[fingerprint] : null;
  var paletteColors = new Set(
    EXHIBITION_DATA.map(function(entry) {
      return paletteHex(entry).toUpperCase();
    })
  );
  replicationCompletedColors = new Set(
    saved && Array.isArray(saved.completedColors)
      ? saved.completedColors.filter(function(color) {
          return typeof color === 'string' &&
            paletteColors.has(color.toUpperCase());
        }).map(function(color) { return color.toUpperCase(); })
      : []
  );
}

function invalidateReplicationProgress(notify) {
  if (replicationCompletedColors.size === 0) return false;
  var fingerprint = replicationWorkFingerprint();
  var store = readReplicationProgressStore();
  if (fingerprint) delete store.works[fingerprint];
  writeReplicationProgressStore(store);
  replicationCompletedColors.clear();
  if (notify) {
    showToast('画布内容已改变，当前作品的复刻进度已重置');
  }
  return true;
}

function getPaletteUsageEntries() {
  var counts = {};
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var color = String(pixelData[y][x]).toUpperCase();
      counts[color] = (counts[color] || 0) + 1;
    }
  }

  return EXHIBITION_DATA.map(function(entry, index) {
    var hex = paletteHex(entry).toUpperCase();
    return {
      hex: hex,
      count: counts[hex] || 0,
      paletteEntry: entry,
      paletteIndex: index
    };
  });
}

function sortStatisticsEntries(entries) {
  if (statisticsSortMode === 'palette-order') {
    return entries.slice().sort(function(a, b) {
      return a.paletteIndex - b.paletteIndex;
    });
  }

  return entries.slice().sort(function(a, b) {
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
  var completeControl = document.getElementById('replicationCompleteControl');
  var completeCheckbox = document.getElementById('replicationCompleteCheckbox');
  var completeLabel = document.getElementById('replicationCompleteLabel');
  var previewControl = document.getElementById('replicationPreviewControl');
  var targetViewButton = document.getElementById('replicationTargetViewBtn');
  var completedViewButton = document.getElementById('replicationCompletedViewBtn');
  var resetButton = document.getElementById('replicationResetBtn');
  var entries = sortStatisticsEntries(getPaletteUsageEntries());
  grid.innerHTML = '';

  entries.forEach(function(entry) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'statistics-color';
    item.style.background = entry.hex;
    item.dataset.color = entry.hex;
    item.title = entry.hex + ' · ' + entry.count + ' 格';
    var completed = replicationCompletedColors.has(entry.hex);
    item.setAttribute(
      'aria-label',
      '颜色 ' + entry.hex + '，使用 ' + entry.count + ' 格' +
        (completed ? '，已完成复刻' : '')
    );
    if (entry.hex === statisticsHighlightColor) item.classList.add('active');
    if (completed) item.classList.add('completed');

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
  var selectedEntry = entries.find(function(entry) {
    return entry.hex === statisticsHighlightColor;
  });
  completeControl.hidden = !selectedEntry;
  previewControl.hidden = Boolean(selectedEntry);
  targetViewButton.classList.toggle(
    'active',
    replicationPreviewMode === 'target'
  );
  completedViewButton.classList.toggle(
    'active',
    replicationPreviewMode === 'completed'
  );
  targetViewButton.setAttribute(
    'aria-pressed',
    String(replicationPreviewMode === 'target')
  );
  completedViewButton.setAttribute(
    'aria-pressed',
    String(replicationPreviewMode === 'completed')
  );
  resetButton.disabled = replicationCompletedColors.size === 0;
  if (selectedEntry) {
    var selectedCompleted = replicationCompletedColors.has(selectedEntry.hex);
    completeCheckbox.checked = selectedCompleted;
    completeCheckbox.disabled = selectedEntry.count === 0;
    completeControl.classList.toggle('disabled', selectedEntry.count === 0);
    completeLabel.textContent = selectedEntry.count === 0
      ? '该颜色没有需要复刻的格子'
      : '该颜色已在游戏内完成（' + selectedEntry.count + ' 格）';
    hint.textContent = selectedEntry.count === 0
      ? selectedEntry.hex + ' 在当前作品中未使用'
      : selectedCompleted
        ? '已完成 ' + selectedEntry.hex + '；取消勾选可重新核对'
        : '正在复刻 ' + selectedEntry.hex + ' · ' + selectedEntry.count + ' 格';
  } else {
    completeCheckbox.checked = false;
    completeCheckbox.disabled = false;
    completeControl.classList.remove('disabled');
    var completedCellCount = entries.reduce(function(total, entry) {
      return total + (
        replicationCompletedColors.has(entry.hex) ? entry.count : 0
      );
    }, 0);
    var usedColorCount = entries.filter(function(entry) {
      return entry.count > 0;
    }).length;
    var completedColorCount = entries.filter(function(entry) {
      return entry.count > 0 &&
        replicationCompletedColors.has(entry.hex);
    }).length;
    var progressText = completedColorCount + '/' + usedColorCount +
      ' 种颜色 · ' + completedCellCount + '/' +
      (GRID_SIZE * GRID_SIZE) + ' 格';
    hint.textContent = replicationPreviewMode === 'completed'
      ? '已拼图案 · ' + progressText
      : '目标图案 · 已完成 ' + progressText;
  }
}

function setStatisticsSortMode(mode) {
  if (!['count-desc', 'count-asc', 'palette-order'].includes(mode)) return;
  statisticsSortMode = mode;
  document.getElementById('statisticsSort').value = mode;

  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
  if (statisticsHighlightColor) {
    focusPanelColor(
      '.statistics-color',
      'statisticsColorScroll',
      statisticsHighlightColor
    );
  }
}

function selectStatisticsColor(color) {
  if (!isStatisticsMode()) return;
  replicationSelectionChanged = true;
  statisticsHighlightColor = statisticsHighlightColor === color ? null : color;
  currentColor = statisticsHighlightColor;
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function setReplicationColorCompleted(completed) {
  if (!isStatisticsMode() || !statisticsHighlightColor) return;
  var selectedEntry = getPaletteUsageEntries().find(function(entry) {
    return entry.hex === statisticsHighlightColor;
  });
  if (!selectedEntry || selectedEntry.count === 0) return;

  if (completed) {
    replicationCompletedColors.add(statisticsHighlightColor);
  } else {
    replicationCompletedColors.delete(statisticsHighlightColor);
  }
  saveReplicationProgress();
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function clearCurrentReplicationProgress() {
  if (replicationCompletedColors.size === 0) {
    showToast('当前作品还没有复刻进度');
    return;
  }
  if (!confirm('清空当前作品的全部复刻进度？此操作不会修改画布。')) {
    return;
  }
  invalidateReplicationProgress(false);
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
  showToast('已清空当前作品的复刻进度');
}

function setReplicationPreviewMode(mode) {
  if (!['target', 'completed'].includes(mode)) return;
  replicationPreviewMode = mode;
  statisticsHighlightColor = null;
  currentColor = null;
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function renderStatisticsHighlightOverlay() {
  var completedPreview = isStatisticsMode() &&
    !statisticsHighlightColor &&
    replicationPreviewMode === 'completed';
  if (
    !isStatisticsMode() ||
    (!statisticsHighlightColor && !completedPreview) ||
    (!canvasGuidesVisible && !completedPreview)
  ) {
    overlayCanvas.style.display = 'none';
    return;
  }

  var cellSize = BASE_CELL_SIZE * (zoom / 100);
  var canvasSize = GRID_SIZE * cellSize;
  overlayCanvas.width = canvasSize;
  overlayCanvas.height = canvasSize;
  overlayCanvas.style.display = 'block';
  overlayCtx.clearRect(0, 0, canvasSize, canvasSize);
  overlayCtx.fillStyle = completedPreview
    ? 'rgb(232, 236, 239)'
    : 'rgba(16, 18, 22, 0.72)';
  overlayCtx.fillRect(0, 0, canvasSize, canvasSize);
  overlayCtx.strokeStyle = '#72F5F2';
  overlayCtx.lineWidth = Math.max(1.5, Math.min(3, cellSize * 0.12));

  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var pixelColor = String(pixelData[y][x]).toUpperCase();
      var selected = !completedPreview &&
        pixelColor === statisticsHighlightColor;
      var completed = replicationCompletedColors.has(pixelColor);
      if (!selected && !completed) continue;
      var left = x * cellSize;
      var top = y * cellSize;
      overlayCtx.clearRect(left, top, cellSize, cellSize);
      if (
        completedPreview &&
        completed &&
        pixelColor === '#FFFFFF'
      ) {
        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(142, 149, 154, 0.6)';
        overlayCtx.lineWidth = Math.max(1, Math.min(1.5, cellSize * 0.08));
        overlayCtx.strokeRect(
          left + overlayCtx.lineWidth / 2,
          top + overlayCtx.lineWidth / 2,
          cellSize - overlayCtx.lineWidth,
          cellSize - overlayCtx.lineWidth
        );
        overlayCtx.restore();
      }
      if (selected && !completed) {
        overlayCtx.strokeRect(
          left + overlayCtx.lineWidth / 2,
          top + overlayCtx.lineWidth / 2,
          cellSize - overlayCtx.lineWidth,
          cellSize - overlayCtx.lineWidth
        );
      }
    }
  }
  drawCanvasCenterAxes(overlayCtx, canvasSize, canvasSize);
}

function setPalettePanelMode(mode) {
  if (mode !== 'palette' && mode !== 'statistics') return;
  var wasStatistics = isStatisticsMode();

  if (mode === 'statistics' && !wasStatistics) {
    paletteColorBeforeReplication = currentColor;
    replicationSelectionChanged = false;
    statisticsHighlightColor = null;
  } else if (mode === 'palette' && wasStatistics) {
    currentColor = replicationSelectionChanged
      ? statisticsHighlightColor
      : paletteColorBeforeReplication;
    paletteColorBeforeReplication = null;
    replicationSelectionChanged = false;
  }

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
    if (statisticsHighlightColor) {
      focusPanelColor(
        '.statistics-color',
        'statisticsColorScroll',
        statisticsHighlightColor
      );
    }
  } else {
    renderColorGrid();
    renderOverlay();
    if (currentColor) {
      focusPanelColor('.color-swatch', 'paletteColorScroll', currentColor);
    }
  }
}

// --- 闁款喚娲忚箛顐ｅ祹闁?---
var authorModalTrigger = null;
var announcementModalTrigger = null;
var ANNOUNCEMENT_SESSION_KEY = 'tourgrid-announcement-20260728';

function openAnnouncementOnEntry() {
  try {
    if (sessionStorage.getItem(ANNOUNCEMENT_SESSION_KEY) === 'shown') return;
    sessionStorage.setItem(ANNOUNCEMENT_SESSION_KEY, 'shown');
  } catch (_error) {
    // Storage may be unavailable in restricted browsing modes; still show it.
  }
  openAnnouncementModal();
}

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

function isShortcutInput(target) {
  return Boolean(
    target &&
    typeof target.closest === 'function' &&
    target.closest(
      'input, textarea, select, button, a[href], [contenteditable="true"]'
    )
  );
}

function hasShortcutModifier(e) {
  return e.ctrlKey || e.metaKey || e.altKey;
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    var workShareModal = document.getElementById('workShareModal');
    if (workShareModal && !workShareModal.hidden) {
      e.preventDefault();
      closeWorkShareModal();
      return;
    }
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
    if (eyedropperActive) {
      e.preventDefault();
      setEyedropperActive(false);
      showToast('已取消吸管');
      return;
    }
    if (moveCanvasActive) {
      e.preventDefault();
      setMoveCanvasActive(false);
      showToast('已恢复画笔');
      return;
    }
  }

  if (isShortcutInput(e.target)) return;

  if (e.code === 'KeyH' && !hasShortcutModifier(e)) {
    e.preventDefault();
    if (!temporaryPanKeyHeld) {
      temporaryPanKeyHeld = true;
      canvasContainer.classList.add('temporary-pan-active');
    }
    return;
  }

  var primaryModifier = e.ctrlKey || e.metaKey;
  var key = String(e.key || '').toLowerCase();
  if (primaryModifier && !e.altKey && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (primaryModifier && !e.altKey && key === 'y') {
    e.preventDefault();
    redo();
  } else if (!hasShortcutModifier(e) && key === 's') {
    e.preventDefault();
    manualSave();
  } else if (!isStatisticsMode() && !hasShortcutModifier(e) && key === 'b') {
    e.preventDefault();
    setTool('brush');
    showToast('已切换到画笔');
  } else if (!isStatisticsMode() && !hasShortcutModifier(e) && key === 'e') {
    e.preventDefault();
    setTool('eraser');
    showToast('已切换到白色橡皮');
  } else if (!isStatisticsMode() && !hasShortcutModifier(e) && key === 'i') {
    e.preventDefault();
    toggleEyedropper();
  } else if (!isStatisticsMode() && !hasShortcutModifier(e) && key === 'm') {
    e.preventDefault();
    toggleMoveCanvas();
  } else if (!hasShortcutModifier(e) && key === 'g') {
    e.preventDefault();
    toggleCanvasGuides();
  } else if (!hasShortcutModifier(e) && key === '0') {
    e.preventDefault();
    fitCanvasToViewport();
  }
}

function onKeyUp(e) {
  if (e.code === 'KeyH' && temporaryPanKeyHeld) {
    temporaryPanKeyHeld = false;
    isPanning = false;
    canvasContainer.classList.remove('temporary-pan-active', 'panning');
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

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function syncFullscreenControl() {
  var button = document.getElementById('mobileFullscreenBtn');
  if (!button) return;
  var active = Boolean(getFullscreenElement());
  button.classList.toggle('is-fullscreen', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
  button.title = active ? '退出全屏' : '进入全屏';
}

async function toggleFullscreen() {
  try {
    if (getFullscreenElement()) {
      var exitFullscreen =
        document.exitFullscreen || document.webkitExitFullscreen;
      if (!exitFullscreen) throw new Error('fullscreen-exit-unsupported');
      await exitFullscreen.call(document);
    } else {
      var root = document.documentElement;
      var requestFullscreen =
        root.requestFullscreen || root.webkitRequestFullscreen;
      if (!requestFullscreen) {
        showToast('当前浏览器不支持网页全屏，可尝试添加到主屏幕');
        return;
      }
      if (root.requestFullscreen) {
        try {
          await requestFullscreen.call(root, { navigationUI: 'hide' });
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          await requestFullscreen.call(root);
        }
      } else {
        await requestFullscreen.call(root);
      }
    }
  } catch (error) {
    showToast('无法切换全屏，请检查浏览器权限');
  } finally {
    syncFullscreenControl();
  }
}

document.addEventListener('fullscreenchange', syncFullscreenControl);
document.addEventListener('webkitfullscreenchange', syncFullscreenControl);

function bindStaticControls() {
  function on(id, eventName, handler) {
    var element = document.getElementById(id);
    if (element) element.addEventListener(eventName, handler);
  }

  on('authorInfoBtn', 'click', openAuthorModal);
  on('announcementBtn', 'click', openAnnouncementModal);
  on('mobileFullscreenBtn', 'click', toggleFullscreen);
  on('clearCanvasBtn', 'click', clearCanvas);
  on('manualCheckpointRestoreBtn', 'click', restoreManualCheckpoint);
  on('manualCheckpointSaveBtn', 'click', manualSave);
  on('topImportButton', 'click', function() {
    document.getElementById('importFileInput').click();
  });
  on('importFileInput', 'change', startImport);
  on('exportDropdownToggleBtn', 'click', toggleExportDropdown);

  on('overlayToggleBtn', 'click', toggleOverlay);
  on('overlayOpacity', 'input', function(event) {
    updateOverlayOpacity(event.currentTarget.value);
  });
  on('overlayOpacity', 'change', function() {
    saveToStorage(true);
  });
  on('zoomResetBtn', 'click', fitCanvasToViewport);
  on('zoomSlider', 'input', function(event) {
    setZoom(event.currentTarget.value);
  });

  on('canvasGuidesBtn', 'click', toggleCanvasGuides);
  on('undoBtn', 'click', undo);
  on('redoBtn', 'click', redo);
  on('eyedropperBtn', 'click', toggleEyedropper);
  on('moveCanvasBtn', 'click', toggleMoveCanvas);
  on('paletteTab', 'click', function() {
    setPalettePanelMode('palette');
  });
  on('statisticsTab', 'click', function() {
    setPalettePanelMode('statistics');
  });
  on('replicationCompleteCheckbox', 'change', function(event) {
    setReplicationColorCompleted(event.currentTarget.checked);
  });
  on('replicationTargetViewBtn', 'click', function() {
    setReplicationPreviewMode('target');
  });
  on('replicationCompletedViewBtn', 'click', function() {
    setReplicationPreviewMode('completed');
  });
  on('replicationResetBtn', 'click', clearCurrentReplicationProgress);
  on('statisticsSort', 'change', function(event) {
    setStatisticsSortMode(event.currentTarget.value);
  });

  on('workShareModal', 'click', closeWorkShareModalFromBackdrop);
  on('closeWorkShareModalBtn', 'click', closeWorkShareModal);
  on('publishWorkButton', 'click', publishCurrentWork);
  on('cancelPublishConfirmationButton', 'click', function() {
    cancelPublishConfirmation(false);
  });
  on('confirmPublishButton', 'click', confirmPublishCurrentWork);
  on('publishedWorkCode', 'click', copyPublishedWorkCode);
  on('publishedWorkLink', 'click', copyPublishedWorkLink);
  on('workCodeInput', 'keydown', function(event) {
    if (event.key === 'Enter') loadSharedWorkFromInput();
  });
  on('loadWorkButton', 'click', loadSharedWorkFromInput);
  on('checkpointAndLoadButton', 'click', checkpointAndLoadSharedWork);
  on('loadWithoutCheckpointButton', 'click', loadSharedWorkWithoutCheckpoint);
  on('cancelReadConfirmationButton', 'click', cancelReadReplaceConfirmation);
  on('announcementModal', 'click', closeAnnouncementModalFromBackdrop);
  on('closeAnnouncementModalBtn', 'click', closeAnnouncementModal);
  on('authorModal', 'click', closeAuthorModalFromBackdrop);
  on('closeAuthorModalBtn', 'click', closeAuthorModal);

  on('cropZoomSlider', 'input', function(event) {
    updateCropZoom(event.currentTarget.value);
  });
  on('conversionRetryBtn', 'click', confirmCrop);
  on('cancelCropBtn', 'click', cancelCrop);
  on('confirmCropBtn', 'click', confirmCrop);

  on('publishWorkMenuBtn', 'click', function() {
    openWorkShareModal('publish');
  });
  on('loadWorkMenuBtn', 'click', function() {
    openWorkShareModal('load');
  });
  on('exportRawPixelBtn', 'click', exportRawPixelImage);
  on('exportPixelPreviewBtn', 'click', exportPixelPreview);
  on('exportBeadBtn', 'click', exportBeadBlueprint);
}

// --- 启动 ---
function installTourgridTestApi() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('test') !== '1') return;

  var api = {
    isReady: true,
    getState: function() {
      return {
        gridSize: GRID_SIZE,
        pixels: pixelData.map(function(row) { return row.slice(); }),
        palette: getCurrentPaletteColors().map(function(color) {
          return String(color).toUpperCase();
        }),
        currentColor: currentColor,
        palettePanelMode: palettePanelMode,
        statisticsHighlightColor: statisticsHighlightColor,
        replicationCompletedColors: Array.from(replicationCompletedColors),
        replicationPreviewMode: replicationPreviewMode,
        undoDepth: undoStack.length,
        redoDepth: redoStack.length,
        maxUndo: MAX_UNDO,
        manualCheckpointExists: Boolean(loadManualCheckpoint()),
        reference: referenceSnapshotForHistory(),
        referenceLoaded: Boolean(importedPreviewImage),
        overlayVisible: overlayVisible,
        overlayOpacity: overlayOpacity,
        canvasGuidesVisible: canvasGuidesVisible,
        eyedropperActive: eyedropperActive,
        moveCanvasActive: moveCanvasActive,
        conversionInProgress: conversionInProgress,
        historyOperationInProgress: historyOperationInProgress
      };
    }
  };

  Object.defineProperty(window, '__TOURGRID_TEST__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(api)
  });
}

document.addEventListener('DOMContentLoaded', function() {
  bindStaticControls();
  init();
  installTourgridTestApi();
  loadSharedWorkFromQuery();
  openAnnouncementOnEntry();
});

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
