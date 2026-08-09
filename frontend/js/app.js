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
  if (moveCanvasActive && typeof clearCanvasCellHighlight === 'function') {
    clearCanvasCellHighlight();
  }

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

  if (isReplacementMode()) {
    selectReplacementColor(matchedColor);
    focusPanelColor(
      '.color-statistics-color',
      'replacementColorScroll',
      matchedColor
    );
  } else if (isReplicationMode()) {
    replicationSelectionChanged = true;
    replicationHighlightColor = matchedColor;
    currentColor = matchedColor;
    renderStatisticsPanel();
    renderStatisticsHighlightOverlay();
    focusPanelColor('.statistics-color', 'replicationColorScroll', matchedColor);
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

function isReplacementMode() {
  return workspacePanelMode === 'replacement';
}

function isReplicationMode() {
  return workspacePanelMode === 'replication';
}

function isReadOnlyPanelMode() {
  return isReplacementMode() || isReplicationMode();
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
    if (
      !parsed ||
      ![1, 2].includes(parsed.version) ||
      !parsed.works ||
      typeof parsed.works !== 'object'
    ) {
      return { version: 2, works: {} };
    }
    parsed.version = 2;
    return parsed;
  } catch (error) {
    return { version: 2, works: {} };
  }
}

function writeReplicationProgressStore(store) {
  try {
    store.version = 2;
    localStorage.setItem(
      REPLICATION_PROGRESS_STORAGE_KEY,
      JSON.stringify(store)
    );
  } catch (error) {
    // 复刻进度不应阻断编辑器的正常使用。
  }
}

function replicationCellIndex(x, y) {
  return y * GRID_SIZE + x;
}

function replicationCellCoordinates(index) {
  return {
    x: index % GRID_SIZE,
    y: Math.floor(index / GRID_SIZE)
  };
}

function isReplicationCellCompleted(x, y) {
  return replicationCompletedCells.has(replicationCellIndex(x, y));
}

function getReplicationColorCellIndices(color) {
  var normalized = String(color || '').toUpperCase();
  var indices = [];
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      if (String(pixelData[y][x]).toUpperCase() === normalized) {
        indices.push(replicationCellIndex(x, y));
      }
    }
  }
  return indices;
}

function isReplicationColorCompleted(color) {
  var indices = getReplicationColorCellIndices(color);
  return indices.length > 0 && indices.every(function(index) {
    return replicationCompletedCells.has(index);
  });
}

function getReplicationCompletedColors() {
  return getPaletteUsageEntries().filter(function(entry) {
    return entry.count > 0 && isReplicationColorCompleted(entry.hex);
  }).map(function(entry) {
    return entry.hex;
  });
}

function saveReplicationProgress(previousFingerprint) {
  var fingerprint = replicationWorkFingerprint();
  if (!fingerprint) return;
  var store = readReplicationProgressStore();
  if (previousFingerprint && previousFingerprint !== fingerprint) {
    delete store.works[previousFingerprint];
  }
  if (replicationCompletedCells.size === 0) {
    delete store.works[fingerprint];
  } else {
    store.works[fingerprint] = {
      completedCells: Array.from(replicationCompletedCells).sort(function(a, b) {
        return a - b;
      }),
      updatedAt: Date.now()
    };
  }
  writeReplicationProgressStore(store);
}

function restoreReplicationProgress() {
  var fingerprint = replicationWorkFingerprint();
  var store = readReplicationProgressStore();
  var saved = fingerprint ? store.works[fingerprint] : null;
  var migratedLegacyProgress = false;

  if (saved && Array.isArray(saved.completedCells)) {
    replicationCompletedCells = new Set(
      saved.completedCells.filter(function(index) {
        return Number.isInteger(index) &&
          index >= 0 &&
          index < GRID_SIZE * GRID_SIZE;
      })
    );
  } else if (saved && Array.isArray(saved.completedColors)) {
    var legacyColors = new Set(saved.completedColors.map(function(color) {
      return String(color).toUpperCase();
    }));
    replicationCompletedCells = new Set();
    for (var y = 0; y < GRID_SIZE; y++) {
      for (var x = 0; x < GRID_SIZE; x++) {
        if (legacyColors.has(String(pixelData[y][x]).toUpperCase())) {
          replicationCompletedCells.add(replicationCellIndex(x, y));
        }
      }
    }
    migratedLegacyProgress = true;
  } else {
    replicationCompletedCells = new Set();
  }

  replicationEditSourceFingerprint = null;
  replicationEditRemovedCellCount = 0;
  if (migratedLegacyProgress) saveReplicationProgress();
}

function invalidateReplicationProgress(notify) {
  if (replicationCompletedCells.size === 0) return false;
  var fingerprint = replicationWorkFingerprint();
  var store = readReplicationProgressStore();
  if (fingerprint) delete store.works[fingerprint];
  writeReplicationProgressStore(store);
  replicationCompletedCells.clear();
  replicationEditSourceFingerprint = null;
  replicationEditRemovedCellCount = 0;
  if (notify) {
    showToast('画布内容已改变，当前作品的复刻进度已重置');
  }
  return true;
}

function beginReplicationCanvasEdit() {
  if (
    replicationCompletedCells.size > 0 &&
    replicationEditSourceFingerprint === null
  ) {
    replicationEditSourceFingerprint = replicationWorkFingerprint();
    replicationEditRemovedCellCount = 0;
  }
}

function markReplicationCellChanged(x, y) {
  beginReplicationCanvasEdit();
  if (replicationCompletedCells.delete(replicationCellIndex(x, y))) {
    replicationEditRemovedCellCount++;
  }
}

function commitReplicationCanvasEdit(notify) {
  if (replicationEditSourceFingerprint === null) return false;
  var previousFingerprint = replicationEditSourceFingerprint;
  var removedCellCount = replicationEditRemovedCellCount;
  replicationEditSourceFingerprint = null;
  replicationEditRemovedCellCount = 0;
  saveReplicationProgress(previousFingerprint);
  if (notify && removedCellCount > 0) {
    showToast(
      '已将 ' + removedCellCount + ' 个发生颜色变化的格子恢复为未涂色'
    );
  }
  return true;
}

function reconcileReplicationProgress(previousPixels, previousFingerprint, notify) {
  if (replicationCompletedCells.size === 0) return false;
  var removedCellCount = 0;
  Array.from(replicationCompletedCells).forEach(function(index) {
    var cell = replicationCellCoordinates(index);
    if (
      !previousPixels[cell.y] ||
      previousPixels[cell.y][cell.x] !== pixelData[cell.y][cell.x]
    ) {
      replicationCompletedCells.delete(index);
      removedCellCount++;
    }
  });
  saveReplicationProgress(previousFingerprint);
  if (notify && removedCellCount > 0) {
    showToast(
      '已将 ' + removedCellCount + ' 个发生颜色变化的格子恢复为未涂色'
    );
  }
  return removedCellCount > 0;
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

function sortUsageEntries(entries, mode) {
  if (mode === 'palette-order') {
    return entries.slice().sort(function(a, b) {
      return a.paletteIndex - b.paletteIndex;
    });
  }

  return entries.slice().sort(function(a, b) {
    var countDifference = mode === 'count-asc'
      ? a.count - b.count
      : b.count - a.count;
    return countDifference || a.paletteIndex - b.paletteIndex;
  });
}

function findRelatedPaletteColors(sourceHex, limit) {
  var source = String(sourceHex || '').toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(source)) return [];
  var sourceR = parseInt(source.slice(1, 3), 16);
  var sourceG = parseInt(source.slice(3, 5), 16);
  var sourceB = parseInt(source.slice(5, 7), 16);

  return getPaletteUsageEntries()
    .filter(function(entry) {
      return entry.hex !== source;
    })
    .map(function(entry) {
      return {
        hex: entry.hex,
        paletteIndex: entry.paletteIndex,
        distance: colorDistRGB(
          sourceR,
          sourceG,
          sourceB,
          parseInt(entry.hex.slice(1, 3), 16),
          parseInt(entry.hex.slice(3, 5), 16),
          parseInt(entry.hex.slice(5, 7), 16)
        )
      };
    })
    .sort(function(a, b) {
      return a.distance - b.distance ||
        a.paletteIndex - b.paletteIndex;
    })
    .slice(0, Math.max(5, Math.min(8, limit || 7)))
    .map(function(entry) {
      return entry.hex;
    });
}

