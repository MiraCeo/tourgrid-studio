function init() {
  try {
  mainCanvas = document.getElementById('pixelCanvas');
  mainCtx = mainCanvas.getContext('2d');
  navCanvas = document.getElementById('navPreview');
  navCtx = navCanvas.getContext('2d');
  overlayCanvas = document.getElementById('overlayCanvas');
  overlayCtx = overlayCanvas.getContext('2d');
  canvasContainer = document.getElementById('canvasContainer');
  centerPanel = document.getElementById('centerPanel');
  restoreCanvasGuidesPreference();

  // init pixelData
  pixelData = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => '#FFFFFF')
  );

  // 优先从本地存储恢复；首次使用时保留全白画布。
  var saved = loadFromStorage();
  if (saved && saved.gridSize === GRID_SIZE && saved.pixels && saved.pixels.length === GRID_SIZE) {
    pixelData = saved.pixels.map(function(row) { return row.slice(); });
    documentMetadata = Object.assign(TourgridStorage.defaultMetadata(), saved.metadata);
    referenceState = TourgridStorage.normalizeReference(saved.reference);
    overlayVisible = referenceState.visible;
    overlayOpacity = referenceState.opacity;
    restorePaletteSelection(documentMetadata.editorPaletteId);
  } else {
    documentMetadata = TourgridStorage.defaultMetadata();
    saveToStorage(true);
  }
  updateTopWorkIdentity();
  restoreReplicationProgress();

  renderColorGrid();
  updateCanvasSize();
  renderCanvas();
  renderNavigator();
  if (referenceState.assetId) {
    document.getElementById('overlayControls').hidden = false;
    restorePersistedReference().finally(scheduleReferenceAssetPrune);
  } else {
    scheduleReferenceAssetPrune();
  }

  // 娴滃娆㈢紒鎴濈暰
  mainCanvas.addEventListener('mousedown', onMouseDown);
  mainCanvas.addEventListener('mousemove', onMouseMove);
  mainCanvas.addEventListener('mouseup', onMouseUp);
  mainCanvas.addEventListener('mouseleave', onMouseUp);
  mainCanvas.addEventListener('contextmenu', e => e.preventDefault());

  // 鐟欙附鎳滄禍瀣╂
  mainCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
  mainCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
  mainCanvas.addEventListener('touchend', onTouchEnd);
  mainCanvas.addEventListener('touchcancel', onTouchEnd);

  // keydown
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // 濠婃俺鐤嗙紓鈺傛杹閿涘牏鏁剧敮鍐啇閸ｎ煉绱?
  canvasContainer.addEventListener('wheel', onWheel, { passive: false });

  // 导航缩略图支持点击、拖动和键盘定位画布。
  var navPreviewWrap = document.getElementById('navPreviewWrap');
  navPreviewWrap.addEventListener('pointerdown', onNavigatorPointerDown);
  navPreviewWrap.addEventListener('pointermove', onNavigatorPointerMove);
  navPreviewWrap.addEventListener('pointerup', onNavigatorPointerUp);
  navPreviewWrap.addEventListener('pointercancel', onNavigatorPointerUp);
  navPreviewWrap.addEventListener('keydown', onNavigatorKeyDown);
  canvasContainer.addEventListener('scroll', updateNavigatorViewport);

  // 点击色卡取色

  // 娑擃參鏁?缁岀儤鐗?瀹革箓鏁幏鏍ㄥ楠炲磭些
  canvasContainer.addEventListener('mousedown', onPanStart);
  document.addEventListener('mousemove', onPanMove);
  document.addEventListener('mouseup', onPanEnd);

  // 鐟佷礁澹€瀵湱鐛ユ禍瀣╂
  var cropVp = document.getElementById('cropViewport');
  cropVp.addEventListener('mousedown', onCropMouseDown);
  cropVp.addEventListener('wheel', onCropWheel, { passive: false });
  cropVp.addEventListener('touchstart', onCropTouchStart, { passive: false });
  cropVp.addEventListener('touchmove', onCropTouchMove, { passive: false });
  cropVp.addEventListener('touchend', onCropTouchEnd, { passive: false });
  cropVp.addEventListener('touchcancel', onCropTouchEnd, { passive: false });
  document.addEventListener('mousemove', onCropMouseMove);
  document.addEventListener('mouseup', onCropMouseUp);

  // 缁愭褰涙径褍鐨崣妯哄
  window.addEventListener('resize', () => {
    updateCanvasSize();
    renderCanvas();
    renderNavigator();
  });

  updateZoomControlState();
  syncOverlayControls();
  loadExhibitionPalette();
  } catch(e) {
    var errDiv = document.createElement('div');
    errDiv.style.cssText = 'position:fixed;top:0;left:0;z-index:99998;background:red;color:#fff;padding:15px;max-width:90%;font:14px monospace;white-space:pre-wrap;';
    errDiv.textContent = 'INIT ERROR: ' + e.message + '\n' + (e.stack||'');
    document.body.appendChild(errDiv);
  }
}

