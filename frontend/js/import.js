let cropImg = null;
let cropZoom = 100;
let cropMinimumZoom = 10;
let cropMaximumZoom = 500;
let cropImgX = 0, cropImgY = 0;
let cropInitialZoom = 100;
let cropInitialImgX = 0, cropInitialImgY = 0;
let cropDragStartX = 0, cropDragStartY = 0;
let cropImgStartX = 0, cropImgStartY = 0;
let isCropping = false;

let importedPixelData = null;
let importedPreviewImage = null;
let importedPreviewObjectUrl = null;
let conversionInProgress = false;
const REFERENCE_IMAGE_SIZE = 256;
const REFERENCE_WEBP_QUALITY = 0.88;
const IMPORT_SAFE_PIXEL_BUDGET = 6000000;
const IMPORT_SAFE_MAX_EDGE = 4096;
const IMPORT_HEADER_READ_LIMIT = 4 * 1024 * 1024;
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
let cropTargetColorCount = 40;
let cropDitherStrength = 100;
let cropSamplingMode = 'pixel';
let cropPreviewMode = 'processed';
let cropSamplePreviewReturnMode = 'processed';
let cropAlignmentGridVisible = true;
let cropPreviewTimer = null;
let cropPreviewResult = null;
let cropImageLoadToken = 0;
let cropImageObjectUrl = null;
let cropViewportLastSize = 0;
let cropViewportResizeFrame = null;
let cropViewportResizeObserver = null;

