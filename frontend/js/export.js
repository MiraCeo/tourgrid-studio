function exportTimestamp() {
  var now = new Date();
  return ('' + now.getFullYear()).slice(2) + '.' +
    (now.getMonth() + 1) + '.' + now.getDate() + '_' +
    ('0' + now.getHours()).slice(-2) + '.' +
    ('0' + now.getMinutes()).slice(-2);
}

function buildPixelExportCanvas(scale) {
  var output = document.createElement('canvas');
  output.width = GRID_SIZE * scale;
  output.height = GRID_SIZE * scale;
  var outputCtx = output.getContext('2d');
  outputCtx.imageSmoothingEnabled = false;

  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      outputCtx.fillStyle = pixelData[y][x];
      outputCtx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return output;
}

function downloadCanvasPng(canvas, filename) {
  var link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function exportRawPixelImage() {
  hideExportDropdown();
  downloadCanvasPng(
    buildPixelExportCanvas(1),
    exportTimestamp() + '_' + GRID_SIZE + 'x' + GRID_SIZE + '.png'
  );
  showToast('已导出原始 ' + GRID_SIZE + '×' + GRID_SIZE + ' PNG');
}

function exportPixelPreview() {
  hideExportDropdown();
  var scale = 16;
  downloadCanvasPng(
    buildPixelExportCanvas(scale),
    exportTimestamp() + '_' + GRID_SIZE + 'x' + GRID_SIZE + '_preview.png'
  );
  showToast('已导出最近邻放大图（' + scale + '×）');
}

function toggleExportDropdown(e) {
  if (e) e.stopPropagation();
  var dropdown = document.getElementById('exportDropdown');
  var blueprintButton = document.getElementById('exportBeadBtn');
  var warning = document.getElementById('exportWarning');

  if (dropdown.classList.contains('show')) {
    dropdown.classList.remove('show');
    return;
  }

  if (paletteMode === 'official') {
    blueprintButton.style.display = 'flex';
    warning.style.display = 'none';
  } else {
    blueprintButton.style.display = 'none';
    warning.style.display = 'block';
  }

  var button = e && e.currentTarget
    ? e.currentTarget
    : document.querySelector('.btn-primary');
  if (!button) return;

  var viewportPadding = 8;
  var rect = button.getBoundingClientRect();
  dropdown.style.visibility = 'hidden';
  dropdown.classList.add('show');

  var dropdownWidth = dropdown.offsetWidth || Math.min(220, window.innerWidth - viewportPadding * 2);
  var dropdownHeight = dropdown.offsetHeight;
  var left = rect.right - dropdownWidth;
  if (left < viewportPadding) left = viewportPadding;
  if (left + dropdownWidth > window.innerWidth - viewportPadding) {
    left = window.innerWidth - dropdownWidth - viewportPadding;
  }

  var top = rect.bottom + 6;
  if (top + dropdownHeight > window.innerHeight - viewportPadding) {
    top = rect.top - dropdownHeight - 6;
  }
  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - dropdownHeight - viewportPadding));

  dropdown.style.top = top + 'px';
  dropdown.style.left = left + 'px';
  dropdown.style.visibility = '';
}

