let cropImg = null;
let cropZoom = 100;
let cropImgX = 0, cropImgY = 0;
let cropDragStartX = 0, cropDragStartY = 0;
let cropImgStartX = 0, cropImgStartY = 0;
let isCropping = false;

let importedPixelData = null;
let importedPreviewImage = null;
let importedPreviewObjectUrl = null;
let conversionInProgress = false;
const REFERENCE_IMAGE_SIZE = 256;
const REFERENCE_WEBP_QUALITY = 0.88;

async function loadExhibitionPalette() {
  try {
    var response = await fetch(API_BASE_URL + '/api/v1/palettes/' + DEFAULT_PALETTE_ID);
    if (!response.ok) return;
    var data = await response.json();
    if (
      data.id !== DEFAULT_PALETTE_ID ||
      data.version !== DEFAULT_PALETTE_VERSION ||
      !Array.isArray(data.colors) ||
      data.colors.length !== 64
    ) return;
    var matchesEmbeddedPalette = data.colors.every(function(color, index) {
      var embedded = TOURGRID_NATURAL_64_V1.colors[index];
      return color.id === embedded.code &&
        String(color.hex).toUpperCase() === embedded.hex.toUpperCase();
    });
    if (!matchesEmbeddedPalette) return;
    EXHIBITION_DATA.splice(0, EXHIBITION_DATA.length);
    data.colors.forEach(function(color) {
      EXHIBITION_DATA.push({
        code: color.id,
        hex: String(color.hex).toUpperCase(),
        name: color.name || color.id
      });
    });
    if (currentPaletteId === 'exhibition') {
      OFFICIAL_COLORS = EXHIBITION_DATA;
      paletteMode = EXHIBITION_DATA.length ? 'official' : 'canvas';
      buildHexCodeMap();
      renderColorGrid();
    }
  } catch (error) {
    // API 不可用时继续使用内置的版本化 64 色色板。
  }
}

function setConversionBusy(busy) {
  conversionInProgress = busy;
  document.getElementById('confirmCropBtn').disabled = busy;
  document.getElementById('cropDither').disabled = busy;
}

function setConversionStatus(message, isError, showRetry) {
  var box = document.getElementById('conversionStatus');
  box.classList.toggle('show', Boolean(message));
  box.classList.toggle('error', Boolean(isError));
  document.getElementById('conversionStatusText').textContent = message || '';
  box.querySelector('.conversion-spinner').style.display = message && !isError ? '' : 'none';
  document.getElementById('conversionRetryBtn').style.display = showRetry ? 'inline-flex' : 'none';
}

