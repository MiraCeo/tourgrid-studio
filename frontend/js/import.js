let cropImg = null;
let cropZoom = 100;
let cropMinimumZoom = 10;
let cropMaximumZoom = 500;
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
const SRGB_BYTE_TO_LINEAR = Array.from({ length: 256 }, function(_, value) {
  var normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
});
let cropContrast = 100;
let cropBrightness = 100;
let cropSaturation = 100;
let cropColorOverlay = '#4299E1';
let cropColorOverlayOpacity = 0;
let cropTargetColorCount = 64;
let cropDitherStrength = 100;
let cropPreviewMode = 'processed';
let cropPreviewTimer = null;
let cropPreviewResult = null;

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
      var embedded = TOURGRID_NATURAL_64_V2.colors[index];
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
  document.querySelectorAll(
    '#cropOverlay input, #cropOverlay select, #cropOverlay button'
  ).forEach(function(control) {
    if (control.id !== 'cancelCropBtn') control.disabled = busy;
  });
}

function setConversionStatus(message, isError, showRetry) {
  var box = document.getElementById('conversionStatus');
  box.classList.toggle('show', Boolean(message));
  box.classList.toggle('error', Boolean(isError));
  document.getElementById('conversionStatusText').textContent = message || '';
  box.querySelector('.conversion-spinner').style.display = message && !isError ? '' : 'none';
  document.getElementById('conversionRetryBtn').style.display = showRetry ? 'inline-flex' : 'none';
}

function resetCropAdjustments() {
  cropContrast = 100;
  cropBrightness = 100;
  cropSaturation = 100;
  cropColorOverlay = '#4299E1';
  cropColorOverlayOpacity = 0;
  cropTargetColorCount = 64;
  cropDitherStrength = 100;
  cropPreviewMode = 'processed';
  cropPreviewResult = null;

  var values = {
    cropContrast: 100,
    cropBrightness: 100,
    cropSaturation: 100,
    cropColorOverlay: cropColorOverlay,
    cropColorOverlayOpacity: 0,
    cropTargetColorCount: 64,
    cropDitherStrength: 100
  };
  Object.keys(values).forEach(function(id) {
    var element = document.getElementById(id);
    if (element) element.value = values[id];
  });
  updateCropAdjustmentLabels();
  syncCropDitherControls();
  syncCropPreviewMode();
}

function updateCropAdjustmentLabels() {
  var controls = [
    ['cropContrast', 'cropContrastVal', '%'],
    ['cropBrightness', 'cropBrightnessVal', '%'],
    ['cropSaturation', 'cropSaturationVal', '%'],
    ['cropColorOverlayOpacity', 'cropColorOverlayOpacityVal', '%'],
    ['cropTargetColorCount', 'cropTargetColorCountVal', ' 色'],
    ['cropDitherStrength', 'cropDitherStrengthVal', '%']
  ];
  controls.forEach(function(item) {
    var input = document.getElementById(item[0]);
    var output = document.getElementById(item[1]);
    if (input && output) output.textContent = input.value + item[2];
  });
}

function updateCropAdjustments() {
  cropContrast = parseInt(document.getElementById('cropContrast').value, 10);
  cropBrightness = parseInt(document.getElementById('cropBrightness').value, 10);
  cropSaturation = parseInt(document.getElementById('cropSaturation').value, 10);
  cropColorOverlay = document.getElementById('cropColorOverlay').value.toUpperCase();
  cropColorOverlayOpacity = parseInt(
    document.getElementById('cropColorOverlayOpacity').value,
    10
  );
  cropTargetColorCount = parseInt(
    document.getElementById('cropTargetColorCount').value,
    10
  );
  cropDitherStrength = parseInt(
    document.getElementById('cropDitherStrength').value,
    10
  );
  updateCropAdjustmentLabels();
  scheduleCropPreview();
}

function syncCropDitherControls() {
  var ditherMode = document.getElementById('cropDither').value;
  var strengthControl = document.getElementById('cropDitherStrengthControl');
  if (strengthControl) strengthControl.hidden = ditherMode === 'none';
}