function refreshReplacementOrder(relatedSourceColor) {
  var baseEntries = sortUsageEntries(
    getPaletteUsageEntries(),
    replacementSortMode
  );
  var baseColors = baseEntries.map(function(entry) {
    return entry.hex;
  });
  var source = relatedSourceColor
    ? String(relatedSourceColor).toUpperCase()
    : null;

  replacementRelatedSourceColor = null;
  replacementRelatedColors = [];
  if (source && baseColors.indexOf(source) !== -1) {
    replacementRelatedSourceColor = source;
    replacementRelatedColors = findRelatedPaletteColors(source, 7);
  }

  var prioritized = replacementRelatedSourceColor
    ? [replacementRelatedSourceColor].concat(replacementRelatedColors)
    : [];
  var prioritizedSet = new Set(prioritized);
  replacementOrderedColors = prioritized.concat(
    baseColors.filter(function(color) {
      return !prioritizedSet.has(color);
    })
  );
}

function getReplacementEntriesInDisplayOrder() {
  var entries = getPaletteUsageEntries();
  var entryByColor = new Map(entries.map(function(entry) {
    return [entry.hex, entry];
  }));
  var validOrder =
    replacementOrderedColors.length === entries.length &&
    replacementOrderedColors.every(function(color) {
      return entryByColor.has(color);
    });
  if (!validOrder) refreshReplacementOrder();
  return replacementOrderedColors.map(function(color) {
    return entryByColor.get(color);
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
  reconcileReplacementSelection();
  if (isReplacementMode()) renderReplacementPanel();
  if (isReplicationMode()) renderStatisticsPanel();
}

function selectColor(color, swatchEl) {
  if (isReadOnlyPanelMode()) return;
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

function getReplacementSelectedCellCount() {
  var selectedCount = 0;
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      if (replacementSelectedColors.has(
        String(pixelData[y][x]).toUpperCase()
      )) {
        selectedCount++;
      }
    }
  }
  return selectedCount;
}

function reconcileReplacementSelection() {
  var usedColors = new Set();
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      usedColors.add(String(pixelData[y][x]).toUpperCase());
    }
  }
  Array.from(replacementSelectedColors).forEach(function(color) {
    if (!usedColors.has(color)) replacementSelectedColors.delete(color);
  });
  if (
    replacementTargetColor &&
    getCurrentPaletteColors().map(function(color) {
      return color.toUpperCase();
    }).indexOf(replacementTargetColor) === -1
  ) {
    replacementTargetColor = null;
  }
  if (replacementTargetMode && replacementSelectedColors.size === 0) {
    replacementTargetMode = false;
    replacementTargetColor = null;
  }
}

function selectReplacementColor(color) {
  if (!isReplacementMode()) return;
  var normalized = String(color).toUpperCase();
  if (replacementTargetMode) {
    replacementTargetColor =
      replacementTargetColor === normalized ? null : normalized;
  } else if (replacementSelectedColors.has(normalized)) {
    replacementSelectedColors.delete(normalized);
  } else {
    replacementSelectedColors.add(normalized);
  }
  renderReplacementPanel();
  renderStatisticsHighlightOverlay();
}

function beginReplacementTargetSelection() {
  if (!isReplacementMode() || replacementSelectedColors.size === 0) return;
  replacementTargetMode = true;
  replacementTargetColor = null;
  renderReplacementPanel();
  renderStatisticsHighlightOverlay();
}

function showReplacementRelatedColors() {
  if (
    !isReplacementMode() ||
    replacementTargetMode ||
    replacementSelectedColors.size !== 1
  ) {
    return;
  }
  var source = Array.from(replacementSelectedColors)[0];
  refreshReplacementOrder(source);
  renderReplacementPanel();
  renderStatisticsHighlightOverlay();
  var scroll = document.getElementById('replacementColorScroll');
  if (scroll) scroll.scrollTop = 0;
  showToast('已将 ' + source + ' 及其相关颜色置顶');
}

function cancelReplacementTargetSelection() {
  replacementTargetMode = false;
  replacementTargetColor = null;
  if (isReplacementMode()) renderReplacementPanel();
  renderStatisticsHighlightOverlay();
}

function confirmColorReplacement() {
  if (
    !isReplacementMode() ||
    !replacementTargetMode ||
    !replacementTargetColor ||
    replacementSelectedColors.size === 0
  ) {
    return;
  }

  var target = replacementTargetColor;
  var changedCount = 0;
  for (var countY = 0; countY < GRID_SIZE; countY++) {
    for (var countX = 0; countX < GRID_SIZE; countX++) {
      var countColor = String(pixelData[countY][countX]).toUpperCase();
      if (
        replacementSelectedColors.has(countColor) &&
        countColor !== target
      ) {
        changedCount++;
      }
    }
  }
  if (changedCount === 0) {
    showToast('当前选择不会改变画布');
    return;
  }

  var sourceColorCount = replacementSelectedColors.size;
  pushUndo();
  beginReplicationCanvasEdit();
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var color = String(pixelData[y][x]).toUpperCase();
      if (!replacementSelectedColors.has(color) || color === target) continue;
      markReplicationCellChanged(x, y);
      pixelData[y][x] = target;
    }
  }
  commitReplicationCanvasEdit(true);
  markSharedWorkAsEdited();
  replacementSelectedColors.clear();
  replacementTargetColor = null;
  replacementTargetMode = false;
  refreshReplacementOrder();
  renderCanvas();
  renderNavigator();
  renderColorGrid();
  saveToStorage(true);
  showToast(
    '已将 ' + sourceColorCount + ' 种颜色、' +
    changedCount + ' 格替换为 ' + target
  );
}