function startImport(e) {
  var file = e.target.files[0];
  if (!file) return;
  setConversionStatus('', false, false);
  var reader = new FileReader();
  reader.onload = function(ev) {
    cropImg = new Image();
    cropImg.onload = function() {
      // 閸忓牊妯夌粈鍝勮剨缁愭绱欑涵顔荤箽鐢啫鐪€瑰本鍨氶敍澶涚礉閸愬秷顓哥粻妞剧秴缂?
      document.getElementById('cropOverlay').classList.add('show');
      var vp = document.getElementById('cropViewport');
      // 缁涘绔寸敮褑顔€鐢啫鐪悽鐔告櫏
      requestAnimationFrame(function() {
        var vpW = vp.clientWidth;
        var scale = Math.max(vpW / cropImg.width, vpW / cropImg.height);
        cropZoom = Math.round(scale * 100);
        cropImgX = (vpW - cropImg.width * scale) / 2;
        cropImgY = (vpW - cropImg.height * scale) / 2;
        document.getElementById('cropZoomSlider').value = cropZoom;
        document.getElementById('cropZoomVal').textContent = cropZoom + '%';
        applyCropTransform();
      });
    };
    cropImg.onerror = function() {
      setConversionStatus('无法读取该图片，请选择 PNG、JPEG 或 WebP 文件。', true, false);
    };
    cropImg.src = ev.target.result;
  };
  reader.onerror = function() {
    setConversionStatus('读取图片失败，请重试。', true, false);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function applyCropTransform() {
  const img = document.getElementById('cropImage');
  img.src = cropImg.src;
  img.style.display = 'block';
  const scale = cropZoom / 100;
  img.style.width = (cropImg.width * scale) + 'px';
  img.style.height = (cropImg.height * scale) + 'px';
  img.style.left = cropImgX + 'px';
  img.style.top = cropImgY + 'px';
}

function updateCropZoom(val) {
  const oldScale = cropZoom / 100;
  cropZoom = parseInt(val);
  const newScale = cropZoom / 100;
  // 娣囨繃瀵旈崶鍓у娑擃厼绺炬稉宥呭綁
  const vp = document.getElementById('cropViewport');
  const cx = vp.clientWidth / 2;
  const cy = vp.clientHeight / 2;
  cropImgX = cx - (cx - cropImgX) * (newScale / oldScale);
  cropImgY = cy - (cy - cropImgY) * (newScale / oldScale);
  document.getElementById('cropZoomVal').textContent = cropZoom + '%';
  applyCropTransform();
}

// onCropMouseDown
function onCropMouseDown(e) {
  if (e.button !== 0) return;
  if (!cropImg) return;
  isCropping = true;
  cropDragStartX = e.clientX;
  cropDragStartY = e.clientY;
  cropImgStartX = cropImgX;
  cropImgStartY = cropImgY;
  document.getElementById('cropViewport').style.cursor = 'grabbing';
}
function onCropMouseMove(e) {
  if (!isCropping) return;
  cropImgX = cropImgStartX + (e.clientX - cropDragStartX);
  cropImgY = cropImgStartY + (e.clientY - cropDragStartY);
  applyCropTransform();
}
function onCropMouseUp(e) {
  isCropping = false;
  document.getElementById('cropViewport').style.cursor = 'grab';
}

let cropTouchState = null;

function cropTouchDistance(touches) {
  var dx = touches[0].clientX - touches[1].clientX;
  var dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function cropTouchMidpoint(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  };
}

function onCropTouchStart(e) {
  if (!cropImg) return;
  e.preventDefault();
  if (e.touches.length === 1) {
    cropTouchState = {
      mode: 'pan',
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      imageX: cropImgX,
      imageY: cropImgY
    };
  } else if (e.touches.length === 2) {
    var midpoint = cropTouchMidpoint(e.touches);
    var viewportRect = document.getElementById('cropViewport').getBoundingClientRect();
    var localX = midpoint.x - viewportRect.left;
    var localY = midpoint.y - viewportRect.top;
    var startScale = cropZoom / 100;
    cropTouchState = {
      mode: 'pinch',
      distance: cropTouchDistance(e.touches),
      zoom: cropZoom,
      sourceX: (localX - cropImgX) / startScale,
      sourceY: (localY - cropImgY) / startScale
    };
  }
}

function onCropTouchMove(e) {
  if (!cropImg || !cropTouchState) return;
  e.preventDefault();
  if (e.touches.length === 1 && cropTouchState.mode === 'pan') {
    cropImgX = cropTouchState.imageX + e.touches[0].clientX - cropTouchState.x;
    cropImgY = cropTouchState.imageY + e.touches[0].clientY - cropTouchState.y;
    applyCropTransform();
  } else if (e.touches.length === 2) {
    if (cropTouchState.mode !== 'pinch') {
      onCropTouchStart(e);
      return;
    }
    var ratio = cropTouchDistance(e.touches) / cropTouchState.distance;
    cropZoom = Math.max(10, Math.min(500, Math.round(cropTouchState.zoom * ratio)));
    var midpoint = cropTouchMidpoint(e.touches);
    var viewportRect = document.getElementById('cropViewport').getBoundingClientRect();
    var localX = midpoint.x - viewportRect.left;
    var localY = midpoint.y - viewportRect.top;
    var scale = cropZoom / 100;
    cropImgX = localX - cropTouchState.sourceX * scale;
    cropImgY = localY - cropTouchState.sourceY * scale;
    document.getElementById('cropZoomSlider').value = cropZoom;
    document.getElementById('cropZoomVal').textContent = cropZoom + '%';
    applyCropTransform();
  }
}

function onCropTouchEnd(e) {
  e.preventDefault();
  if (e.touches.length === 0) {
    cropTouchState = null;
  } else {
    onCropTouchStart(e);
  }
}

function onCropWheel(e) {
  if (!cropImg) return;
  e.preventDefault();
  e.stopPropagation();
  var delta = e.deltaY > 0 ? -10 : 10;
  var newZoom = Math.max(10, Math.min(500, cropZoom + delta));
  document.getElementById('cropZoomSlider').value = newZoom;
  updateCropZoom(newZoom);
}

function finishImportedPixels(usedColors, sourceLabel) {
  updateTopWorkIdentity();
  overlayVisible = false;
  document.getElementById('cropOverlay').classList.remove('show');
  document.getElementById('overlayControls').hidden = false;
  syncOverlayControls();

  var fitZoom = Math.floor(480 / (GRID_SIZE * BASE_CELL_SIZE) * 100);
  zoom = Math.max(20, Math.min(100, fitZoom));
  var zoomSlider = document.getElementById('zoomSlider');
  zoomSlider.min = Math.min(20, zoom);
  updateZoomControlState();

  updateCanvasSize();
  renderCanvas();
  renderNavigator();
  renderColorGrid();
  saveToStorage(true);
  showToast(sourceLabel + '转换完成：' + GRID_SIZE + '×' + GRID_SIZE + '，使用 ' + usedColors + ' 种颜色');
}

async function confirmCrop() {
  if (!cropImg || conversionInProgress || historyOperationInProgress) return;
  setConversionBusy(true);
  setConversionStatus('正在准备本地转换…', false, false);
  try {
    await new Promise(function(resolve) { setTimeout(resolve, 0); });
    await confirmCropLocal();
    setConversionStatus('', false, false);
  } catch (error) {
    setConversionStatus(
      error && error.message ? error.message : '本地转换失败，请重试。',
      true,
      true
    );
  } finally {
    setConversionBusy(false);
  }
}

async function confirmCropLocal() {
  if (!cropImg) return;
  var beforeImport = makeEditorSnapshot();
  var vp = document.getElementById('cropViewport');
  var vpW = vp.clientWidth;
  var scale = cropZoom / 100;
  var ditherMode = document.getElementById('cropDither').value; // 'none' | 'floyd' | 'atkinson'

  // === Step 1: 超采样 → 每格平均色 ===
  var srcX = -cropImgX / scale;
  var srcY = -cropImgY / scale;
  var srcW = vpW / scale;
  var srcH = vpW / scale;
  var sx = Math.max(0, srcX);
  var sy = Math.max(0, srcY);
  var sw = Math.min(srcW, cropImg.width - sx);
  var sh = Math.min(srcH, cropImg.height - sy);

  var SAMPLE = 8;
  var hiRes = GRID_SIZE * SAMPLE;
  var hiCanvas = document.createElement('canvas');
  hiCanvas.width = hiRes;
  hiCanvas.height = hiRes;
  var hiCtx = hiCanvas.getContext('2d');
  hiCtx.fillStyle = '#FFFFFF';
  hiCtx.fillRect(0, 0, hiRes, hiRes);

  var dx = (sx - srcX) / srcW * hiRes;
  var dy = (sy - srcY) / srcH * hiRes;
  var dw = sw / srcW * hiRes;
  var dh = sh / srcH * hiRes;
  if (sw > 0 && sh > 0) {
    hiCtx.drawImage(cropImg, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  var hiData = hiCtx.getImageData(0, 0, hiRes, hiRes).data;

  var rawR = new Float64Array(GRID_SIZE * GRID_SIZE);
  var rawG = new Float64Array(GRID_SIZE * GRID_SIZE);
  var rawB = new Float64Array(GRID_SIZE * GRID_SIZE);
  for (var gy = 0; gy < GRID_SIZE; gy++) {
    for (var gx = 0; gx < GRID_SIZE; gx++) {
      var sr = 0, sg = 0, sb = 0, cnt = 0;
      for (var dy2 = 0; dy2 < SAMPLE; dy2++) {
        for (var dx2 = 0; dx2 < SAMPLE; dx2++) {
          var px = gx * SAMPLE + dx2;
          var py = gy * SAMPLE + dy2;
          var i = (py * hiRes + px) * 4;
          var a = hiData[i + 3];
          if (a > 128) {
            sr += hiData[i];
            sg += hiData[i + 1];
            sb += hiData[i + 2];
            cnt++;
          }
        }
      }
      var idx = gy * GRID_SIZE + gx;
      if (cnt > 0) {
        rawR[idx] = sr / cnt;
        rawG[idx] = sg / cnt;
        rawB[idx] = sb / cnt;
      } else {
        rawR[idx] = 255; rawG[idx] = 255; rawB[idx] = 255;
      }
    }
  }

  // === Step 2: 使用内置 natural-64-v1 固定色板 ===
  var total = GRID_SIZE * GRID_SIZE;
  var palette = EXHIBITION_DATA.map(function(color) {
    var hex = color.hex;
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
  });
  if (palette.length !== 64) {
    throw new Error('本地 natural-64-v1 色板加载失败。');
  }

  // 最近色查找 (感知加权)
  function nearestColor(r, g, b) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var d = colorDistRGB(r, g, b, palette[i][0], palette[i][1], palette[i][2]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // === Step 3: 抖动 + 固定色板映射 ===
  var outR = new Float64Array(total);
  var outG = new Float64Array(total);
  var outB = new Float64Array(total);

  if (ditherMode === 'floyd') {
    // Floyd-Steinberg 误差扩散
    var errR = new Float64Array(total);
    var errG = new Float64Array(total);
    var errB = new Float64Array(total);
    for (var y = 0; y < GRID_SIZE; y++) {
      for (var x = 0; x < GRID_SIZE; x++) {
        var idx = y * GRID_SIZE + x;
        var r = Math.min(255, Math.max(0, rawR[idx] + errR[idx]));
        var g = Math.min(255, Math.max(0, rawG[idx] + errG[idx]));
        var b = Math.min(255, Math.max(0, rawB[idx] + errB[idx]));
        var pi = nearestColor(r, g, b);
        outR[idx] = palette[pi][0];
        outG[idx] = palette[pi][1];
        outB[idx] = palette[pi][2];
        var er = r - outR[idx];
        var eg = g - outG[idx];
        var eb = b - outB[idx];
        if (x + 1 < GRID_SIZE) {
          var ri = y * GRID_SIZE + (x + 1);
          errR[ri] += er * 7/16; errG[ri] += eg * 7/16; errB[ri] += eb * 7/16;
        }
        if (y + 1 < GRID_SIZE) {
          if (x - 1 >= 0) {
            var bl = (y + 1) * GRID_SIZE + (x - 1);
            errR[bl] += er * 3/16; errG[bl] += eg * 3/16; errB[bl] += eb * 3/16;
          }
          var bd = (y + 1) * GRID_SIZE + x;
          errR[bd] += er * 5/16; errG[bd] += eg * 5/16; errB[bd] += eb * 5/16;
          if (x + 1 < GRID_SIZE) {
            var br = (y + 1) * GRID_SIZE + (x + 1);
            errR[br] += er * 1/16; errG[br] += eg * 1/16; errB[br] += eb * 1/16;
          }
        }
      }
    }
  } else if (ditherMode === 'atkinson') {
    // Atkinson 误差扩散 (1/8权重, 对比度更高, 像素画常用)
    var errR = new Float64Array(total);
    var errG = new Float64Array(total);
    var errB = new Float64Array(total);
    for (var y = 0; y < GRID_SIZE; y++) {
      for (var x = 0; x < GRID_SIZE; x++) {
        var idx = y * GRID_SIZE + x;
        var r = Math.min(255, Math.max(0, rawR[idx] + errR[idx]));
        var g = Math.min(255, Math.max(0, rawG[idx] + errG[idx]));
        var b = Math.min(255, Math.max(0, rawB[idx] + errB[idx]));
        var pi = nearestColor(r, g, b);
        outR[idx] = palette[pi][0];
        outG[idx] = palette[pi][1];
        outB[idx] = palette[pi][2];
        var er = (r - outR[idx]) / 8;
        var eg = (g - outG[idx]) / 8;
        var eb = (b - outB[idx]) / 8;
        // Atkinson pattern: forward 2, down 3
        if (x + 1 < GRID_SIZE) {
          var r1 = y * GRID_SIZE + (x + 1);
          errR[r1] += er; errG[r1] += eg; errB[r1] += eb;
        }
        if (x + 2 < GRID_SIZE) {
          var r2 = y * GRID_SIZE + (x + 2);
          errR[r2] += er; errG[r2] += eg; errB[r2] += eb;
        }
        if (y + 1 < GRID_SIZE) {
          if (x - 1 >= 0) {
            var d0 = (y + 1) * GRID_SIZE + (x - 1);
            errR[d0] += er; errG[d0] += eg; errB[d0] += eb;
          }
          var d1 = (y + 1) * GRID_SIZE + x;
          errR[d1] += er; errG[d1] += eg; errB[d1] += eb;
          if (x + 1 < GRID_SIZE) {
            var d2 = (y + 1) * GRID_SIZE + (x + 1);
            errR[d2] += er; errG[d2] += eg; errB[d2] += eb;
          }
        }
        if (y + 2 < GRID_SIZE) {
          var d3 = (y + 2) * GRID_SIZE + x;
          errR[d3] += er; errG[d3] += eg; errB[d3] += eb;
        }
      }
    }
  } else {
    // 无抖动：直接最近色映射
    for (var i = 0; i < total; i++) {
      var pi = nearestColor(rawR[i], rawG[i], rawB[i]);
      outR[i] = palette[pi][0];
      outG[i] = palette[pi][1];
      outB[i] = palette[pi][2];
    }
  }

  // === Step 4: 写入像素数据 ===
  importedPixelData = [];
  var coloredCount = 0;
  for (var y = 0; y < GRID_SIZE; y++) {
    importedPixelData[y] = [];
    for (var x = 0; x < GRID_SIZE; x++) {
      var idx = y * GRID_SIZE + x;
      var rr = Math.round(outR[idx]);
      var gg = Math.round(outG[idx]);
      var bb = Math.round(outB[idx]);
      if (rr === 255 && gg === 255 && bb === 255) {
        importedPixelData[y][x] = '#FFFFFF';
      } else {
        importedPixelData[y][x] = '#' + [rr,gg,bb].map(function(c){
          return ('0'+c.toString(16)).slice(-2).toUpperCase();
        }).join('');
        coloredCount++;
      }
    }
  }

  // === Step 5: 预览图 ===
  var PREVIEW_SIZE = REFERENCE_IMAGE_SIZE;
  var rawPreview = document.createElement('canvas');
  rawPreview.width = PREVIEW_SIZE;
  rawPreview.height = PREVIEW_SIZE;
  var rawPrevCtx = rawPreview.getContext('2d');
  rawPrevCtx.fillStyle = '#FFFFFF';
  rawPrevCtx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  var rdx = (sx - srcX) / srcW * PREVIEW_SIZE;
  var rdy = (sy - srcY) / srcH * PREVIEW_SIZE;
  var rdw = sw / srcW * PREVIEW_SIZE;
  var rdh = sh / srcH * PREVIEW_SIZE;
  if (sw > 0 && sh > 0) {
    rawPrevCtx.drawImage(cropImg, sx, sy, sw, sh, rdx, rdy, rdw, rdh);
  }
  var preparedReference = await installAndPersistReference(rawPreview);
  try {
    await setImportedPreviewBlob(preparedReference.blob);
  } catch (error) {
    if (preparedReference.record) {
      TourgridReferenceStorage.remove(preparedReference.record.id).catch(function() {});
    }
    throw error;
  }

  pushUndo(beforeImport);
  if (preparedReference.record) {
    referenceState = {
      assetId: preparedReference.record.id,
      mimeType: preparedReference.record.mimeType,
      width: preparedReference.record.width,
      height: preparedReference.record.height,
      visible: false,
      opacity: overlayOpacity
    };
  } else {
    referenceState = {
      assetId: null,
      mimeType: preparedReference.blob.type || 'image/webp',
      width: rawPreview.width,
      height: rawPreview.height,
      visible: false,
      opacity: overlayOpacity,
      sessionOnly: true
    };
  }

  replicationCompletedCells.clear();
  statisticsHighlightColor = null;
  pixelData = importedPixelData.map(function(row) { return row.slice(); });
  restoreReplicationProgress();
  currentPaletteId = 'exhibition';
  OFFICIAL_COLORS = EXHIBITION_DATA;
  paletteMode = 'official';
  documentMetadata = {
    sourceMode: 'local',
    paletteId: DEFAULT_PALETTE_ID,
    editorPaletteId: 'exhibition',
    paletteVersion: DEFAULT_PALETTE_VERSION,
    converterVersion: 'browser-fixed-palette-v1',
    importedAt: new Date().toISOString()
  };
  buildHexCodeMap();
  var usedLocalColors = new Set();
  importedPixelData.forEach(function(row) {
    row.forEach(function(color) { usedLocalColors.add(color); });
  });
  finishImportedPixels(usedLocalColors.size, '本地');
  if (!preparedReference.record) {
    showToast('转换完成，但参考图未能持久保存');
  }
}

function canvasToWebpBlob(canvas) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(blob) {
      if (!blob) {
        reject(new Error('浏览器无法生成 WebP 参考图。'));
        return;
      }
      resolve(blob);
    }, 'image/webp', REFERENCE_WEBP_QUALITY);
  });
}

function setImportedPreviewBlob(blob) {
  return new Promise(function(resolve, reject) {
    var nextObjectUrl = URL.createObjectURL(blob);
    var image = new Image();
    image.onload = function() {
      if (importedPreviewObjectUrl) URL.revokeObjectURL(importedPreviewObjectUrl);
      importedPreviewObjectUrl = nextObjectUrl;
      importedPreviewImage = image;
      renderNavigator();
      renderOverlay();
      resolve(image);
    };
    image.onerror = function() {
      URL.revokeObjectURL(nextObjectUrl);
      reject(new Error('无法读取本地参考图。'));
    };
    image.src = nextObjectUrl;
  });
}

async function installAndPersistReference(canvas) {
  var blob = await canvasToWebpBlob(canvas);
  try {
    var record = await TourgridReferenceStorage.save(blob, {
      width: canvas.width,
      height: canvas.height
    });
    return { blob: blob, record: record };
  } catch (error) {
    return { blob: blob, record: null };
  }
}

async function restorePersistedReference() {
  if (!referenceState.assetId) return;
  try {
    var record = await TourgridReferenceStorage.load(referenceState.assetId);
    if (!record || !record.blob) {
      referenceState = TourgridStorage.defaultReference();
      overlayVisible = false;
      document.getElementById('overlayControls').hidden = true;
      saveToStorage(true);
      return;
    }
    await setImportedPreviewBlob(record.blob);
    document.getElementById('overlayControls').hidden = false;
    syncOverlayControls();
    renderOverlay();
  } catch (error) {
    overlayVisible = false;
    document.getElementById('overlayControls').hidden = true;
    syncOverlayControls();
    showToast('参考图恢复失败，像素作品不受影响');
  }
}

function clearReferenceImage(removeStoredAsset) {
  var assetId = referenceState.assetId;
  if (importedPreviewObjectUrl) {
    URL.revokeObjectURL(importedPreviewObjectUrl);
    importedPreviewObjectUrl = null;
  }
  importedPreviewImage = null;
  overlayVisible = false;
  overlayOpacity = 0.4;
  referenceState = TourgridStorage.defaultReference();
  var controls = document.getElementById('overlayControls');
  if (controls) controls.hidden = true;
  if (overlayCanvas) overlayCanvas.style.display = 'none';
  if (removeStoredAsset && assetId) {
    TourgridReferenceStorage.remove(assetId).catch(function() {
      // 像素画清空不应被浏览器存储清理失败阻断。
    });
  }
}

async function restoreReferenceFromHistory(referenceSnapshot) {
  var target = referenceSnapshot || {};
  if (!target.assetId) {
    if (target.sessionOnly && referenceState.sessionOnly && importedPreviewImage) {
      document.getElementById('overlayControls').hidden = false;
      syncOverlayControls();
      renderOverlay();
      return;
    }
    if (referenceState.assetId || importedPreviewImage) clearReferenceImage(false);
    return;
  }

  if (target.assetId === referenceState.assetId && importedPreviewImage) {
    document.getElementById('overlayControls').hidden = false;
    syncOverlayControls();
    renderOverlay();
    return;
  }

  var record = await TourgridReferenceStorage.load(target.assetId);
  if (!record || !record.blob) {
    throw new Error('撤销记录中的参考图已不可用。');
  }

  var retainedVisibility = overlayVisible;
  var retainedOpacity = overlayOpacity;
  await setImportedPreviewBlob(record.blob);
  referenceState = {
    assetId: record.id,
    mimeType: record.mimeType || target.mimeType || 'image/webp',
    width: record.width || target.width || REFERENCE_IMAGE_SIZE,
    height: record.height || target.height || REFERENCE_IMAGE_SIZE,
    visible: retainedVisibility,
    opacity: retainedOpacity
  };
  overlayVisible = retainedVisibility;
  overlayOpacity = retainedOpacity;
  document.getElementById('overlayControls').hidden = false;
  syncOverlayControls();
  renderOverlay();
}

function cancelCrop() {
  document.getElementById('cropOverlay').classList.remove('show');
  cropImg = null;
}

function reImportCurrent() {
  if (!cropImg) {
    // 无缓存图片，打开文件选择
    document.getElementById('importFileInput').click();
    return;
  }
  // 重新打开裁切对话框，保留之前的缩放/位置
  document.getElementById('cropOverlay').classList.add('show');
  applyCropTransform();
  showToast('已重新打开裁切');
}

// --- 参考图叠加 ---
function renderOverlay() {
  if (!overlayVisible || !importedPreviewImage || !importedPreviewImage.complete) {
    overlayCanvas.style.display = 'none';
    return;
  }
  var cellSize = BASE_CELL_SIZE * (zoom / 100);
  var w = GRID_SIZE * cellSize;
  overlayCanvas.width = w;
  overlayCanvas.height = w;
  overlayCanvas.style.display = 'block';
  overlayCtx.clearRect(0, 0, w, w);
  overlayCtx.globalAlpha = overlayOpacity;
  overlayCtx.imageSmoothingEnabled = true;
  overlayCtx.drawImage(importedPreviewImage, 0, 0, w, w);
  overlayCtx.globalAlpha = 1;
  drawCanvasCenterAxes(overlayCtx, w, w);
}

function toggleOverlay() {
  overlayVisible = !overlayVisible;
  syncOverlayControls();
  renderOverlay();
  saveToStorage(true);
}

function syncOverlayControls() {
  var button = document.getElementById('overlayToggleBtn');
  var label = document.getElementById('overlayToggleLabel');
  var opacityInput = document.getElementById('overlayOpacity');
  var opacityControl = document.getElementById('overlayOpacityControl');
  var opacityValue = document.getElementById('overlayOpacityVal');
  if (!button || !label || !opacityInput || !opacityControl) return;

  var opacityPercent = Math.round(overlayOpacity * 100);
  opacityInput.value = opacityPercent;
  if (opacityValue) opacityValue.textContent = opacityPercent + '%';
  button.classList.toggle('active', overlayVisible);
  button.setAttribute('aria-checked', String(overlayVisible));
  label.textContent = overlayVisible ? '开启' : '关闭';
  opacityInput.disabled = !overlayVisible;
  opacityControl.hidden = !overlayVisible;
}

function updateOverlayOpacity(val) {
  overlayOpacity = parseInt(val) / 100;
  document.getElementById('overlayOpacityVal').textContent = val + '%';
  if (overlayVisible) renderOverlay();
}

// --- 缂傗晜鏂?---
// 根据画布格子数动态计算最小缩放(画布撑满400px即可)