// --- 閺囧瓨鏌婇悽璇茬鐏忓搫顕敍鍫滅矌閺囧瓨鏌婇崘鍛村劥閸掑棜椴搁悳鍥风礉CSS鐏忓搫顕捄鐔兼閸愬懎顔愰懛顏堚偓鍌氱安閿?--
function updateCanvasSize() {
  const cellSize = BASE_CELL_SIZE * (zoom / 100);
  const canvasPixelSize = GRID_SIZE * cellSize;
  mainCanvas.width = canvasPixelSize;
  mainCanvas.height = canvasPixelSize;
  // 娑撳秴鍟€鐠佸墽鐤咰SS鐎逛粙鐝敍瀹慳nvas娴犮儱甯慨瀣瀻鏉堛劎宸煎〒鍙夌厠閿涘苯顔愰崳鈺玽erflow閹貉冨煑閸欘垵顫嗛崠鍝勭厵
}

// --- 濞撳弶鐓嬫稉鑽ゆ暰鐢?---
function drawCanvasCenterAxes(ctx, width, height) {
  if (!canvasGuidesVisible) return;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.lineWidth = 1.5;
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
  ctx.restore();
}

function renderCanvas() {
  const cellSize = BASE_CELL_SIZE * (zoom / 100);
  const w = GRID_SIZE * cellSize;
  const h = GRID_SIZE * cellSize;

  mainCanvas.width = w;
  mainCanvas.height = h;
  // CSS鐏忓搫顕悽鐪俛nvas閸愬懘鍎撮崚鍡氶哺閻滃洩鍤滈悞璺哄枀鐎规熬绱濈€圭懓娅抩verflow鐟佷礁澹€

  mainCtx.clearRect(0, 0, w, h);

  mainCtx.fillStyle = '#FFFFFF';
  mainCtx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

  if (canvasGuidesVisible) {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const color = pixelData[y][x];
        if (color !== '#FFFFFF') {
          mainCtx.fillStyle = color;
          mainCtx.fillRect(
            x * cellSize,
            y * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }
  } else {
    // 共享整数边界完整覆盖画布，避免小数格宽抗锯齿产生白色细缝。
    for (let y = 0; y < GRID_SIZE; y++) {
      const top = Math.round(y * mainCanvas.height / GRID_SIZE);
      const bottom = Math.round((y + 1) * mainCanvas.height / GRID_SIZE);
      for (let x = 0; x < GRID_SIZE; x++) {
        const left = Math.round(x * mainCanvas.width / GRID_SIZE);
        const right = Math.round((x + 1) * mainCanvas.width / GRID_SIZE);
        mainCtx.fillStyle = pixelData[y][x];
        mainCtx.fillRect(
          left,
          top,
          right - left,
          bottom - top
        );
      }
    }
  }

  if (canvasGuidesVisible) {
    mainCtx.strokeStyle = '#E8E8E8';
    mainCtx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_SIZE; x++) {
      mainCtx.beginPath();
      mainCtx.moveTo(x * cellSize, 0);
      mainCtx.lineTo(x * cellSize, h);
      mainCtx.stroke();
    }
    for (let y = 0; y <= GRID_SIZE; y++) {
      mainCtx.beginPath();
      mainCtx.moveTo(0, y * cellSize);
      mainCtx.lineTo(w, y * cellSize);
      mainCtx.stroke();
    }
  }

  drawCanvasCenterAxes(mainCtx, w, h);
  renderOverlay();
}