function renderReplacementPanel() {
  var grid = document.getElementById('replacementGrid');
  if (!grid) return;
  reconcileReplacementSelection();
  var entries = getReplacementEntriesInDisplayOrder();

  grid.innerHTML = '';
  entries.forEach(function(entry, index) {
    var item = document.createElement('button');
    var isSource = replacementSelectedColors.has(entry.hex);
    var isTarget = replacementTargetColor === entry.hex;
    item.type = 'button';
    item.className = 'color-statistics-color';
    item.style.background = entry.hex;
    item.dataset.color = entry.hex;
    item.setAttribute('aria-pressed', String(
      replacementTargetMode ? isTarget : isSource
    ));
    item.setAttribute(
      'aria-label',
      '颜色 ' + entry.hex + '，使用 ' + entry.count + ' 格' +
        (isSource ? '，已选为被替换颜色' : '') +
        (isTarget ? '，已选为目标颜色' : '')
    );
    if (isSource) item.classList.add('source-selected');
    if (isTarget) item.classList.add('replacement-target');
    if (isSource && isTarget) item.classList.add('source-and-target');

    var count = document.createElement('span');
    count.className = 'statistics-count';
    count.textContent = '×' + entry.count;
    item.appendChild(count);
    item.addEventListener('click', function() {
      selectReplacementColor(entry.hex);
    });
    grid.appendChild(item);
    if (replacementRelatedSourceColor && index === 7) {
      var divider = document.createElement('div');
      divider.className = 'replacement-related-divider';
      divider.setAttribute('aria-hidden', 'true');
      grid.appendChild(divider);
    }
  });

  var selectedCellCount = getReplacementSelectedCellCount();
  var summary = document.getElementById('replacementSelectionSummary');
  var hint = document.getElementById('replacementHint');
  var primaryActions = document.getElementById(
    'replacementPrimaryActions'
  );
  var relatedButton = document.getElementById('replacementRelatedBtn');
  var replaceButton = document.getElementById('replacementStartBtn');
  var confirmActions = document.getElementById(
    'replacementConfirmActions'
  );
  var confirmButton = document.getElementById('replacementConfirmBtn');
  summary.textContent =
    '已选择 ' + replacementSelectedColors.size +
    ' 种颜色 · 共 ' + selectedCellCount + ' 格';
  hint.textContent = replacementTargetMode
    ? (
        replacementTargetColor
          ? '目标颜色 ' + replacementTargetColor +
            ' · 确认后一次性替换'
          : '请选择一种目标颜色'
      )
    : '点击颜色或使用吸管，可多选需要替换的颜色';
  primaryActions.hidden = replacementTargetMode;
  relatedButton.disabled = replacementSelectedColors.size !== 1;
  replaceButton.disabled = replacementSelectedColors.size === 0;
  confirmActions.hidden = !replacementTargetMode;

  var effectiveChangeCount = 0;
  if (replacementTargetColor) {
    for (var y = 0; y < GRID_SIZE; y++) {
      for (var x = 0; x < GRID_SIZE; x++) {
        var color = String(pixelData[y][x]).toUpperCase();
        if (
          replacementSelectedColors.has(color) &&
          color !== replacementTargetColor
        ) {
          effectiveChangeCount++;
        }
      }
    }
  }
  confirmButton.disabled = !replacementTargetColor ||
    effectiveChangeCount === 0;
}

