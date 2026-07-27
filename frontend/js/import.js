let cropImg = null;
let cropZoom = 100;
let cropImgX = 0, cropImgY = 0;
let cropDragStartX = 0, cropDragStartY = 0;
let cropImgStartX = 0, cropImgStartY = 0;
let isCropping = false;

let importedPixelData = null;
let importedPreviewImage = null;
let navShowOriginal = false;
let activeConversionController = null;
let conversionInProgress = false;
let conversionPhaseTimer = null;

function getSelectedConversionOptions() {
  return {
    width: cropGridSize,
    height: cropGridSize,
    paletteId: DEFAULT_PALETTE_ID,
    dither: document.getElementById('cropDither').value
  };
}

function updateConversionModeUI() {
  var mode = document.getElementById('conversionMode').value;
  var note = document.getElementById('conversionNote');
  note.textContent = mode === 'server'
    ? '备用服务器：' + TourgridConversion.describeSettings(getSelectedConversionOptions()) +
      '。裁切图会上传，但不会长期保存。'
    : '本地首选：图片不上传，结果严格限制为 natural-64-v1 的 64 种颜色。';
}

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
  document.getElementById('conversionMode').disabled = busy;
  document.getElementById('cropDither').disabled = busy;
  document.querySelectorAll('.grid-size-btn').forEach(function(button) {
    button.disabled = busy;
  });
}

function setConversionStatus(message, isError, showCancel, showRetry) {
  var box = document.getElementById('conversionStatus');
  box.classList.toggle('show', Boolean(message));
  box.classList.toggle('error', Boolean(isError));
  document.getElementById('conversionStatusText').textContent = message || '';
  box.querySelector('.conversion-spinner').style.display = message && !isError ? '' : 'none';
  document.getElementById('conversionCancelBtn').style.display = showCancel ? '' : 'none';
  document.getElementById('conversionRetryBtn').style.display = showRetry ? 'inline-flex' : 'none';
}

function cancelConversion() {
  if (activeConversionController) activeConversionController.abort();
}