function updateCropDitherMode() {
  syncCropDitherControls();
  scheduleCropPreview();
}

function syncCropPreviewMode() {
  var showingPixels = cropPreviewMode === 'pixels';
  var button = document.getElementById('cropPreviewToggleBtn');
  var badge = document.getElementById('cropPreviewBadge');
  if (button) {
    button.setAttribute('aria-pressed', String(showingPixels));
    button.textContent = showingPixels ? '查看原图' : '查看像素化结果';
  }
  if (badge) badge.textContent = showingPixels ? '像素化结果' : '处理后原图';
}

function toggleCropPreviewMode() {
  cropPreviewMode = cropPreviewMode === 'pixels' ? 'processed' : 'pixels';
  syncCropPreviewMode();
  renderCropPreview();
}

function cropFilterString() {
  return [
    'contrast(' + cropContrast + '%)',
    'brightness(' + cropBrightness + '%)',
    'saturate(' + cropSaturation + '%)'
  ].join(' ');
}

function buildProcessedCropCanvas(outputSize) {
  var output = document.createElement('canvas');
  output.width = outputSize;
  output.height = outputSize;
  var outputCtx = output.getContext('2d');
  outputCtx.fillStyle = '#FFFFFF';
  outputCtx.fillRect(0, 0, outputSize, outputSize);
  if (!cropImg) return output;

  var viewport = document.getElementById('cropViewport');
  var viewportSize = viewport.clientWidth;
  var scale = cropZoom / 100;
  var sourceX = -cropImgX / scale;
  var sourceY = -cropImgY / scale;
  var sourceWidth = viewportSize / scale;
  var sourceHeight = viewportSize / scale;
  var sx = Math.max(0, sourceX);
  var sy = Math.max(0, sourceY);
  var sw = Math.min(sourceWidth, cropImg.width - sx);
  var sh = Math.min(sourceHeight, cropImg.height - sy);
  if (sw <= 0 || sh <= 0) return output;

  var imageLayer = document.createElement('canvas');
  imageLayer.width = outputSize;
  imageLayer.height = outputSize;
  var imageCtx = imageLayer.getContext('2d');
  var dx = (sx - sourceX) / sourceWidth * outputSize;
  var dy = (sy - sourceY) / sourceHeight * outputSize;
  var dw = sw / sourceWidth * outputSize;
  var dh = sh / sourceHeight * outputSize;
  imageCtx.filter = cropFilterString();
  imageCtx.drawImage(cropImg, sx, sy, sw, sh, dx, dy, dw, dh);
  imageCtx.filter = 'none';

  if (cropColorOverlayOpacity > 0) {
    imageCtx.globalCompositeOperation = 'source-atop';
    imageCtx.globalAlpha = cropColorOverlayOpacity / 100;
    imageCtx.fillStyle = cropColorOverlay;
    imageCtx.fillRect(0, 0, outputSize, outputSize);
    imageCtx.globalAlpha = 1;
    imageCtx.globalCompositeOperation = 'source-over';
  }
  outputCtx.drawImage(imageLayer, 0, 0);
  return output;
}