function renderStatisticsPanel() {
  var grid = document.getElementById('replicationGrid');
  var hint = document.getElementById('replicationHint');
  var completeControl = document.getElementById('replicationCompleteControl');
  var completeCheckbox = document.getElementById('replicationCompleteCheckbox');
  var completeLabel = document.getElementById('replicationCompleteLabel');
  var previewControl = document.getElementById('replicationPreviewControl');
  var targetViewButton = document.getElementById('replicationTargetViewBtn');
  var completedViewButton = document.getElementById('replicationCompletedViewBtn');
  var resetButton = document.getElementById('replicationResetBtn');
  var entries = sortUsageEntries(
    getPaletteUsageEntries(),
    replicationSortMode
  );
  grid.innerHTML = '';

  entries.forEach(function(entry) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'statistics-color';
    item.style.background = entry.hex;
    item.dataset.color = entry.hex;
    item.title = entry.hex + ' · ' + entry.count + ' 格';
    var completed = isReplicationColorCompleted(entry.hex);
    item.setAttribute(
      'aria-label',
      '颜色 ' + entry.hex + '，使用 ' + entry.count + ' 格' +
        (completed ? '，已完成复刻' : '')
    );
    if (entry.hex === replicationHighlightColor) item.classList.add('active');
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
    return entry.hex === replicationHighlightColor;
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
  resetButton.disabled = replicationCompletedCells.size === 0;
  if (selectedEntry) {
    var selectedCompleted = isReplicationColorCompleted(selectedEntry.hex);
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
    var completedCellCount = replicationCompletedCells.size;
    var usedColorCount = entries.filter(function(entry) {
      return entry.count > 0;
    }).length;
    var completedColorCount = entries.filter(function(entry) {
      return entry.count > 0 &&
        isReplicationColorCompleted(entry.hex);
    }).length;
    var progressText = completedColorCount + '/' + usedColorCount +
      ' 种颜色 · ' + completedCellCount + '/' +
      (GRID_SIZE * GRID_SIZE) + ' 格';
    hint.textContent = replicationPreviewMode === 'completed'
      ? '已拼图案 · ' + progressText
      : '目标图案 · 已完成 ' + progressText;
  }
}

function setReplacementSortMode(mode) {
  if (!['count-desc', 'count-asc', 'palette-order'].includes(mode)) return;
  replacementSortMode = mode;
  document.getElementById('replacementSort').value = mode;
  refreshReplacementOrder();
  renderReplacementPanel();
  renderStatisticsHighlightOverlay();
  var focusColor = replacementTargetColor ||
    Array.from(replacementSelectedColors)[0];
  if (focusColor) {
    focusPanelColor(
      '.color-statistics-color',
      'replacementColorScroll',
      focusColor
    );
  }
}

function setReplicationSortMode(mode) {
  if (!['count-desc', 'count-asc', 'palette-order'].includes(mode)) return;
  replicationSortMode = mode;
  document.getElementById('replicationSort').value = mode;

  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
  if (replicationHighlightColor) {
    focusPanelColor(
      '.statistics-color',
      'replicationColorScroll',
      replicationHighlightColor
    );
  }
}

function selectStatisticsColor(color) {
  if (!isReplicationMode()) return;
  replicationSelectionChanged = true;
  replicationHighlightColor = replicationHighlightColor === color ? null : color;
  currentColor = replicationHighlightColor;
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function setReplicationColorCompleted(completed) {
  if (!isReplicationMode() || !replicationHighlightColor) return;
  var selectedEntry = getPaletteUsageEntries().find(function(entry) {
    return entry.hex === replicationHighlightColor;
  });
  if (!selectedEntry || selectedEntry.count === 0) return;

  getReplicationColorCellIndices(replicationHighlightColor).forEach(
    function(index) {
      if (completed) replicationCompletedCells.add(index);
      else replicationCompletedCells.delete(index);
    }
  );
  saveReplicationProgress();
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function markReplicationCellCompleted(x, y) {
  if (!isReplicationMode() || !replicationHighlightColor) return false;
  if (
    x < 0 || x >= GRID_SIZE ||
    y < 0 || y >= GRID_SIZE ||
    String(pixelData[y][x]).toUpperCase() !== replicationHighlightColor ||
    isReplicationCellCompleted(x, y)
  ) {
    return false;
  }

  replicationCompletedCells.add(replicationCellIndex(x, y));
  replicationMarkingChanged = true;
  renderStatisticsHighlightOverlay();
  return true;
}

function commitReplicationCellMarking() {
  if (!replicationMarkingChanged) return false;
  replicationMarkingChanged = false;
  saveReplicationProgress();
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
  return true;
}

function clearCurrentReplicationProgress() {
  if (replicationCompletedCells.size === 0) {
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
  replicationHighlightColor = null;
  currentColor = null;
  renderStatisticsPanel();
  renderStatisticsHighlightOverlay();
}

function renderStatisticsHighlightOverlay() {
  if (isReplacementMode()) {
    renderReplacementHighlightOverlay();
    return;
  }

  var completedPreview = isReplicationMode() &&
    !replicationHighlightColor &&
    replicationPreviewMode === 'completed';
  if (
    !isReplicationMode() ||
    (!replicationHighlightColor && !completedPreview) ||
    (!canvasGuidesVisible && !completedPreview)
  ) {
    statisticsOverlayCanvas.style.display = 'none';
    return;
  }

  var cellSize = BASE_CELL_SIZE * (zoom / 100);
  var canvasSize = GRID_SIZE * cellSize;
  statisticsOverlayCanvas.width = canvasSize;
  statisticsOverlayCanvas.height = canvasSize;
  statisticsOverlayCanvas.style.display = 'block';
  statisticsOverlayCtx.clearRect(0, 0, canvasSize, canvasSize);
  statisticsOverlayCtx.fillStyle = completedPreview
    ? 'rgb(232, 236, 239)'
    : 'rgba(16, 18, 22, 0.72)';
  statisticsOverlayCtx.fillRect(0, 0, canvasSize, canvasSize);
  statisticsOverlayCtx.strokeStyle = '#72F5F2';
  statisticsOverlayCtx.lineWidth = Math.max(
    1.5,
    Math.min(3, cellSize * 0.12)
  );

  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var pixelColor = String(pixelData[y][x]).toUpperCase();
      var selected = !completedPreview &&
        pixelColor === replicationHighlightColor;
      var completed = isReplicationCellCompleted(x, y);
      if (!selected && !completed) continue;
      var left = x * cellSize;
      var top = y * cellSize;
      statisticsOverlayCtx.clearRect(left, top, cellSize, cellSize);
      if (
        completedPreview &&
        completed &&
        pixelColor === '#FFFFFF'
      ) {
        statisticsOverlayCtx.save();
        statisticsOverlayCtx.strokeStyle = 'rgba(142, 149, 154, 0.6)';
        statisticsOverlayCtx.lineWidth = Math.max(
          1,
          Math.min(1.5, cellSize * 0.08)
        );
        statisticsOverlayCtx.strokeRect(
          left + statisticsOverlayCtx.lineWidth / 2,
          top + statisticsOverlayCtx.lineWidth / 2,
          cellSize - statisticsOverlayCtx.lineWidth,
          cellSize - statisticsOverlayCtx.lineWidth
        );
        statisticsOverlayCtx.restore();
      }
      if (selected && !completed) {
        statisticsOverlayCtx.strokeRect(
          left + statisticsOverlayCtx.lineWidth / 2,
          top + statisticsOverlayCtx.lineWidth / 2,
          cellSize - statisticsOverlayCtx.lineWidth,
          cellSize - statisticsOverlayCtx.lineWidth
        );
      }
    }
  }
  drawCanvasCenterAxes(
    statisticsOverlayCtx,
    canvasSize,
    canvasSize
  );
}

function renderReplacementHighlightOverlay() {
  reconcileReplacementSelection();
  var hasSources = replacementSelectedColors.size > 0;
  var hasTarget = replacementTargetMode &&
    Boolean(replacementTargetColor);
  if (!hasSources && !hasTarget) {
    statisticsOverlayCanvas.style.display = 'none';
    return;
  }

  var cellSize = BASE_CELL_SIZE * (zoom / 100);
  var canvasSize = GRID_SIZE * cellSize;
  var sourceLineWidth = Math.max(1.5, Math.min(3, cellSize * 0.12));
  statisticsOverlayCanvas.width = canvasSize;
  statisticsOverlayCanvas.height = canvasSize;
  statisticsOverlayCanvas.style.display = 'block';
  statisticsOverlayCtx.clearRect(0, 0, canvasSize, canvasSize);

  if (hasTarget) {
    for (var previewY = 0; previewY < GRID_SIZE; previewY++) {
      for (var previewX = 0; previewX < GRID_SIZE; previewX++) {
        var previewColor = String(
          pixelData[previewY][previewX]
        ).toUpperCase();
        if (!replacementSelectedColors.has(previewColor)) continue;
        statisticsOverlayCtx.fillStyle = replacementTargetColor;
        statisticsOverlayCtx.fillRect(
          previewX * cellSize,
          previewY * cellSize,
          cellSize,
          cellSize
        );
      }
    }
    drawCanvasCenterAxes(
      statisticsOverlayCtx,
      canvasSize,
      canvasSize
    );
    return;
  }

  statisticsOverlayCtx.fillStyle = 'rgba(16, 18, 22, 0.18)';
  statisticsOverlayCtx.fillRect(0, 0, canvasSize, canvasSize);

  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var pixelColor = String(pixelData[y][x]).toUpperCase();
      var sourceSelected = replacementSelectedColors.has(pixelColor);
      if (!sourceSelected) continue;

      var left = x * cellSize;
      var top = y * cellSize;
      statisticsOverlayCtx.clearRect(left, top, cellSize, cellSize);
      if (sourceSelected) {
        var sourceInset = sourceLineWidth / 2;
        statisticsOverlayCtx.save();
        statisticsOverlayCtx.strokeStyle = '#72F5F2';
        statisticsOverlayCtx.lineWidth = sourceLineWidth;
        statisticsOverlayCtx.strokeRect(
          left + sourceInset,
          top + sourceInset,
          cellSize - sourceInset * 2,
          cellSize - sourceInset * 2
        );
        statisticsOverlayCtx.restore();
      }
    }
  }
  drawCanvasCenterAxes(
    statisticsOverlayCtx,
    canvasSize,
    canvasSize
  );
}

function setWorkspacePanelMode(mode) {
  if (
    mode !== 'coloring' &&
    mode !== 'replacement' &&
    mode !== 'replication'
  ) {
    return;
  }
  var wasReplication = isReplicationMode();
  var wasReplacement = isReplacementMode();

  if (mode === 'replication' && !wasReplication) {
    colorBeforeReplication = currentColor;
    replicationSelectionChanged = false;
    replicationHighlightColor = null;
  } else if (mode !== 'replication' && wasReplication) {
    currentColor = replicationSelectionChanged
      ? replicationHighlightColor
      : colorBeforeReplication;
    colorBeforeReplication = null;
    replicationSelectionChanged = false;
  }
  if (wasReplacement && mode !== 'replacement') {
    replacementTargetMode = false;
    replacementTargetColor = null;
  }

  workspacePanelMode = mode;

  var coloringTab = document.getElementById('coloringTab');
  var replacementTab = document.getElementById('replacementTab');
  var replicationTab = document.getElementById('replicationTab');
  var coloringView = document.getElementById('coloringPanelView');
  var replacementView = document.getElementById('replacementPanelView');
  var replicationView = document.getElementById('replicationPanelView');
  var readOnly = isReadOnlyPanelMode();

  coloringTab.classList.toggle('active', mode === 'coloring');
  replacementTab.classList.toggle('active', mode === 'replacement');
  replicationTab.classList.toggle('active', mode === 'replication');
  coloringTab.setAttribute('aria-selected', String(mode === 'coloring'));
  replacementTab.setAttribute(
    'aria-selected',
    String(mode === 'replacement')
  );
  replicationTab.setAttribute(
    'aria-selected',
    String(mode === 'replication')
  );
  coloringView.hidden = mode !== 'coloring';
  replacementView.hidden = mode !== 'replacement';
  replicationView.hidden = mode !== 'replication';

  document.getElementById('undoBtn').disabled = isReplicationMode();
  document.getElementById('redoBtn').disabled = isReplicationMode();
  canvasContainer.classList.toggle('statistics-readonly', readOnly);

  if (isReplicationMode()) {
    isDrawing = false;
    clearCanvasCellHighlight();
    renderStatisticsPanel();
    renderStatisticsHighlightOverlay();
    if (replicationHighlightColor) {
      focusPanelColor(
        '.statistics-color',
        'replicationColorScroll',
        replicationHighlightColor
      );
    }
  } else if (isReplacementMode()) {
    isDrawing = false;
    clearCanvasCellHighlight();
    reconcileReplacementSelection();
    renderReplacementPanel();
    renderStatisticsHighlightOverlay();
  } else {
    renderColorGrid();
    renderOverlay();
    renderStatisticsHighlightOverlay();
    if (currentColor) {
      focusPanelColor('.color-swatch', 'paletteColorScroll', currentColor);
    }
  }
}