function restoreCanvasGuidesPreference() {
  try {
    var saved = localStorage.getItem(CANVAS_GUIDES_STORAGE_KEY);
    if (saved !== null) canvasGuidesVisible = saved !== 'false';
  } catch (_error) {
    canvasGuidesVisible = true;
  }
  syncCanvasGuidesButton();
}

function syncCanvasGuidesButton() {
  var button = document.getElementById('canvasGuidesBtn');
  if (!button) return;
  button.classList.toggle('active', !canvasGuidesVisible);
  button.setAttribute('aria-pressed', String(canvasGuidesVisible));
  button.setAttribute(
    'aria-label',
    canvasGuidesVisible ? '隐藏画布辅助线' : '显示画布辅助线'
  );
  button.title = canvasGuidesVisible ? '隐藏辅助线' : '显示辅助线';
}

function toggleCanvasGuides() {
  canvasGuidesVisible = !canvasGuidesVisible;
  try {
    localStorage.setItem(
      CANVAS_GUIDES_STORAGE_KEY,
      String(canvasGuidesVisible)
    );
  } catch (_error) {
    // 浏览器禁用本地存储时，本次会话内仍然生效。
  }
  syncCanvasGuidesButton();
  renderCanvas();
  showToast(canvasGuidesVisible ? '已显示画布辅助线' : '已隐藏画布辅助线');
}

// --- 濞撳弶鐓嬬€佃壈鍩呴崳銊╊暕鐟?---
function renderNavigator() {
  // 读取容器实际尺寸(对齐下方控件宽度)
  var wrap = navCanvas.parentElement;
  var size = wrap.clientWidth || 128;
  navCanvas.width = size;
  navCanvas.height = size;

  navCtx.clearRect(0, 0, size, size);

  navCtx.fillStyle = '#FFFFFF';
  navCtx.fillRect(0, 0, size, size);

  const navCellSize = size / GRID_SIZE;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const color = pixelData[y][x];
      if (color !== '#FFFFFF') {
        navCtx.fillStyle = color;
        navCtx.fillRect(x * navCellSize, y * navCellSize, navCellSize, navCellSize);
      }
    }
  }
  updateNavigatorViewport();
}

// --- 閼惧嘲褰囬悽璇茬閸ф劖鐖ｇ€电懓绨查惃鍕剼缁辩姵鐗?---
function getGridPos(e) {
  const rect = mainCanvas.getBoundingClientRect();
  const cellSize = BASE_CELL_SIZE * (zoom / 100);
  // getBoundingClientRect瀹告彃瀵橀崥顐ｇ泊scroll offset
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const gx = Math.floor(mx / cellSize);
  const gy = Math.floor(my / cellSize);
  return { x: gx, y: gy };
}

// --- 缂佹ê鍩楅崡鏇氶嚋閸嶅繒绀?---
function paintPixel(gx, gy) {
  if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return;
  if (gx === lastPaintedX && gy === lastPaintedY) return;

  const color = currentColor;
  if (!color) return;
  if (pixelData[gy][gx] === color) return;

  invalidateReplicationProgress(true);
  pixelData[gy][gx] = color;
  markSharedWorkAsEdited();
  lastPaintedX = gx;
  lastPaintedY = gy;
}

// --- 姒х姵鐖ｆ禍瀣╂ ---
function onMouseDown(e) {
  if (historyOperationInProgress) return;
  if (e.button !== 0) return; // 閸欘亜鎼锋惔鏂夸箯闁?
  // 缁岀儤鐗?瀹革箓鏁?閳?閹锋牗瀚块獮宕囆?
  if (spaceHeld || moveCanvasActive) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollStartX = canvasContainer.scrollLeft;
    panScrollStartY = canvasContainer.scrollTop;
    mainCanvas.style.cursor = 'grabbing';
    canvasContainer.classList.add('panning');
    e.preventDefault();
    return;
  }

  if (eyedropperActive) {
    const samplePos = getGridPos(e);
    sampleCanvasColor(samplePos.x, samplePos.y);
    e.preventDefault();
    return;
  }

  if (isStatisticsMode()) return;
  if (!currentColor) {
    showToast('请先从颜料中选择一种颜色');
    return;
  }

  isDrawing = true;
  pushUndo();
  lastPaintedX = -1;
  lastPaintedY = -1;
  const pos = getGridPos(e);
  paintPixel(pos.x, pos.y);
  renderCanvas();
  renderNavigator();
}