function startImport(e) {
  var file = e.target.files[0];
  if (!file) return;
  setConversionStatus('', false, false, false);
  var reader = new FileReader();
  reader.onload = function(ev) {
    cropImg = new Image();
    cropImg.onload = function() {
      // 閸忓牊妯夌粈鍝勮剨缁愭绱欑涵顔荤箽鐢啫鐪€瑰本鍨氶敍澶涚礉閸愬秷顓哥粻妞剧秴缂?
      document.getElementById('cropOverlay').classList.add('show');
      var vp = document.getElementById('cropViewport');
      // 重置格数选择
      cropGridSize = 24;
      document.querySelectorAll('.grid-size-btn').forEach(function(b) { b.classList.remove('active'); });
      var btn24 = document.getElementById('gridBtn24');
      if (btn24) btn24.classList.add('active');

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

function setCropGridSize(size, btn) {
  cropGridSize = size;
  // 更新按钮激活状态
  document.querySelectorAll('.grid-size-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  updateConversionModeUI();
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

function getCropGeometry() {
  var vpW = document.getElementById('cropViewport').clientWidth;
  var scale = cropZoom / 100;
  return {
    viewportWidth: vpW,
    scale: scale,
    srcX: -cropImgX / scale,
    srcY: -cropImgY / scale,
    srcW: vpW / scale,
    srcH: vpW / scale
  };
}

function canvasToBlob(canvas) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(blob) {
      if (blob) resolve(blob);
      else reject(new Error('无法生成裁切图片。'));
    }, 'image/png');
  });
}

async function createCroppedImageBlob() {
  var crop = getCropGeometry();
  var outputSize = Math.min(8192, Math.max(1, Math.round(crop.srcW)));
  var ratio = outputSize / crop.srcW;
  var canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.drawImage(
    cropImg,
    -crop.srcX * ratio,
    -crop.srcY * ratio,
    cropImg.width * ratio,
    cropImg.height * ratio
  );
  return canvasToBlob(canvas);
}

function setImportedPreview(blob) {
  var objectUrl = URL.createObjectURL(blob);
  importedPreviewImage = new Image();
  importedPreviewImage.onload = function() {
    URL.revokeObjectURL(objectUrl);
    renderNavigator();
    renderOverlay();
  };
  importedPreviewImage.src = objectUrl;
}

function validateHexPixels(data) {
  return TourgridConversion.validateHexPixels(data, cropGridSize);
}

function finishImportedPixels(usedColors, sourceLabel) {
  navShowOriginal = false;
  document.getElementById('cropOverlay').classList.remove('show');
  document.getElementById('navToggleBtn').disabled = false;
  document.getElementById('overlayControls').style.display = '';
  document.getElementById('navToggleBtn').classList.remove('imported-mode');
  document.getElementById('navToggleLabel').textContent = '像素图';

  var fitZoom = Math.floor(480 / (GRID_SIZE * BASE_CELL_SIZE) * 100);
  zoom = Math.max(20, Math.min(100, fitZoom));
  var zoomSlider = document.getElementById('zoomSlider');
  zoomSlider.value = zoom;
  zoomSlider.min = Math.min(20, zoom);
  document.getElementById('zoomValue').textContent = zoom + '%';

  updateCanvasSize();
  renderCanvas();
  renderNavigator();
  renderColorGrid();
  saveToStorage(true);
  showToast(sourceLabel + '转换完成：' + GRID_SIZE + '×' + GRID_SIZE + '，使用 ' + usedColors + ' 种颜色');
}

async function confirmCropServer() {
  var cropBlob = await createCroppedImageBlob();
  setImportedPreview(cropBlob);

  var form = new FormData();
  form.append('image', cropBlob, 'crop.png');
  form.append('width', String(cropGridSize));
  form.append('height', String(cropGridSize));
  form.append('palette_id', DEFAULT_PALETTE_ID);
  form.append('dither', document.getElementById('cropDither').value);
  form.append('sobel', '3');
  form.append('depth', '1');
  form.append('fit', 'stretch');
  form.append('mapping_mode', 'direct');
  form.append('svd', 'true');
  form.append('converter_version', CONVERTER_VERSION);

  activeConversionController = new AbortController();
  setConversionStatus('正在上传裁切图片…', false, true, false);
  conversionPhaseTimer = setTimeout(function() {
    if (conversionInProgress) {
      setConversionStatus('图片已提交，服务器正在转换…', false, true, false);
    }
  }, 350);
  var response = await fetch(API_BASE_URL + '/api/v1/convert', {
    method: 'POST',
    body: form,
    signal: activeConversionController.signal
  });
  clearTimeout(conversionPhaseTimer);
  conversionPhaseTimer = null;
  var payload = null;
  try { payload = await response.json(); } catch (error) {}
  if (!response.ok) {
    throw new Error(TourgridConversion.errorMessage(response.status, payload));
  }

  var convertedPixels = validateHexPixels(payload);
  pushUndo();
  GRID_SIZE = payload.width;
  importedPixelData = convertedPixels.map(function(row) { return row.slice(); });
  pixelData = convertedPixels.map(function(row) { return row.slice(); });
  currentPaletteId = 'exhibition';
  OFFICIAL_COLORS = EXHIBITION_DATA;
  paletteMode = EXHIBITION_DATA.length ? 'official' : 'canvas';
  documentMetadata = {
    sourceMode: 'server',
    paletteId: payload.paletteId,
    editorPaletteId: 'exhibition',
    paletteVersion: payload.paletteVersion,
    converterVersion: payload.converterVersion,
    importedAt: new Date().toISOString()
  };
  buildHexCodeMap();
  finishImportedPixels(payload.usedColors, '服务器');
}

async function confirmCrop() {
  if (!cropImg || conversionInProgress) return;
  var selectedMode = document.getElementById('conversionMode').value;
  setConversionBusy(true);
  setConversionStatus('正在准备裁切图片…', false, true, false);
  try {
    if (selectedMode === 'local') {
      await new Promise(function(resolve) { setTimeout(resolve, 0); });
      confirmCropLocal();
    } else {
      await confirmCropServer();
    }
    setConversionStatus('', false, false, false);
  } catch (error) {
    clearTimeout(conversionPhaseTimer);
    conversionPhaseTimer = null;
    if (error && error.name === 'AbortError') {
      setConversionStatus('转换已取消，可调整设置后重试。', true, false, true);
    } else {
      setConversionStatus(
        (error && error.message ? error.message : '转换失败。') +
          (selectedMode === 'local'
            ? ' 可切换到“服务器 Pyxelate（备用）”重试。'
            : ' 可切换到“浏览器本地转换”继续。'),
        true,
        false,
        true
      );
    }
  } finally {
    activeConversionController = null;
    setConversionBusy(false);
  }
}

function confirmCropLocal() {
  if (!cropImg) return;
  pushUndo();
  // 应用选择的格子数
  GRID_SIZE = cropGridSize;
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
  var PREVIEW_SIZE = 256;
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
  importedPreviewImage = new Image();
  importedPreviewImage.src = rawPreview.toDataURL();

  pixelData = importedPixelData.map(function(row) { return row.slice(); });
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
}

function cancelCrop() {
  if (conversionInProgress) cancelConversion();
  clearTimeout(conversionPhaseTimer);
  conversionPhaseTimer = null;
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
  if (isStatisticsMode()) {
    renderStatisticsHighlightOverlay();
    return;
  }

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
  var btn = document.getElementById('overlayToggleBtn');
  if (overlayVisible) {
    btn.textContent = '参考图 ON';
    btn.style.background = '#4A90D9';
    btn.style.color = '#fff';
  } else {
    btn.textContent = '参考图 OFF';
    btn.style.background = '#444';
    btn.style.color = '#aaa';
  }
  renderOverlay();
}

function updateOverlayOpacity(val) {
  overlayOpacity = parseInt(val) / 100;
  document.getElementById('overlayOpacityVal').textContent = val + '%';
  if (overlayVisible) renderOverlay();
}

function toggleViewMode() {
  // 閸欘亜鍨忛幑銏犱箯娓氀冾嚤閼割亜娅掗惃鍕暕鐟欏牆鍞寸€圭櫢绱欓崢鐔锋禈 閳?閸嶅繒绀岄崶鎾呯礆閿涘奔瀵岄悽璇茬娑撳秴褰?
  navShowOriginal = !navShowOriginal;
  var btn = document.getElementById('navToggleBtn');
  var label = document.getElementById('navToggleLabel');
  if (navShowOriginal) {
    btn.classList.add('imported-mode');
    label.textContent = '原图';
  } else {
    btn.classList.remove('imported-mode');
    label.textContent = '像素图';
  }
  renderNavigator();
}

// --- 缂傗晜鏂?---
// 根据画布格子数动态计算最小缩放(画布撑满400px即可)