var authorModalTrigger = null;
var announcementModalTrigger = null;
var ANNOUNCEMENT_SESSION_KEY = 'tourgrid-announcement-20260728';
var FEATURED_LIKES_SESSION_KEY = 'tourgrid-featured-likes-v1';
var featuredWorksLoaded = false;
var featuredWorksLoading = false;
var featuredLikedCodes = loadFeaturedLikedCodes();

function loadFeaturedLikedCodes() {
  try {
    var values = JSON.parse(sessionStorage.getItem(FEATURED_LIKES_SESSION_KEY) || '[]');
    return new Set(Array.isArray(values) ? values : []);
  } catch (_error) {
    return new Set();
  }
}

function rememberFeaturedLike(code) {
  featuredLikedCodes.add(code);
  try {
    sessionStorage.setItem(
      FEATURED_LIKES_SESSION_KEY,
      JSON.stringify(Array.from(featuredLikedCodes))
    );
  } catch (_error) {
    // The server-side Redis claim remains authoritative when storage is blocked.
  }
}

function createFeaturedHeartIcon() {
  var namespace = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  var path = document.createElementNS(namespace, 'path');
  path.setAttribute(
    'd',
    'M12 21s-7-4.35-9.5-8.5C.5 8.5 3 4 7.5 4c2.1 0 3.5 1.2 4.5 2.6C13 5.2 14.4 4 16.5 4 21 4 23.5 8.5 21.5 12.5 19 16.65 12 21 12 21z'
  );
  svg.appendChild(path);
  return svg;
}

function setFeaturedLikeButtonState(button, liked) {
  button.classList.toggle('liked', liked);
  button.disabled = liked;
  button.setAttribute('aria-pressed', String(liked));
  button.title = liked ? '本次会话已点赞' : '为作品增加1点热度';
}

function likeFeaturedWork(work, button, views) {
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('pending');
  fetch(
    API_BASE_URL + '/api/v1/works/' + encodeURIComponent(work.code) + '/like',
    { method: 'POST' }
  ).then(function(response) {
    return response.json().then(function(body) {
      if (!response.ok) throw new Error(apiErrorMessage(response, body));
      return body;
    });
  }).then(function(body) {
    work.viewCount = Math.max(0, Number(body.viewCount) || 0);
    views.textContent = '浏览 ' + work.viewCount;
    rememberFeaturedLike(work.code);
    setFeaturedLikeButtonState(button, true);
    showToast(body.counted ? '点赞成功' : '近期已经为该作品点赞');
  }).catch(function(error) {
    button.disabled = false;
    showToast(error.message || '点赞失败，请稍后重试');
  }).finally(function() {
    button.classList.remove('pending');
  });
}

function switchDiscoverTab(name) {
  document.querySelectorAll('[data-discover-tab]').forEach(function(tab) {
    var selected = tab.dataset.discoverTab === name;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-discover-panel]').forEach(function(panel) {
    panel.hidden = panel.dataset.discoverPanel !== name;
  });
  if (name === 'featured') loadFeaturedWorks();
}

function drawFeaturedWork(canvas, work) {
  var pixels = TourgridWorkCodec.unpackPixels(work.pixels, EXHIBITION_DATA);
  var context = canvas.getContext('2d');
  var cellSize = canvas.width / GRID_SIZE;
  context.imageSmoothingEnabled = false;
  pixels.forEach(function(row, y) {
    row.forEach(function(color, x) {
      context.fillStyle = color;
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    });
  });
}

function openFeaturedWork(code) {
  closeAnnouncementModal();
  openWorkShareModal('load');
  var input = document.getElementById('workCodeInput');
  input.value = code;
  loadSharedWorkFromInput();
}

function renderFeaturedWorks(works) {
  var grid = document.getElementById('featuredWorksGrid');
  var empty = document.getElementById('featuredWorksEmpty');
  var status = document.getElementById('featuredWorksStatus');
  grid.replaceChildren();
  empty.hidden = works.length !== 0;
  status.textContent = '';
  status.classList.remove('error');

  works.forEach(function(work) {
    if (
      work.schemaVersion !== 1 ||
      work.paletteId !== DEFAULT_PALETTE_ID ||
      work.paletteVersion !== DEFAULT_PALETTE_VERSION
    ) return;
    var card = document.createElement('article');
    card.className = 'featured-work-card';
    var canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    canvas.setAttribute('aria-label', (work.title || '推荐作品') + ' 像素预览');
    try {
      drawFeaturedWork(canvas, work);
    } catch (_error) {
      return;
    }
    card.appendChild(canvas);
    var title = document.createElement('div');
    title.className = 'featured-work-title';
    title.textContent = work.title || '未命名作品';
    card.appendChild(title);
    var metadata = document.createElement('div');
    metadata.className = 'featured-work-metadata';
    var author = document.createElement('div');
    author.className = 'featured-work-author';
    author.textContent = '作者：' + (work.authorName || '未署名');
    metadata.appendChild(author);
    var views = document.createElement('div');
    views.className = 'featured-work-views';
    views.textContent = '浏览 ' + Math.max(0, Number(work.viewCount) || 0);
    metadata.appendChild(views);
    card.appendChild(metadata);
    var actions = document.createElement('div');
    actions.className = 'featured-work-actions';
    var readButton = document.createElement('button');
    readButton.type = 'button';
    readButton.className = 'featured-work-action featured-work-read';
    readButton.textContent = '读取作品';
    readButton.addEventListener('click', function() { openFeaturedWork(work.code); });
    actions.appendChild(readButton);
    var likeButton = document.createElement('button');
    likeButton.type = 'button';
    likeButton.className = 'featured-work-action featured-work-like';
    likeButton.appendChild(createFeaturedHeartIcon());
    var likeLabel = document.createElement('span');
    likeLabel.textContent = '点赞';
    likeButton.appendChild(likeLabel);
    setFeaturedLikeButtonState(likeButton, featuredLikedCodes.has(work.code));
    likeButton.addEventListener('click', function() {
      likeFeaturedWork(work, likeButton, views);
    });
    actions.appendChild(likeButton);
    card.appendChild(actions);
    grid.appendChild(card);
  });
  empty.hidden = grid.childElementCount !== 0;
}