function onMouseMove(e) {
  if (!isDrawing || isStatisticsMode()) return;
  const pos = getGridPos(e);
  paintPixel(pos.x, pos.y);
  renderCanvas();
  renderNavigator();
}

function onMouseUp(e) {
  // 缂佹挻娼粚鐑樼壐閹锋牗瀚?
  if (isPanning && (spaceHeld || moveCanvasActive)) {
    isPanning = false;
    canvasContainer.classList.remove('panning');
    mainCanvas.style.cursor = 'grab';
    return;
  }
  if (isDrawing) {
    isDrawing = false;
    lastPaintedX = -1;
    lastPaintedY = -1;
    renderColorGrid();
    saveToStorage(true);
  }
}

// --- 濠婃俺鐤嗙紓鈺傛杹閿涘牅浜掓Η鐘崇垼娴ｅ秶鐤嗘稉杞拌厬韫囧喛绱?--
function onWheel(e) {
  e.preventDefault();
  const rect = canvasContainer.getBoundingClientRect();
  const mx = e.clientX - rect.left + canvasContainer.scrollLeft;
  const my = e.clientY - rect.top + canvasContainer.scrollTop;

  const oldCellSize = BASE_CELL_SIZE * (zoom / 100);
  const oldContentSize = GRID_SIZE * oldCellSize;
  const ratioX = oldContentSize > 0 ? mx / oldContentSize : 0.5;
  const ratioY = oldContentSize > 0 ? my / oldContentSize : 0.5;

  var minZoom = getMinZoom();
  const delta = e.deltaY > 0 ? -10 : 10;
  const newZoom = Math.max(minZoom, Math.min(400, zoom + delta));
  if (newZoom === zoom) return;

  zoom = newZoom;
  updateCanvasSize();
  renderCanvas();

  const newContentSize = GRID_SIZE * BASE_CELL_SIZE * (zoom / 100);
  if (zoom === minZoom) {
    // 最小缩放时自动居中
    canvasContainer.scrollLeft = 0;
    canvasContainer.scrollTop = 0;
  } else {
    canvasContainer.scrollLeft = ratioX * newContentSize - (e.clientX - rect.left);
    canvasContainer.scrollTop  = ratioY * newContentSize - (e.clientY - rect.top);
  }

  updateZoomControlState();
  updateNavigatorViewport();
}

// --- 娑擃參鏁幏鏍ㄥ楠炲磭些 ---
function onPanStart(e) {
  if (e.button === 1) {
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollStartX = canvasContainer.scrollLeft;
    panScrollStartY = canvasContainer.scrollTop;
    canvasContainer.style.cursor = 'grabbing';
  }
}

function onPanMove(e) {
  if (!isPanning) return;
  // 缁岀儤鐗?瀹革箓鏁幏鏍ㄥ
  if ((spaceHeld || moveCanvasActive) && e.buttons === 1) {
    canvasContainer.scrollLeft = panScrollStartX - (e.clientX - panStartX);
    canvasContainer.scrollTop  = panScrollStartY - (e.clientY - panStartY);
    return;
  }
  // 娑擃參鏁幏鏍ㄥ
  if (e.buttons === 4) {
    canvasContainer.scrollLeft = panScrollStartX - (e.clientX - panStartX);
    canvasContainer.scrollTop  = panScrollStartY - (e.clientY - panStartY);
  }
}

function onPanEnd(e) {
  if (!isPanning) return;
  if (
    e.button === 1 ||
    ((spaceHeld || moveCanvasActive) && e.button === 0)
  ) {
    isPanning = false;
    canvasContainer.classList.remove('panning');
    canvasContainer.style.cursor =
      (spaceHeld || moveCanvasActive) ? 'grab' : '';
    mainCanvas.style.cursor =
      (spaceHeld || moveCanvasActive) ? 'grab' : 'crosshair';
  }
}