function srgbByteToLinear(value) {
  var normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearToSrgbByte(value) {
  var clamped = Math.max(0, Math.min(1, value));
  var normalized = clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return normalized * 255;
}

function selectImportPalette(rawR, rawG, rawB, targetCount) {
  var fullPalette = EXHIBITION_DATA.map(function(color, index) {
    var hex = color.hex.toUpperCase();
    var rgb = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
    return {
      index: index,
      hex: hex,
      rgb: rgb,
      count: 0
    };
  });
  if (fullPalette.length !== 64) {
    throw new Error('本地 natural-64-v2 色板加载失败。');
  }
  if (targetCount >= fullPalette.length) return fullPalette;

  for (var pixelIndex = 0; pixelIndex < rawR.length; pixelIndex++) {
    var bestEntry = fullPalette[0];
    var bestDistance = Infinity;
    fullPalette.forEach(function(entry) {
      var distance = colorDistRGB(
        rawR[pixelIndex],
        rawG[pixelIndex],
        rawB[pixelIndex],
        entry.rgb[0],
        entry.rgb[1],
        entry.rgb[2]
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEntry = entry;
      }
    });
    bestEntry.count++;
  }

  return fullPalette
    .slice()
    .sort(function(a, b) {
      return b.count - a.count || a.index - b.index;
    })
    .slice(0, targetCount)
    .sort(function(a, b) { return a.index - b.index; });
}

function quantizeProcessedCrop(processedCanvas) {
  var sample = 8;
  var hiData = processedCanvas.getContext('2d').getImageData(
    0,
    0,
    processedCanvas.width,
    processedCanvas.height
  ).data;
  var total = GRID_SIZE * GRID_SIZE;
  var rawR = new Float64Array(total);
  var rawG = new Float64Array(total);
  var rawB = new Float64Array(total);

  for (var gy = 0; gy < GRID_SIZE; gy++) {
    for (var gx = 0; gx < GRID_SIZE; gx++) {
      var linearR = 0, linearG = 0, linearB = 0;
      for (var sampleY = 0; sampleY < sample; sampleY++) {
        for (var sampleX = 0; sampleX < sample; sampleX++) {
          var px = gx * sample + sampleX;
          var py = gy * sample + sampleY;
          var dataIndex = (py * processedCanvas.width + px) * 4;
          linearR += SRGB_BYTE_TO_LINEAR[hiData[dataIndex]];
          linearG += SRGB_BYTE_TO_LINEAR[hiData[dataIndex + 1]];
          linearB += SRGB_BYTE_TO_LINEAR[hiData[dataIndex + 2]];
        }
      }
      var rawIndex = gy * GRID_SIZE + gx;
      rawR[rawIndex] = linearToSrgbByte(linearR / (sample * sample));
      rawG[rawIndex] = linearToSrgbByte(linearG / (sample * sample));
      rawB[rawIndex] = linearToSrgbByte(linearB / (sample * sample));
    }
  }

  var palette = selectImportPalette(
    rawR,
    rawG,
    rawB,
    cropTargetColorCount
  );
  var workR = new Float64Array(rawR);
  var workG = new Float64Array(rawG);
  var workB = new Float64Array(rawB);
  var pixels = Array.from({ length: GRID_SIZE }, function() {
    return Array.from({ length: GRID_SIZE }, function() { return '#FFFFFF'; });
  });
  var ditherMode = document.getElementById('cropDither').value;
  var ditherStrength = cropDitherStrength / 100;
  var bayer2 = [
    [0, 2],
    [3, 1]
  ];
  var bayer4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  function nearestEntry(r, g, b) {
    var best = palette[0];
    var bestDistance = Infinity;
    palette.forEach(function(entry) {
      var distance = colorDistRGB(
        r,
        g,
        b,
        entry.rgb[0],
        entry.rgb[1],
        entry.rgb[2]
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    });
    return best;
  }

  function addError(index, er, eg, eb, weight) {
    workR[index] += er * weight * ditherStrength;
    workG[index] += eg * weight * ditherStrength;
    workB[index] += eb * weight * ditherStrength;
  }

  function addErrorAt(x, y, er, eg, eb, weight) {
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    addError(y * GRID_SIZE + x, er, eg, eb, weight);
  }

  function bayerEntry(r, g, b, x, y, matrix) {
    var size = matrix.length;
    var levels = size * size;
    var threshold = (matrix[y % size][x % size] + 0.5) / levels - 0.5;
    var offset = threshold * 48 * ditherStrength;
    return nearestEntry(
      Math.max(0, Math.min(255, r + offset)),
      Math.max(0, Math.min(255, g + offset)),
      Math.max(0, Math.min(255, b + offset))
    );
  }

  for (var y = 0; y < GRID_SIZE; y++) {
    var useSerpentine = ditherMode === 'floyd' || ditherMode === 'atkinson';
    var reverse = useSerpentine && y % 2 === 1;
    var direction = reverse ? -1 : 1;
    for (var step = 0; step < GRID_SIZE; step++) {
      var x = reverse ? GRID_SIZE - 1 - step : step;
      var index = y * GRID_SIZE + x;
      var r = Math.max(0, Math.min(255, workR[index]));
      var g = Math.max(0, Math.min(255, workG[index]));
      var b = Math.max(0, Math.min(255, workB[index]));
      var selected;
      if (ditherMode === 'bayer2') {
        selected = bayerEntry(r, g, b, x, y, bayer2);
      } else if (ditherMode === 'bayer4') {
        selected = bayerEntry(r, g, b, x, y, bayer4);
      } else {
        selected = nearestEntry(r, g, b);
      }
      pixels[y][x] = selected.hex;
      if (
        ditherMode === 'none' ||
        ditherMode === 'bayer2' ||
        ditherMode === 'bayer4' ||
        ditherStrength === 0
      ) continue;

      var er = r - selected.rgb[0];
      var eg = g - selected.rgb[1];
      var eb = b - selected.rgb[2];
      if (ditherMode === 'floyd') {
        addErrorAt(x + direction, y, er, eg, eb, 7 / 16);
        addErrorAt(x - direction, y + 1, er, eg, eb, 3 / 16);
        addErrorAt(x, y + 1, er, eg, eb, 5 / 16);
        addErrorAt(x + direction, y + 1, er, eg, eb, 1 / 16);
      } else if (ditherMode === 'atkinson') {
        var atkinsonErrorR = er / 8;
        var atkinsonErrorG = eg / 8;
        var atkinsonErrorB = eb / 8;
        addErrorAt(x + direction, y, atkinsonErrorR, atkinsonErrorG, atkinsonErrorB, 1);
        addErrorAt(x + direction * 2, y, atkinsonErrorR, atkinsonErrorG, atkinsonErrorB, 1);
        addErrorAt(x - direction, y + 1, atkinsonErrorR, atkinsonErrorG, atkinsonErrorB, 1);
        addErrorAt(x, y + 1, atkinsonErrorR, atkinsonErrorG, atkinsonErrorB, 1);
        addErrorAt(x + direction, y + 1, atkinsonErrorR, atkinsonErrorG, atkinsonErrorB, 1);
        addErrorAt(x, y + 2, atkinsonErrorR, atkinsonErrorG, atkinsonErrorB, 1);
      }
    }
  }

  return {
    pixels: pixels,
    usedColors: new Set(pixels.flat()).size
  };
}

function buildCropConversion() {
  var processedPreview = buildProcessedCropCanvas(REFERENCE_IMAGE_SIZE);
  var processedForQuantization = buildProcessedCropCanvas(GRID_SIZE * 8);
  var quantized = quantizeProcessedCrop(processedForQuantization);
  return {
    pixels: quantized.pixels,
    usedColors: quantized.usedColors,
    processedPreview: processedPreview
  };
}

function renderCropPreview() {
  if (!cropImg) return;
  try {
    cropPreviewResult = buildCropConversion();
    var previewCanvas = document.getElementById('cropPreviewCanvas');
    var viewportSize = document.getElementById('cropViewport').clientWidth;
    previewCanvas.width = viewportSize;
    previewCanvas.height = viewportSize;
    var ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, viewportSize, viewportSize);

    if (cropPreviewMode === 'pixels') {
      var pixelCanvas = document.createElement('canvas');
      pixelCanvas.width = GRID_SIZE;
      pixelCanvas.height = GRID_SIZE;
      var pixelCtx = pixelCanvas.getContext('2d');
      cropPreviewResult.pixels.forEach(function(row, y) {
        row.forEach(function(color, x) {
          pixelCtx.fillStyle = color;
          pixelCtx.fillRect(x, y, 1, 1);
        });
      });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pixelCanvas, 0, 0, viewportSize, viewportSize);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cropPreviewResult.processedPreview, 0, 0, viewportSize, viewportSize);
    }

    document.getElementById('cropPreviewSummary').textContent =
      '实时预览 · 像素结果使用 ' + cropPreviewResult.usedColors + ' 色';
    setConversionStatus('', false, false);
  } catch (error) {
    setConversionStatus(
      error && error.message ? error.message : '无法生成实时预览。',
      true,
      false
    );
  }
}