function loadFeaturedWorks() {
  if (featuredWorksLoaded || featuredWorksLoading) return;
  var status = document.getElementById('featuredWorksStatus');
  if (!status) return;
  featuredWorksLoading = true;
  status.textContent = '正在读取推荐作品…';
  status.classList.remove('error');
  fetch(API_BASE_URL + '/api/v1/featured-works')
    .then(function(response) {
      return response.json().then(function(body) {
        if (!response.ok) throw new Error(apiErrorMessage(response, body));
        return body;
      });
    })
    .then(function(body) {
      featuredWorksLoaded = true;
      renderFeaturedWorks(Array.isArray(body.works) ? body.works : []);
    })
    .catch(function(error) {
      status.textContent = error.message || '推荐作品暂时无法读取。';
      status.classList.add('error');
    })
    .finally(function() {
      featuredWorksLoading = false;
    });
}

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
  switchDiscoverTab('featured');
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
    if (
      workShareModal &&
      !workShareModal.hidden &&
      workShareModal.classList.contains('show')
    ) {
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
    if (closeMobileWorkspaceDrawers()) {
      e.preventDefault();
      return;
    }
    if (
      mobileWorkspaceModeActive &&
      document.body.classList.contains('mobile-toolbar-collapsed')
    ) {
      e.preventDefault();
      setMobileToolbarCollapsed(false);
      return;
    }
  }

  if (isShortcutInput(e.target)) return;

  if (e.code === 'KeyH' && !hasShortcutModifier(e)) {
    e.preventDefault();
    if (!temporaryPanKeyHeld) {
      temporaryPanKeyHeld = true;
      clearCanvasCellHighlight();
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
  } else if (!isReadOnlyPanelMode() && !hasShortcutModifier(e) && key === 'b') {
    e.preventDefault();
    setTool('brush');
    showToast('已切换到画笔');
  } else if (!isReadOnlyPanelMode() && !hasShortcutModifier(e) && key === 'e') {
    e.preventDefault();
    setTool('eraser');
    showToast('已切换到白色橡皮');
  } else if (!hasShortcutModifier(e) && key === 'i') {
    e.preventDefault();
    toggleEyedropper();
  } else if (!isReadOnlyPanelMode() && !hasShortcutModifier(e) && key === 'm') {
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

function isFullscreenSupported() {
  var root = document.documentElement;
  if (!root || !(root.requestFullscreen || root.webkitRequestFullscreen)) {
    return false;
  }
  if ('fullscreenEnabled' in document && document.fullscreenEnabled === false) {
    return false;
  }
  if (
    'webkitFullscreenEnabled' in document &&
    document.webkitFullscreenEnabled === false
  ) {
    return false;
  }
  return true;
}

function syncFullscreenControl() {
  var button = document.getElementById('mobileFullscreenBtn');
  if (!button) return;
  var supported = isFullscreenSupported();
  button.hidden = !supported;
  if (!supported) {
    button.classList.remove('is-fullscreen');
    button.setAttribute('aria-pressed', 'false');
    return;
  }
  var active = Boolean(getFullscreenElement());
  button.classList.toggle('is-fullscreen', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
  button.title = active ? '退出全屏' : '进入全屏';
}

async function toggleFullscreen() {
  try {
    if (!isFullscreenSupported()) {
      syncFullscreenControl();
      return;
    }
    if (getFullscreenElement()) {
      var exitFullscreen =
        document.exitFullscreen || document.webkitExitFullscreen;
      if (!exitFullscreen) throw new Error('fullscreen-exit-unsupported');
      await exitFullscreen.call(document);
    } else {
      var root = document.documentElement;
      var requestFullscreen =
        root.requestFullscreen || root.webkitRequestFullscreen;
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

var mobileWorkspaceModeActive = false;
var mobileWorkspaceGesture = null;
var MOBILE_WORKSPACE_MODE_KEY = 'tourgrid.mobileWorkspaceMode';
var MOBILE_WORKSPACE_SWIPE_THRESHOLD = 40;
var MOBILE_TOOLBAR_HANDLE_POSITION_KEY =
  'tourgrid.mobileToolbarHandlePosition';
var MOBILE_TOOLBAR_HANDLE_DRAG_THRESHOLD = 5;
var mobileToolbarHandlePosition = 0.5;
var mobileToolbarHandlePositionLoaded = false;
var mobileToolbarHandleDrag = null;
var suppressMobileToolbarHandleClick = false;

function restoreMobileToolbarHandlePosition() {
  if (mobileToolbarHandlePositionLoaded) return;
  mobileToolbarHandlePositionLoaded = true;
  try {
    var storedValue = sessionStorage.getItem(
      MOBILE_TOOLBAR_HANDLE_POSITION_KEY
    );
    if (storedValue !== null) {
      var stored = Number(storedValue);
      if (Number.isFinite(stored)) {
        mobileToolbarHandlePosition = Math.max(0, Math.min(1, stored));
      }
    }
  } catch (error) {
    mobileToolbarHandlePosition = 0.5;
  }
}

function getMobileToolbarHandleBounds() {
  var editorBody = document.querySelector('.editor-body');
  var handle = document.getElementById('mobileToolbarHandle');
  var visibleCenter = document.getElementById('centerPanel');
  if (!editorBody || !handle || !visibleCenter) return null;
  var bodyRect = editorBody.getBoundingClientRect();
  var centerRect = visibleCenter.getBoundingClientRect();
  var halfWidth = handle.offsetWidth / 2;
  var padding = 6;
  var minimum =
    centerRect.left - bodyRect.left + halfWidth + padding;
  var maximum =
    centerRect.right - bodyRect.left - halfWidth - padding;
  if (maximum < minimum) {
    var midpoint = (minimum + maximum) / 2;
    minimum = midpoint;
    maximum = midpoint;
  }
  return {
    minimum: minimum,
    maximum: maximum
  };
}

function syncMobileToolbarHandlePosition() {
  if (
    !mobileWorkspaceModeActive ||
    !document.body.classList.contains('mobile-toolbar-collapsed')
  ) {
    return;
  }
  restoreMobileToolbarHandlePosition();
  var handle = document.getElementById('mobileToolbarHandle');
  var bounds = getMobileToolbarHandleBounds();
  if (!handle || !bounds) return;
  var left = bounds.minimum +
    (bounds.maximum - bounds.minimum) * mobileToolbarHandlePosition;
  handle.style.left = left + 'px';
}

function persistMobileToolbarHandlePosition() {
  try {
    sessionStorage.setItem(
      MOBILE_TOOLBAR_HANDLE_POSITION_KEY,
      String(mobileToolbarHandlePosition)
    );
  } catch (error) {
    // The handle still remains draggable for the current layout.
  }
}

function onMobileToolbarHandlePointerDown(event) {
  if (
    !mobileWorkspaceModeActive ||
    !document.body.classList.contains('mobile-toolbar-collapsed') ||
    (typeof event.button === 'number' && event.button !== 0)
  ) {
    return;
  }
  var handle = event.currentTarget;
  var editorBody = document.querySelector('.editor-body');
  if (!editorBody) return;
  var bodyRect = editorBody.getBoundingClientRect();
  var handleRect = handle.getBoundingClientRect();
  mobileToolbarHandleDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startLeft: handleRect.left - bodyRect.left + handleRect.width / 2,
    dragged: false
  };
  suppressMobileToolbarHandleClick = false;
  if (handle.setPointerCapture) {
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (error) {
      // Synthetic pointer events may not own an active pointer.
    }
  }
  event.preventDefault();
  event.stopPropagation();
}

function onMobileToolbarHandlePointerMove(event) {
  if (
    !mobileToolbarHandleDrag ||
    mobileToolbarHandleDrag.pointerId !== event.pointerId
  ) {
    return;
  }
  var deltaX = event.clientX - mobileToolbarHandleDrag.startX;
  if (Math.abs(deltaX) >= MOBILE_TOOLBAR_HANDLE_DRAG_THRESHOLD) {
    mobileToolbarHandleDrag.dragged = true;
  }
  if (!mobileToolbarHandleDrag.dragged) return;
  var bounds = getMobileToolbarHandleBounds();
  if (!bounds) return;
  var left = Math.max(
    bounds.minimum,
    Math.min(bounds.maximum, mobileToolbarHandleDrag.startLeft + deltaX)
  );
  var span = bounds.maximum - bounds.minimum;
  mobileToolbarHandlePosition = span > 0
    ? (left - bounds.minimum) / span
    : 0.5;
  event.currentTarget.style.left = left + 'px';
  event.preventDefault();
  event.stopPropagation();
}

function finishMobileToolbarHandleDrag(event) {
  if (
    !mobileToolbarHandleDrag ||
    mobileToolbarHandleDrag.pointerId !== event.pointerId
  ) {
    return;
  }
  var dragged = mobileToolbarHandleDrag.dragged;
  mobileToolbarHandleDrag = null;
  if (
    event.currentTarget.hasPointerCapture &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (dragged) {
    suppressMobileToolbarHandleClick = true;
    persistMobileToolbarHandlePosition();
  }
  event.preventDefault();
  event.stopPropagation();
}

function onMobileToolbarHandleClick(event) {
  if (suppressMobileToolbarHandleClick) {
    suppressMobileToolbarHandleClick = false;
    event.preventDefault();
    return;
  }
  toggleMobileToolbar();
}

function scheduleMobileWorkspaceLayoutSync() {
  window.requestAnimationFrame(function() {
    updateNavigatorViewport();
    syncMobileToolbarHandlePosition();
  });
  window.setTimeout(function() {
    updateNavigatorViewport();
    syncMobileToolbarHandlePosition();
  }, 220);
}

function syncMobileWorkspaceControls() {
  var modeButton = document.getElementById('mobileWorkspaceModeBtn');
  var toolbarCollapseButton = document.getElementById(
    'mobileToolbarCollapseBtn'
  );
  var toolbarHandle = document.getElementById('mobileToolbarHandle');
  var leftButton = document.getElementById('mobileLeftPanelBtn');
  var rightButton = document.getElementById('mobileRightPanelBtn');
  var body = document.body;
  var toolbarCollapsed = body.classList.contains('mobile-toolbar-collapsed');
  var leftOpen = body.classList.contains('mobile-left-drawer-open');
  var rightOpen = body.classList.contains('mobile-right-drawer-open');

  if (modeButton) {
    modeButton.classList.toggle('is-focus-mode', mobileWorkspaceModeActive);
    modeButton.setAttribute(
      'aria-pressed',
      mobileWorkspaceModeActive ? 'true' : 'false'
    );
    modeButton.setAttribute(
      'aria-label',
      mobileWorkspaceModeActive ? '切换至原三栏模式' : '切换至专注模式'
    );
    modeButton.title =
      mobileWorkspaceModeActive ? '切换至原三栏模式' : '切换至专注模式';
  }
  if (toolbarHandle) {
    toolbarHandle.setAttribute(
      'aria-expanded',
      toolbarCollapsed ? 'false' : 'true'
    );
    toolbarHandle.setAttribute(
      'aria-label',
      toolbarCollapsed ? '展开顶部工具栏' : '折叠顶部工具栏'
    );
  }
  if (toolbarCollapseButton) {
    toolbarCollapseButton.setAttribute(
      'aria-expanded',
      toolbarCollapsed ? 'false' : 'true'
    );
    toolbarCollapseButton.setAttribute(
      'aria-label',
      toolbarCollapsed ? '展开顶部工具栏' : '折叠顶部工具栏'
    );
    toolbarCollapseButton.title =
      toolbarCollapsed ? '展开顶部工具栏' : '折叠顶部工具栏';
  }
  if (leftButton) {
    leftButton.setAttribute('aria-expanded', leftOpen ? 'true' : 'false');
    leftButton.setAttribute(
      'aria-label',
      leftOpen ? '关闭导航与参考面板' : '打开导航与参考面板'
    );
  }
  if (rightButton) {
    rightButton.setAttribute('aria-expanded', rightOpen ? 'true' : 'false');
    rightButton.setAttribute(
      'aria-label',
      rightOpen ? '关闭工具与上色面板' : '打开工具与上色面板'
    );
  }
}

function closeMobileWorkspaceDrawers() {
  var body = document.body;
  var wasOpen =
    body.classList.contains('mobile-left-drawer-open') ||
    body.classList.contains('mobile-right-drawer-open');
  body.classList.remove(
    'mobile-left-drawer-open',
    'mobile-right-drawer-open'
  );
  syncMobileWorkspaceControls();
  return wasOpen;
}

function setMobileWorkspaceDrawer(side) {
  if (!mobileWorkspaceModeActive) return;
  var body = document.body;
  var className =
    side === 'left'
      ? 'mobile-left-drawer-open'
      : 'mobile-right-drawer-open';
  var shouldOpen = !body.classList.contains(className);
  body.classList.remove(
    'mobile-left-drawer-open',
    'mobile-right-drawer-open'
  );
  if (shouldOpen) body.classList.add(className);
  syncMobileWorkspaceControls();
  scheduleMobileWorkspaceLayoutSync();
}

function setMobileToolbarCollapsed(collapsed) {
  if (!mobileWorkspaceModeActive) collapsed = false;
  document.body.classList.toggle(
    'mobile-toolbar-collapsed',
    Boolean(collapsed)
  );
  syncMobileWorkspaceControls();
  scheduleMobileWorkspaceLayoutSync();
}

function setMobileWorkspaceMode(active, announce) {
  mobileWorkspaceModeActive = Boolean(active);
  document.body.classList.toggle(
    'mobile-focus-mode',
    mobileWorkspaceModeActive
  );
  if (!mobileWorkspaceModeActive) {
    document.body.classList.remove(
      'mobile-toolbar-collapsed',
      'mobile-left-drawer-open',
      'mobile-right-drawer-open'
    );
  }
  try {
    if (mobileWorkspaceModeActive) {
      sessionStorage.setItem(MOBILE_WORKSPACE_MODE_KEY, 'focus');
    } else {
      sessionStorage.removeItem(MOBILE_WORKSPACE_MODE_KEY);
    }
  } catch (error) {
    // 隐私模式可能禁用会话存储；布局仍在当前页面内生效。
  }
  syncMobileWorkspaceControls();
  scheduleMobileWorkspaceLayoutSync();
  if (announce) {
    showToast(
      mobileWorkspaceModeActive
        ? '已切换至专注模式'
        : '已恢复原三栏模式'
    );
  }
}

function toggleMobileWorkspaceMode() {
  setMobileWorkspaceMode(!mobileWorkspaceModeActive, true);
}

function restoreMobileWorkspaceMode() {
  var active = false;
  try {
    active = sessionStorage.getItem(MOBILE_WORKSPACE_MODE_KEY) === 'focus';
  } catch (error) {
    active = false;
  }
  setMobileWorkspaceMode(active, false);
}

function toggleMobileToolbar() {
  setMobileToolbarCollapsed(
    !document.body.classList.contains('mobile-toolbar-collapsed')
  );
}

function onMobileWorkspacePointerDown(event) {
  if (
    !mobileWorkspaceModeActive ||
    (typeof event.button === 'number' && event.button !== 0)
  ) {
    return;
  }
  if (
    event.target &&
    typeof event.target.closest === 'function' &&
    event.target.closest('#pixelCanvas')
  ) {
    return;
  }
  mobileWorkspaceGesture = {
    pointerId: event.pointerId,
    startY: event.clientY,
    currentY: event.clientY
  };
  if (event.currentTarget.setPointerCapture) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      // 合成事件没有活动指针，真实触摸事件仍可正常捕获。
    }
  }
}

function onMobileWorkspacePointerMove(event) {
  if (
    !mobileWorkspaceGesture ||
    mobileWorkspaceGesture.pointerId !== event.pointerId
  ) {
    return;
  }
  mobileWorkspaceGesture.currentY = event.clientY;
}

function finishMobileWorkspaceGesture(event) {
  if (
    !mobileWorkspaceGesture ||
    mobileWorkspaceGesture.pointerId !== event.pointerId
  ) {
    return;
  }
  var deltaY =
    mobileWorkspaceGesture.currentY - mobileWorkspaceGesture.startY;
  mobileWorkspaceGesture = null;
  if (
    event.currentTarget.hasPointerCapture &&
    event.currentTarget.hasPointerCapture(event.pointerId)
  ) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (deltaY <= -MOBILE_WORKSPACE_SWIPE_THRESHOLD) {
    setMobileToolbarCollapsed(true);
  } else if (deltaY >= MOBILE_WORKSPACE_SWIPE_THRESHOLD) {
    setMobileToolbarCollapsed(false);
  }
}

function cancelMobileWorkspaceGesture(event) {
  if (
    mobileWorkspaceGesture &&
    mobileWorkspaceGesture.pointerId === event.pointerId
  ) {
    mobileWorkspaceGesture = null;
  }
}

function bindStaticControls() {
  function on(id, eventName, handler) {
    var element = document.getElementById(id);
    if (element) element.addEventListener(eventName, handler);
  }

  on('authorInfoBtn', 'click', openAuthorModal);
  on('announcementBtn', 'click', openAnnouncementModal);
  on('discoverFeaturedTab', 'click', function() { switchDiscoverTab('featured'); });
  on('discoverNoticeTab', 'click', function() { switchDiscoverTab('notice'); });
  on('discoverHelpTab', 'click', function() { switchDiscoverTab('help'); });
  on('mobileFullscreenBtn', 'click', toggleFullscreen);
  on('mobileWorkspaceModeBtn', 'click', toggleMobileWorkspaceMode);
  on('mobileToolbarCollapseBtn', 'click', toggleMobileToolbar);
  on('mobileToolbarHandle', 'pointerdown', onMobileToolbarHandlePointerDown);
  on('mobileToolbarHandle', 'pointermove', onMobileToolbarHandlePointerMove);
  on('mobileToolbarHandle', 'pointerup', finishMobileToolbarHandleDrag);
  on('mobileToolbarHandle', 'pointercancel', finishMobileToolbarHandleDrag);
  on('mobileToolbarHandle', 'click', onMobileToolbarHandleClick);
  on('mobileLeftPanelBtn', 'click', function() {
    setMobileWorkspaceDrawer('left');
  });
  on('mobileRightPanelBtn', 'click', function() {
    setMobileWorkspaceDrawer('right');
  });
  on('centerPanel', 'pointerdown', onMobileWorkspacePointerDown);
  on('centerPanel', 'pointermove', onMobileWorkspacePointerMove);
  on('centerPanel', 'pointerup', finishMobileWorkspaceGesture);
  on('centerPanel', 'pointercancel', cancelMobileWorkspaceGesture);
  syncFullscreenControl();
  restoreMobileWorkspaceMode();
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
  on('coloringTab', 'click', function() {
    setWorkspacePanelMode('coloring');
  });
  on('replacementTab', 'click', function() {
    setWorkspacePanelMode('replacement');
  });
  on('replicationTab', 'click', function() {
    setWorkspacePanelMode('replication');
  });
  on('replacementRelatedBtn', 'click', showReplacementRelatedColors);
  on('replacementStartBtn', 'click', beginReplacementTargetSelection);
  on('replacementCancelBtn', 'click', cancelReplacementTargetSelection);
  on('replacementConfirmBtn', 'click', confirmColorReplacement);
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
  on('replacementSort', 'change', function(event) {
    setReplacementSortMode(event.currentTarget.value);
  });
  on('replicationSort', 'change', function(event) {
    setReplicationSortMode(event.currentTarget.value);
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
  [
    'cropContrast',
    'cropBrightness',
    'cropSaturation',
    'cropColorOverlay',
    'cropColorOverlayOpacity',
    'cropTargetColorCount',
    'cropDitherStrength'
  ].forEach(function(id) {
    on(id, 'input', updateCropAdjustments);
  });
  on('cropDither', 'change', updateCropDitherMode);
  on('cropSamplingMode', 'change', updateCropSamplingMode);
  on('cropPreviewToggleBtn', 'click', toggleCropPreviewMode);
  on('cropSamplePreviewToggleBtn', 'click', toggleCropSamplePreview);
  on('cropAlignmentGridToggleBtn', 'click', toggleCropAlignmentGrid);
  on('cropResetBtn', 'click', resetCropTransform);
  on('conversionRetryBtn', 'click', confirmCrop);
  on('cancelCropBtn', 'click', cancelCrop);
  on('confirmCropBtn', 'click', confirmCrop);
  initializeCropViewportResizeHandling();

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
        workspacePanelMode: workspacePanelMode,
        replacementSelectedColors: Array.from(
          replacementSelectedColors
        ).sort(),
        replacementTargetColor: replacementTargetColor,
        replacementTargetMode: replacementTargetMode,
        replacementSortMode: replacementSortMode,
        replacementOrderedColors: replacementOrderedColors.slice(),
        replacementRelatedColors: replacementRelatedColors.slice(),
        replacementRelatedSourceColor: replacementRelatedSourceColor,
        replicationHighlightColor: replicationHighlightColor,
        replicationSortMode: replicationSortMode,
        replicationCompletedCells: Array.from(replicationCompletedCells).sort(
          function(a, b) { return a - b; }
        ),
        replicationCompletedColors: getReplicationCompletedColors(),
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
        hoveredCanvasCell: hoveredCanvasCell,
        converterVersion: documentMetadata.converterVersion,
        cropImageSize: cropImg ? {
          width: cropImg.width,
          height: cropImg.height
        } : null,
        cropTransform: cropImg ? {
          zoom: cropZoom,
          x: cropImgX,
          y: cropImgY,
          viewportSize: cropViewportLastSize
        } : null,
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
  var isNarrow = window.innerWidth <= 960;
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