// --- 触摸事件（支持单指绘制 + 双指平移）---
var touchPanStart = null; // {x, y, scrollLeft, scrollTop}
var touchPinchDist = 0;   // 双指初始距离（用于缩放判定）
var touchPinchZoom = 0;   // 双指缩放起始zoom值

function onTouchStart(e) {
  if (historyOperationInProgress) return;
  e.preventDefault();
  if (e.touches.length === 1) {
    if (moveCanvasActive) {
      isDrawing = false;
      isPanning = true;
      touchPanStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        scrollLeft: canvasContainer.scrollLeft,
        scrollTop: canvasContainer.scrollTop
      };
      canvasContainer.classList.add('panning');
      return;
    }
    if (eyedropperActive) {
      const samplePos = getGridPos(e.touches[0]);
      sampleCanvasColor(samplePos.x, samplePos.y);
      return;
    }
    if (isStatisticsMode()) return;
    if (!currentColor) {
      showToast('请先从颜料中选择一种颜色');
      return;
    }
    isDrawing = true;
    pushUndo();
    lastPaintedX = -1;
    lastPaintedY = -1;
    const pos = getGridPos(e.touches[0]);
    paintPixel(pos.x, pos.y);
    renderCanvas();
    renderNavigator();
  } else if (e.touches.length === 2) {
    // 双指：平移+缩放
    isDrawing = false;
    var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    touchPanStart = {
      x: mx, y: my,
      scrollLeft: canvasContainer.scrollLeft,
      scrollTop: canvasContainer.scrollTop
    };
    touchPinchDist = Math.sqrt(dx * dx + dy * dy);
    touchPinchZoom = zoom;
  }
}

function onTouchMove(e) {
  e.preventDefault();
  if (
    moveCanvasActive &&
    e.touches.length === 1 &&
    touchPanStart
  ) {
    canvasContainer.scrollLeft =
      touchPanStart.scrollLeft +
      (touchPanStart.x - e.touches[0].clientX);
    canvasContainer.scrollTop =
      touchPanStart.scrollTop +
      (touchPanStart.y - e.touches[0].clientY);
    updateNavigatorViewport();
  } else if (isDrawing && e.touches.length === 1) {
    const pos = getGridPos(e.touches[0]);
    paintPixel(pos.x, pos.y);
    renderCanvas();
    renderNavigator();
  } else if (e.touches.length === 2 && touchPanStart) {
    var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    var newDist = Math.sqrt(dx * dx + dy * dy);

    // 距离变化>3px → 缩放；否则平移
    if (touchPinchDist > 0 && Math.abs(newDist - touchPinchDist) > 3) {
      var ratio = newDist / touchPinchDist;
      var newZoom = Math.round(touchPinchZoom * ratio);
      newZoom = Math.max(20, Math.min(400, newZoom));
      if (newZoom !== zoom) {
        // 以双指中点为中心缩放：调整滚动位置
        var rect = canvasContainer.getBoundingClientRect();
        var cx = mx - rect.left + canvasContainer.scrollLeft;
        var cy = my - rect.top + canvasContainer.scrollTop;
        var oldCell = BASE_CELL_SIZE * (zoom / 100);
        var oldCx = cx / oldCell;
        var oldCy = cy / oldCell;
        setZoom(newZoom);
        var newCell = BASE_CELL_SIZE * (zoom / 100);
        canvasContainer.scrollLeft = oldCx * newCell - (mx - rect.left);
        canvasContainer.scrollTop  = oldCy * newCell - (my - rect.top);
        // 更新基准值，避免跳跃
        touchPinchDist = newDist;
        touchPinchZoom = zoom;
        touchPanStart.scrollLeft = canvasContainer.scrollLeft;
        touchPanStart.scrollTop = canvasContainer.scrollTop;
        touchPanStart.x = mx;
        touchPanStart.y = my;
      }
    } else {
      // 平移
      canvasContainer.scrollLeft = touchPanStart.scrollLeft + (touchPanStart.x - mx);
      canvasContainer.scrollTop  = touchPanStart.scrollTop  + (touchPanStart.y - my);
    }
  }
}