function hideExportDropdown() {
  var dropdown = document.getElementById('exportDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

function exportPixelImage() {
  exportRawPixelImage();
}

function getBlueprintData() {
  var paletteByHex = {};
  OFFICIAL_COLORS.forEach(function(entry) {
    var hex = paletteHex(entry).toUpperCase();
    paletteByHex[hex] = {
      hex: hex,
      code: paletteCode(entry)
    };
  });

  var cells = [];
  var usageByHex = {};
  var usedColors = [];

  for (var y = 0; y < GRID_SIZE; y++) {
    cells[y] = [];
    for (var x = 0; x < GRID_SIZE; x++) {
      var pixelHex = String(pixelData[y][x]).toUpperCase();
      var paletteEntry = paletteByHex[pixelHex];

      // 编辑器应始终只包含当前64色库中的颜色。导出时不做近似替换，
      // 以免图纸与用户实际画布不一致。
      if (!paletteEntry) {
        return {
          error: '画布包含色库外颜色 ' + pixelHex +
            '（第' + (y + 1) + '行，第' + (x + 1) + '列）'
        };
      }

      cells[y][x] = paletteEntry;
      if (!usageByHex[pixelHex]) {
        usageByHex[pixelHex] = {
          hex: paletteEntry.hex,
          code: paletteEntry.code,
          count: 0
        };
        usedColors.push(usageByHex[pixelHex]);
      }
      usageByHex[pixelHex].count++;
    }
  }

  usedColors.sort(function(a, b) {
    return (a.code || '').localeCompare(
      b.code || '',
      undefined,
      { numeric: true }
    );
  });

  return {
    cells: cells,
    usedColors: usedColors,
    total: GRID_SIZE * GRID_SIZE
  };
}

function isLightBlueprintColor(hex) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
}

function currentPaletteLabel() {
  var definition = PALETTE_DEFS.find(function(item) {
    return item.id === currentPaletteId;
  });
  return definition ? definition.label : '临时64色色板';
}

function exportBeadBlueprint() {
  hideExportDropdown();

  var blueprint = getBlueprintData();
  if (blueprint.error) {
    showToast('无法导出图纸：' + blueprint.error);
    return;
  }

  var PAGE_WIDTH = 2480;
  var PAGE_HEIGHT = 3508;
  var MARGIN = 100;
  var AXIS_SIZE = 62;
  var GRID_TOP = 180;
  var availableGridWidth = PAGE_WIDTH - MARGIN * 2 - AXIS_SIZE;
  var cellSize = Math.floor(availableGridWidth / GRID_SIZE);
  var gridSize = cellSize * GRID_SIZE;
  var gridLeft = Math.floor((PAGE_WIDTH - gridSize) / 2);
  var gridTop = GRID_TOP + AXIS_SIZE;

  var canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  ctx.fillStyle = '#252525';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    '拼豆图纸 · ' + GRID_SIZE + '×' + GRID_SIZE,
    gridLeft,
    GRID_TOP - 28
  );

  // 仅保留上方列号和左侧行号，避免在四边重复标注。
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (var x = 0; x < GRID_SIZE; x++) {
    ctx.fillText(
      x + 1,
      gridLeft + x * cellSize + cellSize / 2,
      GRID_TOP + AXIS_SIZE / 2
    );
  }

  ctx.textAlign = 'right';
  for (var y = 0; y < GRID_SIZE; y++) {
    ctx.fillText(
      y + 1,
      gridLeft - 14,
      gridTop + y * cellSize + cellSize / 2
    );
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 19px monospace';
  for (var row = 0; row < GRID_SIZE; row++) {
    for (var column = 0; column < GRID_SIZE; column++) {
      var cell = blueprint.cells[row][column];
      var cellX = gridLeft + column * cellSize;
      var cellY = gridTop + row * cellSize;

      ctx.fillStyle = cell.hex;
      ctx.fillRect(cellX, cellY, cellSize, cellSize);
      ctx.fillStyle = isLightBlueprintColor(cell.hex) ? '#111111' : '#FFFFFF';
      ctx.fillText(
        cell.code || '',
        cellX + cellSize / 2,
        cellY + cellSize / 2
      );
    }
  }

  ctx.strokeStyle = '#B8B8B8';
  ctx.lineWidth = 1;
  for (var gridX = 0; gridX <= GRID_SIZE; gridX++) {
    ctx.beginPath();
    ctx.moveTo(gridLeft + gridX * cellSize, gridTop);
    ctx.lineTo(gridLeft + gridX * cellSize, gridTop + gridSize);
    ctx.stroke();
  }
  for (var gridY = 0; gridY <= GRID_SIZE; gridY++) {
    ctx.beginPath();
    ctx.moveTo(gridLeft, gridTop + gridY * cellSize);
    ctx.lineTo(gridLeft + gridSize, gridTop + gridY * cellSize);
    ctx.stroke();
  }

  var legendTop = gridTop + gridSize + 88;
  var legendColumns = 4;
  var legendColumnWidth = Math.floor(gridSize / legendColumns);
  var legendRowHeight = 48;

  ctx.fillStyle = '#252525';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(
    '颜色用量 · ' + currentPaletteLabel(),
    gridLeft,
    legendTop
  );

  legendTop += 54;
  blueprint.usedColors.forEach(function(color, index) {
    var legendColumn = index % legendColumns;
    var legendRow = Math.floor(index / legendColumns);
    var itemX = gridLeft + legendColumn * legendColumnWidth;
    var itemY = legendTop + legendRow * legendRowHeight;

    ctx.fillStyle = color.hex;
    ctx.fillRect(itemX, itemY, 46, 34);
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    ctx.strokeRect(itemX, itemY, 46, 34);

    ctx.fillStyle = '#252525';
    ctx.font = '25px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(
      (color.code || color.hex) + '  ×' + color.count,
      itemX + 56,
      itemY + 2
    );
  });

  var footerY = PAGE_HEIGHT - MARGIN;
  ctx.strokeStyle = '#333333';
  ctx.beginPath();
  ctx.moveTo(gridLeft, footerY - 54);
  ctx.lineTo(gridLeft + gridSize, footerY - 54);
  ctx.stroke();
  ctx.fillStyle = '#252525';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    '总计：' + blueprint.total + ' 格  ·  使用颜色：' +
      blueprint.usedColors.length + ' 种',
    gridLeft,
    footerY
  );

  downloadCanvasPng(
    canvas,
    exportTimestamp() + '_' + GRID_SIZE + 'x' + GRID_SIZE + '_blueprint.png'
  );
  showToast('拼豆图纸已导出');
}