async function loadExhibitionPalette() {
  try {
    var response = await fetch(API_BASE_URL + '/api/v1/palettes/' + DEFAULT_PALETTE_ID);
    if (!response.ok) return;
    var data = await response.json();
    if (
      data.id !== DEFAULT_PALETTE_ID ||
      data.version !== DEFAULT_PALETTE_VERSION ||
      !Array.isArray(data.colors) ||
      data.colors.length !== 40
    ) return;
    var matchesEmbeddedPalette = data.colors.every(function(color, index) {
      var embedded = TOURGRID_OFFICIAL_40_V1.colors[index];
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
    // API 不可用时继续使用内置的版本化官方色板。
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
  cropTargetColorCount = 40;
  cropDitherStrength = 100;
  cropSamplingMode = 'pixel';
  cropPreviewMode = 'processed';
  cropSamplePreviewReturnMode = 'processed';
  cropAlignmentGridVisible = true;
  cropPreviewResult = null;

  var values = {
    cropContrast: 100,
    cropBrightness: 100,
    cropSaturation: 100,
    cropColorOverlay: cropColorOverlay,
    cropColorOverlayOpacity: 0,
    cropTargetColorCount: 40,
    cropDitherStrength: 100,
    cropSamplingMode: 'pixel'
  };
  Object.keys(values).forEach(function(id) {
    var element = document.getElementById(id);
    if (element) element.value = values[id];
  });
  var resetButton = document.getElementById('cropResetBtn');
  if (resetButton) resetButton.hidden = true;
  updateCropAdjustmentLabels();
  syncCropDitherControls();
  syncCropPreviewMode();
  syncCropAlignmentGrid();
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

function updateCropSamplingMode() {
  var control = document.getElementById('cropSamplingMode');
  cropSamplingMode = control && control.value === 'photo' ? 'photo' : 'pixel';
  syncCropAlignmentGrid();
  scheduleCropPreview();
}

function syncCropPreviewMode() {
  var button = document.getElementById('cropPreviewToggleBtn');
  var sampleButton = document.getElementById('cropSamplePreviewToggleBtn');
  var badge = document.getElementById('cropPreviewBadge');
  var showingPixels = cropPreviewMode === 'pixels';
  var showingSample = cropPreviewMode === 'sampled';
  if (button) {
    button.dataset.previewMode = cropPreviewMode;
    button.setAttribute('aria-pressed', String(showingPixels));
    button.textContent = showingPixels ? '查看原图' : '查看像素化结果';
  }
  if (sampleButton) {
    sampleButton.setAttribute('aria-pressed', String(showingSample));
    sampleButton.textContent = showingSample
      ? '退出采样参考'
      : '查看采样中间结果';
  }
  if (badge) {
    badge.dataset.previewMode = cropPreviewMode;
    badge.textContent = showingSample
      ? '中间采样 · 非最终效果'
      : (showingPixels ? '色板像素结果' : '处理后原图');
  }
}

function toggleCropPreviewMode() {
  cropPreviewMode = cropPreviewMode === 'pixels' ? 'processed' : 'pixels';
  syncCropPreviewMode();
  renderCropPreview(true);
}

function toggleCropSamplePreview() {
  if (cropPreviewMode === 'sampled') {
    cropPreviewMode = cropSamplePreviewReturnMode;
  } else {
    cropSamplePreviewReturnMode = cropPreviewMode === 'pixels' ? 'pixels' : 'processed';
    cropPreviewMode = 'sampled';
  }
  syncCropPreviewMode();
  renderCropPreview(true);
}

function syncCropAlignmentGrid() {
  var available = cropSamplingMode === 'pixel';
  var grid = document.getElementById('cropAlignmentGrid');
  var button = document.getElementById('cropAlignmentGridToggleBtn');
  if (grid) grid.hidden = !available || !cropAlignmentGridVisible;
  if (button) {
    button.hidden = !available;
    button.setAttribute('aria-pressed', String(cropAlignmentGridVisible));
    button.textContent = cropAlignmentGridVisible ? '隐藏对齐网格' : '显示对齐网格';
  }
}

function toggleCropAlignmentGrid() {
  cropAlignmentGridVisible = !cropAlignmentGridVisible;
  syncCropAlignmentGrid();
}

function cropFilterString() {
  return [
    'contrast(' + cropContrast + '%)',
    'brightness(' + cropBrightness + '%)',
    'saturate(' + cropSaturation + '%)'
  ].join(' ');
}

function buildProcessedCropCanvas(outputSize, preservePixelEdges) {
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
  imageCtx.imageSmoothingEnabled = !preservePixelEdges;
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

function representativePixelColor(imageData, canvasWidth, gx, gy, sample) {
  var margin = Math.max(1, Math.floor(sample / 4));
  var colors = [];
  for (var sampleY = margin; sampleY < sample - margin; sampleY++) {
    for (var sampleX = margin; sampleX < sample - margin; sampleX++) {
      var px = gx * sample + sampleX;
      var py = gy * sample + sampleY;
      var dataIndex = (py * canvasWidth + px) * 4;
      colors.push([
        imageData[dataIndex],
        imageData[dataIndex + 1],
        imageData[dataIndex + 2]
      ]);
    }
  }

  var best = colors[0];
  var bestScore = Infinity;
  colors.forEach(function(candidate) {
    var score = 0;
    colors.forEach(function(sampleColor) {
      score += colorDistRGB(
        candidate[0],
        candidate[1],
        candidate[2],
        sampleColor[0],
        sampleColor[1],
        sampleColor[2]
      );
    });
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

function importHueProfile(r, g, b) {
  var red = Math.max(0, Math.min(255, r));
  var green = Math.max(0, Math.min(255, g));
  var blue = Math.max(0, Math.min(255, b));
  var maximum = Math.max(red, green, blue);
  var minimum = Math.min(red, green, blue);
  var chroma = maximum - minimum;
  var hue = 0;
  if (chroma > 0) {
    if (maximum === red) {
      hue = 60 * (((green - blue) / chroma) % 6);
    } else if (maximum === green) {
      hue = 60 * ((blue - red) / chroma + 2);
    } else {
      hue = 60 * ((red - green) / chroma + 4);
    }
    if (hue < 0) hue += 360;
  }
  return {
    hue: hue,
    chroma: chroma,
    saturation: maximum > 0 ? chroma / maximum : 0
  };
}

function importPaletteDistance(r, g, b, entry) {
  var baseDistance = colorDistRGB(
    r,
    g,
    b,
    entry.rgb[0],
    entry.rgb[1],
    entry.rgb[2]
  );
  var sourceProfile = importHueProfile(r, g, b);
  if (sourceProfile.chroma < 40 || sourceProfile.saturation < 0.35) {
    return baseDistance;
  }

  var candidateProfile = entry.hueProfile || importHueProfile(
    entry.rgb[0],
    entry.rgb[1],
    entry.rgb[2]
  );
  var hueMismatch = 1;
  if (candidateProfile.chroma >= 20 && candidateProfile.saturation >= 0.14) {
    var hueDifference = Math.abs(sourceProfile.hue - candidateProfile.hue);
    hueMismatch = Math.min(hueDifference, 360 - hueDifference) / 180;
  }
  var protectionStrength = Math.min(
    1,
    (sourceProfile.saturation - 0.35) / 0.45
  );
  // 加权 RGB 仍占主导；色相最多只改变 RGB 误差相差约 20% 的候选排序。
  var huePenalty = 0.20 * protectionStrength * Math.pow(hueMismatch, 1.35);
  return baseDistance * (1 + huePenalty);
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
      hueProfile: importHueProfile(rgb[0], rgb[1], rgb[2])
    };
  });
  if (fullPalette.length !== 40) {
    throw new Error('本地 official-40-v1 色板加载失败。');
  }
  if (targetCount >= fullPalette.length) return fullPalette;

  var pixelCount = rawR.length;
  var maxWeightedRgbDistance = Math.sqrt(9 * 255 * 255);
  var importance = new Float64Array(pixelCount);
  var distances = Array.from({ length: pixelCount }, function(_, pixelIndex) {
    var row = new Float64Array(fullPalette.length);
    fullPalette.forEach(function(entry, paletteIndex) {
      row[paletteIndex] = importPaletteDistance(
        rawR[pixelIndex],
        rawG[pixelIndex],
        rawB[pixelIndex],
        entry
      );
    });
    return row;
  });

  for (var pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    var x = pixelIndex % GRID_SIZE;
    var y = Math.floor(pixelIndex / GRID_SIZE);
    var strongestEdge = 0;
    var neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    neighbors.forEach(function(neighbor) {
      var nx = neighbor[0];
      var ny = neighbor[1];
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) return;
      var neighborIndex = ny * GRID_SIZE + nx;
      strongestEdge = Math.max(
        strongestEdge,
        Math.sqrt(colorDistRGB(
          rawR[pixelIndex],
          rawG[pixelIndex],
          rawB[pixelIndex],
          rawR[neighborIndex],
          rawG[neighborIndex],
          rawB[neighborIndex]
        ))
      );
    });
    importance[pixelIndex] = 1 + 0.75 * Math.min(
      1,
      strongestEdge / maxWeightedRgbDistance
    );
  }

  var selected = [];
  var selectedIndexes = new Set();
  var bestDistances = new Float64Array(pixelCount);
  bestDistances.fill(Infinity);
  var limit = Math.max(1, Math.min(targetCount, fullPalette.length));

  while (selected.length < limit) {
    var bestCandidate = null;
    var bestTotalError = Infinity;
    fullPalette.forEach(function(candidate) {
      if (selectedIndexes.has(candidate.index)) return;
      var totalError = 0;
      for (var index = 0; index < pixelCount; index++) {
        totalError += importance[index] * Math.min(
          bestDistances[index],
          distances[index][candidate.index]
        );
      }
      if (
        totalError < bestTotalError ||
        (totalError === bestTotalError && (
          !bestCandidate || candidate.index < bestCandidate.index
        ))
      ) {
        bestCandidate = candidate;
        bestTotalError = totalError;
      }
    });
    if (!bestCandidate) break;
    selected.push(bestCandidate);
    selectedIndexes.add(bestCandidate.index);
    for (var updateIndex = 0; updateIndex < pixelCount; updateIndex++) {
      bestDistances[updateIndex] = Math.min(
        bestDistances[updateIndex],
        distances[updateIndex][bestCandidate.index]
      );
    }
  }

  return selected.sort(function(a, b) { return a.index - b.index; });
}

function rgbBytesToHex(r, g, b) {
  return '#' + [r, g, b].map(function(value) {
    return Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  }).join('').toUpperCase();
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
      var rawIndex = gy * GRID_SIZE + gx;
      if (cropSamplingMode === 'pixel') {
        var representative = representativePixelColor(
          hiData,
          processedCanvas.width,
          gx,
          gy,
          sample
        );
        rawR[rawIndex] = representative[0];
        rawG[rawIndex] = representative[1];
        rawB[rawIndex] = representative[2];
        continue;
      }
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
  var sampledPixels = Array.from({ length: GRID_SIZE }, function(_, y) {
    return Array.from({ length: GRID_SIZE }, function(__, x) {
      var index = y * GRID_SIZE + x;
      return rgbBytesToHex(rawR[index], rawG[index], rawB[index]);
    });
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
      var distance = importPaletteDistance(
        r,
        g,
        b,
        entry
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

  var totalPaletteError = 0;
  for (var sourceIndex = 0; sourceIndex < total; sourceIndex++) {
    var closestSourceEntry = nearestEntry(
      rawR[sourceIndex],
      rawG[sourceIndex],
      rawB[sourceIndex]
    );
    totalPaletteError += colorDistRGB(
      rawR[sourceIndex],
      rawG[sourceIndex],
      rawB[sourceIndex],
      closestSourceEntry.rgb[0],
      closestSourceEntry.rgb[1],
      closestSourceEntry.rgb[2]
    );
  }
  var normalizedPaletteError = Math.sqrt(
    totalPaletteError / (total * 9 * 255 * 255)
  );

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
    sampledPixels: sampledPixels,
    paletteError: normalizedPaletteError,
    usedColors: new Set(pixels.flat()).size
  };
}

function buildCropConversion() {
  var processedPreview = buildProcessedCropCanvas(REFERENCE_IMAGE_SIZE);
  var processedForQuantization = buildProcessedCropCanvas(
    GRID_SIZE * 8,
    cropSamplingMode === 'pixel'
  );
  var quantized = quantizeProcessedCrop(processedForQuantization);
  return {
    pixels: quantized.pixels,
    sampledPixels: quantized.sampledPixels,
    paletteError: quantized.paletteError,
    usedColors: quantized.usedColors,
    processedPreview: processedPreview
  };
}

function drawCropPixelMatrix(ctx, matrix, viewportSize) {
  var pixelCanvas = document.createElement('canvas');
  pixelCanvas.width = GRID_SIZE;
  pixelCanvas.height = GRID_SIZE;
  var pixelCtx = pixelCanvas.getContext('2d');
  matrix.forEach(function(row, y) {
    row.forEach(function(color, x) {
      pixelCtx.fillStyle = color;
      pixelCtx.fillRect(x, y, 1, 1);
    });
  });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pixelCanvas, 0, 0, viewportSize, viewportSize);
}

function cropPaletteFit(error) {
  if (error <= 0.08) return { key: 'good', label: '较好' };
  if (error <= 0.14) return { key: 'fair', label: '一般' };
  return { key: 'poor', label: '偏差较大' };
}

function resolveCropConversion(reuseConversion) {
  var canReuse = Boolean(
    reuseConversion && cropPreviewResult && !cropPreviewTimer
  );
  if (cropPreviewTimer) clearTimeout(cropPreviewTimer);
  cropPreviewTimer = null;
  if (!canReuse) {
    cropPreviewResult = null;
    cropPreviewResult = buildCropConversion();
  }
  return cropPreviewResult;
}

function renderCropPreview(reuseConversion) {
  if (!cropImg) return;
  try {
    resolveCropConversion(reuseConversion);
    var previewCanvas = document.getElementById('cropPreviewCanvas');
    var viewportSize = document.getElementById('cropViewport').clientWidth;
    previewCanvas.width = viewportSize;
    previewCanvas.height = viewportSize;
    var ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, viewportSize, viewportSize);

    if (cropPreviewMode === 'pixels') {
      drawCropPixelMatrix(ctx, cropPreviewResult.pixels, viewportSize);
    } else if (cropPreviewMode === 'sampled') {
      drawCropPixelMatrix(ctx, cropPreviewResult.sampledPixels, viewportSize);
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cropPreviewResult.processedPreview, 0, 0, viewportSize, viewportSize);
    }

    var summary = document.getElementById('cropPreviewSummary');
    if (cropPreviewMode === 'sampled') {
      summary.dataset.paletteFit = 'reference';
      summary.title = '';
      summary.textContent = '中间过程仅供参考，最终效果需查看像素化结果';
    } else {
      var fit = cropPaletteFit(cropPreviewResult.paletteError);
      summary.dataset.paletteFit = fit.key;
      summary.title = '根据24×24真彩采样到当前目标色板的加权RGB误差估算';
      summary.textContent = '像素结果使用 ' + cropPreviewResult.usedColors +
        ' 色 · 色板适配：' + fit.label;
    }
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

function importBytesMatch(view, offset, values) {
  if (offset < 0 || offset + values.length > view.byteLength) return false;
  return values.every(function(value, index) {
    return view.getUint8(offset + index) === value;
  });
}

function readJpegExifOrientation(view, start, length) {
  var end = Math.min(view.byteLength, start + length);
  if (
    start + 14 > end ||
    !importBytesMatch(view, start, [0x45, 0x78, 0x69, 0x66, 0, 0])
  ) return 1;
  var tiff = start + 6;
  var littleEndian;
  if (importBytesMatch(view, tiff, [0x49, 0x49])) {
    littleEndian = true;
  } else if (importBytesMatch(view, tiff, [0x4D, 0x4D])) {
    littleEndian = false;
  } else {
    return 1;
  }
  if (view.getUint16(tiff + 2, littleEndian) !== 42) return 1;
  var ifdOffset = view.getUint32(tiff + 4, littleEndian);
  var ifd = tiff + ifdOffset;
  if (ifd + 2 > end) return 1;
  var entryCount = view.getUint16(ifd, littleEndian);
  for (var index = 0; index < entryCount; index++) {
    var entry = ifd + 2 + index * 12;
    if (entry + 12 > end) break;
    if (
      view.getUint16(entry, littleEndian) === 0x0112 &&
      view.getUint16(entry + 2, littleEndian) === 3 &&
      view.getUint32(entry + 4, littleEndian) >= 1
    ) {
      var orientation = view.getUint16(entry + 8, littleEndian);
      return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}

function readJpegDimensions(view) {
  if (!importBytesMatch(view, 0, [0xFF, 0xD8])) return null;
  var offset = 2;
  var width = 0;
  var height = 0;
  var orientation = 1;
  var sofMarkers = new Set([
    0xC0, 0xC1, 0xC2, 0xC3,
    0xC5, 0xC6, 0xC7,
    0xC9, 0xCA, 0xCB,
    0xCD, 0xCE, 0xCF
  ]);
  while (offset + 4 <= view.byteLength) {
    while (offset < view.byteLength && view.getUint8(offset) === 0xFF) offset++;
    if (offset >= view.byteLength) break;
    var marker = view.getUint8(offset++);
    if (marker === 0xD9 || marker === 0xDA) break;
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (offset + 2 > view.byteLength) break;
    var segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) break;
    var dataStart = offset + 2;
    var dataLength = segmentLength - 2;
    if (marker === 0xE1) {
      var parsedOrientation = readJpegExifOrientation(view, dataStart, dataLength);
      if (parsedOrientation !== 1 || orientation === 1) {
        orientation = parsedOrientation;
      }
    } else if (sofMarkers.has(marker) && dataLength >= 5) {
      height = view.getUint16(dataStart + 1, false);
      width = view.getUint16(dataStart + 3, false);
    }
    offset += segmentLength;
  }
  if (!width || !height) return null;
  if (orientation >= 5 && orientation <= 8) {
    var rotatedWidth = height;
    height = width;
    width = rotatedWidth;
  }
  return { width: width, height: height, format: 'JPEG' };
}

function readPngDimensions(view) {
  if (!importBytesMatch(view, 0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
    return null;
  }
  if (view.byteLength < 24) return null;
  var width = view.getUint32(16, false);
  var height = view.getUint32(20, false);
  return width && height ? { width: width, height: height, format: 'PNG' } : null;
}

function readWebpDimensions(view) {
  if (
    !importBytesMatch(view, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !importBytesMatch(view, 8, [0x57, 0x45, 0x42, 0x50])
  ) return null;
  var offset = 12;
  while (offset + 8 <= view.byteLength) {
    var chunkType = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    var chunkSize = view.getUint32(offset + 4, true);
    var dataStart = offset + 8;
    if (dataStart + chunkSize > view.byteLength) break;
    if (chunkType === 'VP8X' && chunkSize >= 10) {
      return {
        width: 1 + view.getUint8(dataStart + 4) +
          (view.getUint8(dataStart + 5) << 8) +
          (view.getUint8(dataStart + 6) << 16),
        height: 1 + view.getUint8(dataStart + 7) +
          (view.getUint8(dataStart + 8) << 8) +
          (view.getUint8(dataStart + 9) << 16),
        format: 'WebP'
      };
    }
    if (
      chunkType === 'VP8 ' && chunkSize >= 10 &&
      importBytesMatch(view, dataStart + 3, [0x9D, 0x01, 0x2A])
    ) {
      return {
        width: view.getUint16(dataStart + 6, true) & 0x3FFF,
        height: view.getUint16(dataStart + 8, true) & 0x3FFF,
        format: 'WebP'
      };
    }
    if (
      chunkType === 'VP8L' && chunkSize >= 5 &&
      view.getUint8(dataStart) === 0x2F
    ) {
      var bits1 = view.getUint8(dataStart + 1);
      var bits2 = view.getUint8(dataStart + 2);
      var bits3 = view.getUint8(dataStart + 3);
      var bits4 = view.getUint8(dataStart + 4);
      return {
        width: 1 + bits1 + ((bits2 & 0x3F) << 8),
        height: 1 + ((bits2 & 0xC0) >> 6) + (bits3 << 2) +
          ((bits4 & 0x0F) << 10),
        format: 'WebP'
      };
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return null;
}

async function readImportImageDimensions(file) {
  var header = await file.slice(
    0,
    Math.min(file.size, IMPORT_HEADER_READ_LIMIT)
  ).arrayBuffer();
  var view = new DataView(header);
  var dimensions = readPngDimensions(view) ||
    readJpegDimensions(view) ||
    readWebpDimensions(view);
  if (
    !dimensions ||
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width > 100000 ||
    dimensions.height > 100000 ||
    !Number.isSafeInteger(dimensions.width * dimensions.height)
  ) {
    throw new Error('无法安全读取图片尺寸，请选择有效的 PNG、JPEG 或 WebP 图片。');
  }
  return dimensions;
}

function safeImportDimensions(dimensions) {
  var width = dimensions.width;
  var height = dimensions.height;
  var scale = Math.min(
    1,
    IMPORT_SAFE_MAX_EDGE / width,
    IMPORT_SAFE_MAX_EDGE / height,
    Math.sqrt(IMPORT_SAFE_PIXEL_BUDGET / (width * height))
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    downsampled: scale < 1
  };
}

function loadImportHtmlImage(file) {
  return new Promise(function(resolve, reject) {
    var objectUrl = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function() {
      resolve({ image: image, objectUrl: objectUrl });
    };
    image.onerror = function() {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取该图片，请选择 PNG、JPEG 或 WebP 文件。'));
    };
    image.src = objectUrl;
  });
}

async function decodeImportImage(file, dimensions) {
  var target = safeImportDimensions(dimensions);
  if (typeof window.createImageBitmap === 'function') {
    try {
      var bitmap = target.downsampled
        ? await window.createImageBitmap(file, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high'
        })
        : await window.createImageBitmap(file);
      return {
        image: bitmap,
        objectUrl: null,
        downsampled: target.downsampled,
        originalWidth: dimensions.width,
        originalHeight: dimensions.height
      };
    } catch (error) {
      if (target.downsampled) {
        throw new Error('浏览器无法安全缩小这张超大图片，请先在系统相册中降低分辨率。');
      }
    }
  } else if (target.downsampled) {
    throw new Error('当前浏览器不支持超大图片安全降采样，请先降低图片分辨率。');
  }
  var fallback = await loadImportHtmlImage(file);
  return {
    image: fallback.image,
    objectUrl: fallback.objectUrl,
    downsampled: false,
    originalWidth: dimensions.width,
    originalHeight: dimensions.height
  };
}

function disposeCropImage(image, objectUrl) {
  if (image && typeof image.close === 'function') image.close();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

async function startImport(e) {
  var file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  var loadToken = ++cropImageLoadToken;
  setConversionStatus('', false, false);
  try {
    var dimensions = await readImportImageDimensions(file);
    var safeDimensions = safeImportDimensions(dimensions);
    if (safeDimensions.downsampled) showToast('正在安全缩小超大图片…');
    var decoded = await decodeImportImage(file, dimensions);
    if (loadToken !== cropImageLoadToken) {
      disposeCropImage(decoded.image, decoded.objectUrl);
      return;
    }

    disposeCropImage(cropImg, cropImageObjectUrl);
    cropImg = decoded.image;
    cropImageObjectUrl = decoded.objectUrl;
    cropPreviewResult = null;
    cropViewportLastSize = 0;
    document.getElementById('cropOverlay').classList.add('show');
    var vp = document.getElementById('cropViewport');
    resetCropAdjustments();
    requestAnimationFrame(function() {
      if (loadToken !== cropImageLoadToken || !cropImg) return;
      var vpW = vp.clientWidth;
      cropViewportLastSize = vpW;
      var scale = Math.max(vpW / cropImg.width, vpW / cropImg.height);
      cropZoom = Math.max(1, Math.round(scale * 100));
      cropMinimumZoom = Math.min(10, cropZoom);
      cropMaximumZoom = Math.max(500, cropZoom * 2);
      var initialScale = cropZoom / 100;
      cropImgX = (vpW - cropImg.width * initialScale) / 2;
      cropImgY = (vpW - cropImg.height * initialScale) / 2;
      cropInitialZoom = cropZoom;
      cropInitialImgX = cropImgX;
      cropInitialImgY = cropImgY;
      var zoomSlider = document.getElementById('cropZoomSlider');
      zoomSlider.min = cropMinimumZoom;
      zoomSlider.max = cropMaximumZoom;
      zoomSlider.value = cropZoom;
      document.getElementById('cropZoomVal').textContent = cropZoom + '%';
      applyCropTransform();
      scheduleCropPreview(true);
      if (decoded.downsampled) {
        showToast(
          '超大图片已从 ' + decoded.originalWidth + '×' + decoded.originalHeight +
          ' 安全缩小为 ' + cropImg.width + '×' + cropImg.height
        );
      }
    });
  } catch (error) {
    if (loadToken !== cropImageLoadToken) return;
    var message = error && error.message
      ? error.message
      : '读取图片失败，请重试。';
    setConversionStatus(message, true, false);
    showToast(message);
  }
}

function isCropResetControlTarget(target) {
  return Boolean(
    target && target.closest && target.closest('#cropResetBtn')
  );
}

function syncCropResetControl() {
  var button = document.getElementById('cropResetBtn');
  if (!button) return;
  var changed = cropZoom !== cropInitialZoom ||
    Math.abs(cropImgX - cropInitialImgX) > 0.5 ||
    Math.abs(cropImgY - cropInitialImgY) > 0.5;
  button.hidden = !cropImg || !changed;
}

function resetCropTransform(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!cropImg) return;
  isCropping = false;
  cropTouchState = null;
  cropZoom = cropInitialZoom;
  cropImgX = cropInitialImgX;
  cropImgY = cropInitialImgY;
  var slider = document.getElementById('cropZoomSlider');
  slider.value = cropZoom;
  document.getElementById('cropZoomVal').textContent = cropZoom + '%';
  document.getElementById('cropViewport').style.cursor = 'grab';
  applyCropTransform();
  scheduleCropPreview(true);
}

function applyCropTransform() {
  const img = document.getElementById('cropImage');
  img.removeAttribute('src');
  img.style.display = 'none';
  const scale = cropZoom / 100;
  img.style.width = (cropImg.width * scale) + 'px';
  img.style.height = (cropImg.height * scale) + 'px';
  img.style.left = cropImgX + 'px';
  img.style.top = cropImgY + 'px';
  syncCropResetControl();
  scheduleCropPreview();
}

function transformCropForViewportSize(oldSize, newSize, zoomValue, x, y) {
  var oldScale = zoomValue / 100;
  var sourceCenterX = (oldSize / 2 - x) / oldScale;
  var sourceCenterY = (oldSize / 2 - y) / oldScale;
  var newZoom = Math.max(1, Math.round(zoomValue * newSize / oldSize));
  var newScale = newZoom / 100;
  return {
    zoom: newZoom,
    x: newSize / 2 - sourceCenterX * newScale,
    y: newSize / 2 - sourceCenterY * newScale
  };
}

function syncCropViewportSize() {
  var overlay = document.getElementById('cropOverlay');
  var viewport = document.getElementById('cropViewport');
  if (!cropImg || !overlay || !viewport || !overlay.classList.contains('show')) {
    return;
  }
  var newSize = viewport.clientWidth;
  if (!newSize) return;
  if (!cropViewportLastSize) {
    cropViewportLastSize = newSize;
    return;
  }
  if (Math.abs(newSize - cropViewportLastSize) < 0.5) return;

  var current = transformCropForViewportSize(
    cropViewportLastSize,
    newSize,
    cropZoom,
    cropImgX,
    cropImgY
  );
  var initial = transformCropForViewportSize(
    cropViewportLastSize,
    newSize,
    cropInitialZoom,
    cropInitialImgX,
    cropInitialImgY
  );
  cropViewportLastSize = newSize;
  cropZoom = current.zoom;
  cropImgX = current.x;
  cropImgY = current.y;
  cropInitialZoom = initial.zoom;
  cropInitialImgX = initial.x;
  cropInitialImgY = initial.y;
  cropMinimumZoom = Math.min(10, cropInitialZoom, cropZoom);
  cropMaximumZoom = Math.max(500, cropInitialZoom * 2, cropZoom);

  var slider = document.getElementById('cropZoomSlider');
  slider.min = cropMinimumZoom;
  slider.max = cropMaximumZoom;
  slider.value = cropZoom;
  document.getElementById('cropZoomVal').textContent = cropZoom + '%';
  applyCropTransform();
  scheduleCropPreview(true);
}

function scheduleCropViewportSizeSync() {
  if (cropViewportResizeFrame) return;
  cropViewportResizeFrame = requestAnimationFrame(function() {
    cropViewportResizeFrame = null;
    syncCropViewportSize();
  });
}

function initializeCropViewportResizeHandling() {
  var viewport = document.getElementById('cropViewport');
  if (!viewport) return;
  if (typeof ResizeObserver === 'function') {
    if (!cropViewportResizeObserver) {
      cropViewportResizeObserver = new ResizeObserver(
        scheduleCropViewportSizeSync
      );
      cropViewportResizeObserver.observe(viewport);
    }
    return;
  }
  window.addEventListener('resize', scheduleCropViewportSizeSync);
  window.addEventListener('orientationchange', scheduleCropViewportSizeSync);
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
  if (isCropResetControlTarget(e.target)) return;
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
  if (isCropResetControlTarget(e.target)) return;
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
  if (isCropResetControlTarget(e.target)) return;
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
  if (isCropResetControlTarget(e.target)) return;
  e.preventDefault();
  if (e.touches.length === 0) {
    cropTouchState = null;
  } else {
    onCropTouchStart(e);
  }
}

function onCropWheel(e) {
  if (!cropImg) return;
  if (isCropResetControlTarget(e.target)) return;
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
  var conversion = resolveCropConversion(true);
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
    converterVersion: 'browser-weighted-rgb-hue-guard-dither-v6-' + cropSamplingMode,
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
  cropImageLoadToken++;
  if (cropPreviewTimer) clearTimeout(cropPreviewTimer);
  cropPreviewTimer = null;
  if (cropViewportResizeFrame) cancelAnimationFrame(cropViewportResizeFrame);
  cropViewportResizeFrame = null;
  cropViewportLastSize = 0;
  cropPreviewResult = null;
  disposeCropImage(cropImg, cropImageObjectUrl);
  cropImg = null;
  cropImageObjectUrl = null;
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
  scheduleCropViewportSizeSync();
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