function onTouchEnd(e) {
  if (isDrawing) {
    isDrawing = false;
    lastPaintedX = -1;
    lastPaintedY = -1;
    renderColorGrid();
    saveToStorage(true);
  }
  touchPanStart = null;
  touchPinchDist = 0;
  touchPinchZoom = 0;
  if (isPanning) {
    isPanning = false;
    canvasContainer.classList.remove('panning');
    mainCanvas.style.cursor = moveCanvasActive ? 'grab' : 'crosshair';
  }
}

// --- 閹俱倝鏀?闁插秴浠?---
var referencePruneTimer = null;

function referenceSnapshotForHistory() {
  return {
    assetId: referenceState.assetId || null,
    mimeType: referenceState.mimeType || null,
    width: referenceState.width || null,
    height: referenceState.height || null,
    sessionOnly: Boolean(referenceState.sessionOnly)
  };
}

function collectReferencedAssetIds() {
  var referenced = new Set();
  function addReference(snapshot) {
    if (snapshot && snapshot.reference && snapshot.reference.assetId) {
      referenced.add(snapshot.reference.assetId);
    }
  }
  if (referenceState.assetId) referenced.add(referenceState.assetId);
  var checkpoint = loadManualCheckpoint();
  if (checkpoint && checkpoint.reference && checkpoint.reference.assetId) {
    referenced.add(checkpoint.reference.assetId);
  }
  undoStack.forEach(addReference);
  redoStack.forEach(addReference);
  return referenced;
}

async function pruneReferenceAssets() {
  if (!TourgridReferenceStorage || typeof TourgridReferenceStorage.listIds !== 'function') return;
  var referenced = collectReferencedAssetIds();
  var ids = await TourgridReferenceStorage.listIds();
  await Promise.all(ids.map(function(id) {
    if (referenced.has(id)) return Promise.resolve();
    return TourgridReferenceStorage.remove(id);
  }));
}

function scheduleReferenceAssetPrune() {
  if (referencePruneTimer !== null) clearTimeout(referencePruneTimer);
  referencePruneTimer = setTimeout(function() {
    referencePruneTimer = null;
    pruneReferenceAssets().catch(function() {});
  }, 0);
}

function pushUndo(snapshot) {
  undoStack.push(snapshot || makeEditorSnapshot());
  var historyTruncated = false;
  if (undoStack.length > MAX_UNDO) {
    undoStack.shift();
    historyTruncated = true;
  }
  var discardedRedo = redoStack.length > 0;
  redoStack = []; // 閺傜増鎼锋担婊勭缁屾椽鍣搁崑姘垽
  if (historyTruncated || discardedRedo) scheduleReferenceAssetPrune();
}

function makeEditorSnapshot() {
  return {
    gridSize: GRID_SIZE,
    pixels: pixelData.map(function(row) { return row.slice(); }),
    metadata: Object.assign({}, documentMetadata),
    paletteId: currentPaletteId,
    reference: referenceSnapshotForHistory()
  };
}

async function restoreEditorSnapshot(snapshot) {
  invalidateReplicationProgress(true);
  statisticsHighlightColor = null;
  await restoreReferenceFromHistory(snapshot.reference);
  pixelData = snapshot.pixels.map(function(row) { return row.slice(); });
  documentMetadata = Object.assign(
    TourgridStorage.defaultMetadata(),
    snapshot.metadata || {}
  );
  updateTopWorkIdentity();
  restorePaletteSelection(
    snapshot.paletteId || documentMetadata.editorPaletteId || 'exhibition'
  );
  updateCanvasSize();
}

function checkpointToEditorSnapshot(checkpoint) {
  return {
    gridSize: GRID_SIZE,
    pixels: checkpoint.pixels.map(function(row) { return row.slice(); }),
    metadata: Object.assign({}, checkpoint.metadata),
    paletteId: checkpoint.metadata.editorPaletteId || 'exhibition',
    reference: {
      assetId: checkpoint.reference.assetId || null,
      mimeType: checkpoint.reference.mimeType || null,
      width: checkpoint.reference.width || null,
      height: checkpoint.reference.height || null,
      sessionOnly: false
    }
  };
}