function scheduleCropPreview(immediate) {
  if (!cropImg) return;
  if (cropPreviewTimer) clearTimeout(cropPreviewTimer);
  if (immediate) {
    cropPreviewTimer = null;
    renderCropPreview();
    return;
  }
  cropPreviewTimer = setTimeout(function() {
    cropPreviewTimer = null;
    renderCropPreview();
  }, 60);
}

function startImport(e) {
  var file = e.target.files[0];
  if (!file) return;
  setConversionStatus('', false, false);
  var reader = new FileReader();
  reader.onload = function(ev) {
    cropImg = new Image();
    cropImg.onload = function() {
      document.getElementById('cropOverlay').classList.add('show');
      var vp = document.getElementById('cropViewport');
      resetCropAdjustments();
      requestAnimationFrame(function() {
        var vpW = vp.clientWidth;
        var scale = Math.max(vpW / cropImg.width, vpW / cropImg.height);
        cropZoom = Math.max(1, Math.round(scale * 100));
        cropMinimumZoom = Math.min(10, cropZoom);
        cropMaximumZoom = Math.max(500, cropZoom * 2);
        var initialScale = cropZoom / 100;
        cropImgX = (vpW - cropImg.width * initialScale) / 2;
        cropImgY = (vpW - cropImg.height * initialScale) / 2;
        var zoomSlider = document.getElementById('cropZoomSlider');
        zoomSlider.min = cropMinimumZoom;
        zoomSlider.max = cropMaximumZoom;
        zoomSlider.value = cropZoom;
        document.getElementById('cropZoomVal').textContent = cropZoom + '%';
        applyCropTransform();
        scheduleCropPreview(true);
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
  img.style.display = 'none';
  const scale = cropZoom / 100;
  img.style.width = (cropImg.width * scale) + 'px';
  img.style.height = (cropImg.height * scale) + 'px';
  img.style.left = cropImgX + 'px';
  img.style.top = cropImgY + 'px';
  scheduleCropPreview();
}

function updateCropZoom(val) {
  const oldScale = cropZoom / 100;
  cropZoom = Math.max(
    cropMinimumZoom,
    Math.min(
      cropMaximumZoom,
      parseInt(val, 10) || cropMinimumZoom
    )
  );
  const newScale = cropZoom / 100;
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
  scheduleCropPreview(true);
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
    cropZoom = Math.max(
      cropMinimumZoom,
      Math.min(
        cropMaximumZoom,
        Math.round(cropTouchState.zoom * ratio)
      )
    );
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
  var step = Math.max(1, Math.round(cropZoom * 0.1));
  var delta = e.deltaY > 0 ? -step : step;
  var newZoom = Math.max(
    cropMinimumZoom,
    Math.min(cropMaximumZoom, cropZoom + delta)
  );
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
    await confirmCropLocalWithAdjustments();
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

async function confirmCropLocalWithAdjustments() {
  if (!cropImg) return;
  var beforeImport = makeEditorSnapshot();
  var conversion = buildCropConversion();
  importedPixelData = conversion.pixels.map(function(row) { return row.slice(); });

  var preparedReference = await installAndPersistReference(
    conversion.processedPreview
  );
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
      width: conversion.processedPreview.width,
      height: conversion.processedPreview.height,
      visible: false,
      opacity: overlayOpacity,
      sessionOnly: true
    };
  }

  replicationCompletedCells.clear();
  replicationHighlightColor = null;
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
    converterVersion: 'browser-weighted-rgb-dither-v3',
    importedAt: new Date().toISOString()
  };
  buildHexCodeMap();
  finishImportedPixels(conversion.usedColors, '本地');
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
  if (cropPreviewTimer) clearTimeout(cropPreviewTimer);
  cropPreviewTimer = null;
  cropPreviewResult = null;
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
  scheduleCropPreview(true);
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

// 根据画布格子数动态计算最小缩放(画布撑满400px即可)