async function restoreManualCheckpoint() {
  if (historyOperationInProgress || (
    typeof conversionInProgress !== 'undefined' && conversionInProgress
  )) {
    showToast('当前操作完成后才能恢复保存点');
    return;
  }
  if (isStatisticsMode()) {
    showToast('请先返回颜料面板');
    return;
  }

  var checkpoint = loadManualCheckpoint();
  if (!checkpoint) {
    showToast('还没有手动保存点');
    return;
  }
  if (!confirm('恢复到上次手动保存点？当前状态可以撤销。')) return;

  historyOperationInProgress = true;
  var current = makeEditorSnapshot();
  try {
    await restoreEditorSnapshot(checkpointToEditorSnapshot(checkpoint));
    pushUndo(current);
    renderCanvas();
    renderNavigator();
    renderColorGrid();
    saveToStorage(true);
    showToast('已恢复到手动保存点');
  } catch (error) {
    showToast(error && error.message ? error.message : '恢复保存点失败');
  } finally {
    historyOperationInProgress = false;
  }
}

async function undo() {
  if (isStatisticsMode()) {
    showToast('复刻模式下画布为只读');
    return;
  }
  if (undoStack.length === 0) {
    showToast('Nothing to undo');
    return;
  }
  if (typeof conversionInProgress !== 'undefined' && conversionInProgress) {
    showToast('图片转换完成后才能撤销');
    return;
  }
  if (historyOperationInProgress) return;
  historyOperationInProgress = true;
  var target = undoStack[undoStack.length - 1];
  var current = makeEditorSnapshot();
  try {
    await restoreEditorSnapshot(target);
    undoStack.pop();
    redoStack.push(current);
    renderCanvas();
    renderNavigator();
    renderColorGrid();
    saveToStorage(true);
    showToast('Undone');
  } catch (error) {
    showToast(error && error.message ? error.message : '撤销失败');
  } finally {
    historyOperationInProgress = false;
  }
}

async function redo() {
  if (isStatisticsMode()) {
    showToast('复刻模式下画布为只读');
    return;
  }
  if (redoStack.length === 0) {
    showToast('Nothing to redo');
    return;
  }
  if (typeof conversionInProgress !== 'undefined' && conversionInProgress) {
    showToast('图片转换完成后才能重做');
    return;
  }
  if (historyOperationInProgress) return;
  historyOperationInProgress = true;
  var target = redoStack[redoStack.length - 1];
  var current = makeEditorSnapshot();
  try {
    await restoreEditorSnapshot(target);
    redoStack.pop();
    undoStack.push(current);
    var historyTruncated = false;
    if (undoStack.length > MAX_UNDO) {
      undoStack.shift();
      historyTruncated = true;
    }
    renderCanvas();
    renderNavigator();
    renderColorGrid();
    saveToStorage(true);
    if (historyTruncated) scheduleReferenceAssetPrune();
    showToast('Redone');
  } catch (error) {
    showToast(error && error.message ? error.message : '重做失败');
  } finally {
    historyOperationInProgress = false;
  }
}

// --- 濞撳懐鈹栭悽璇茬 ---
function clearCanvas() {
  if (historyOperationInProgress || (
    typeof conversionInProgress !== 'undefined' && conversionInProgress
  )) {
    showToast('当前操作完成后才能清空画布');
    return;
  }
  if (isStatisticsMode()) {
    showToast('复刻模式下画布为只读');
    return;
  }
  if (!confirm('Clear canvas? This can be undone.')) return;
  pushUndo();
  documentMetadata = TourgridStorage.defaultMetadata();
  updateTopWorkIdentity();
  clearReferenceImage(false);
  invalidateReplicationProgress(false);
  statisticsHighlightColor = null;
  pixelData = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => '#FFFFFF')
  );
  renderCanvas();
  renderNavigator();
  renderColorGrid();
  saveToStorage(true);
  showToast('Canvas cleared (Ctrl+Z to undo)');
}

// --- 娣囨繂鐡ㄩ崶鍓у ---
