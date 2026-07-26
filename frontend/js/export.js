function exportTimestamp() {
  var now = new Date();
  return (''+now.getFullYear()).slice(2) + '.' + (now.getMonth()+1) + '.' + now.getDate() + '_' +
         ('0'+now.getHours()).slice(-2) + '.' + ('0'+now.getMinutes()).slice(-2);
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
  showToast('已导出最近邻放大图 (' + scale + '×)');
}

// --- 导出下拉 ---
function toggleExportDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('exportDropdown');
  var beadBtn = document.getElementById('exportBeadBtn');
  var warning = document.getElementById('exportWarning');

  if (dd.classList.contains('show')) {
    dd.classList.remove('show');
    return;
  }

  // 检查是否为拼豆色卡模式
  if (paletteMode === 'official') {
    beadBtn.style.display = 'flex';
    warning.style.display = 'none';
  } else {
    beadBtn.style.display = 'none';
    warning.style.display = 'block';
  }

  // 根据按钮位置定位下拉框（使用元素实际宽度，避免硬编码）
  var btn = e && e.currentTarget ? e.currentTarget : document.querySelector('.btn-primary');
  if (!btn) return;
  var rect = btn.getBoundingClientRect();
  var ddWidth = dd.offsetWidth || 220;
  dd.style.top = (rect.bottom + 4) + 'px';
  // 右侧对齐按钮，但不超出屏幕
  var left = rect.right - ddWidth;
  if (left < 4) left = 4;
  if (left + ddWidth > window.innerWidth - 4) left = window.innerWidth - ddWidth - 4;
  dd.style.left = left + 'px';

  dd.classList.add('show');
}

function hideExportDropdown() {
  var dd = document.getElementById('exportDropdown');
  if (dd) dd.classList.remove('show');
}

function exportPixelImage() {
  exportRawPixelImage();
}

function exportBeadBlueprint() {
  hideExportDropdown();

  var BOARD = 26;  // 标准拼板尺寸
  var A4_W = 2480, A4_H = 3508;
  var MARGIN = 100;

  // ---- 按BOARD(26)计算单元格大小（A4宽度）----
  var availW = A4_W - MARGIN * 2;
  var CELL = Math.floor(availW / (BOARD + 1.4));
  var LABEL = Math.max(34, Math.round(CELL * 0.80));
  CELL = Math.floor((availW - LABEL * 2) / BOARD);
  var FONT_SZ = Math.max(6, Math.round(CELL * 0.22));
  var CIRCLE_R = Math.max(5, Math.floor(CELL * 0.38));

  // ---- 将全部像素映射到最近官方色板颜色（全局映射）----
  var paletteRGB = OFFICIAL_COLORS.map(function(e) {
    var h = paletteHex(e);
    return {
      hex: h,
      code: paletteCode(e),
      r: parseInt(h.slice(1,3), 16),
      g: parseInt(h.slice(3,5), 16),
      b: parseInt(h.slice(5,7), 16)
    };
  });

  var beadMap = [];  // [y][x] = {hex, code}
  for (var y = 0; y < GRID_SIZE; y++) {
    beadMap[y] = [];
    for (var x = 0; x < GRID_SIZE; x++) {
      var px = pixelData[y][x];
      var r = parseInt(px.slice(1,3), 16);
      var g = parseInt(px.slice(3,5), 16);
      var b = parseInt(px.slice(5,7), 16);
      var best = paletteRGB[0], bestD = Infinity;
      for (var i = 0; i < paletteRGB.length; i++) {
        var d = colorDistRGB(r, g, b, paletteRGB[i].r, paletteRGB[i].g, paletteRGB[i].b);
        if (d < bestD) { bestD = d; best = paletteRGB[i]; }
      }
      beadMap[y][x] = best;
    }
  }

  // ---- 全局颜色统计（用于full总览 + 每板显示"板/总"）----
  var globalColorUsed = {};
  var globalColorList = [];
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var cell = beadMap[y][x];
      if (!globalColorUsed[cell.hex]) {
        globalColorUsed[cell.hex] = { hex: cell.hex, code: cell.code, count: 0 };
        globalColorList.push(globalColorUsed[cell.hex]);
      }
      globalColorUsed[cell.hex].count++;
    }
  }
  globalColorList.sort(function(a, b) {
    return (a.code || '').localeCompare(b.code || '', undefined, {numeric: true});
  });
  var globalTotal = 0;
  for (var i = 0; i < globalColorList.length; i++) {
    globalTotal += globalColorList[i].count;
  }
  // hex→全局数量查表
  var hexToGlobalCount = {};
  for (var i = 0; i < globalColorList.length; i++) {
    hexToGlobalCount[globalColorList[i].hex] = globalColorList[i].count;
  }

  // 时间戳: "26.7.26_06.46"
  var now = new Date();
  var ts = (''+now.getFullYear()).slice(2) + '.' + (now.getMonth()+1) + '.' + now.getDate() + '_' +
           ('0'+now.getHours()).slice(-2) + '.' + ('0'+now.getMinutes()).slice(-2);

  // 获取当前色板品牌名
  var paletteLabel = '';
  for (var pi = 0; pi < PALETTE_DEFS.length; pi++) {
    if (PALETTE_DEFS[pi].id === currentPaletteId) { paletteLabel = PALETTE_DEFS[pi].label; break; }
  }

  // ========== 1. 导出整体总览图 (_full) ==========
  (function() {
    // 根据GRID_SIZE计算单元格
    var fullCELL = Math.floor(availW / (GRID_SIZE + 1.4));
    var fullLABEL = Math.max(34, Math.round(fullCELL * 0.80));
    fullCELL = Math.floor((availW - fullLABEL * 2) / GRID_SIZE);
    var fullFONT = Math.max(5, Math.round(fullCELL * 0.22));
    var fullCR = Math.max(4, Math.floor(fullCELL * 0.38));
    var showText = fullCELL >= 28;
    var fullGridW = GRID_SIZE * fullCELL;
    var fullGridH = GRID_SIZE * fullCELL;

    // 图例（2.5倍大）
    var fLegCols = globalColorList.length <= 6 ? 2 : (globalColorList.length <= 15 ? 3 : 4);
    var fLegRows = Math.ceil(globalColorList.length / fLegCols);
    var fOriginX = Math.floor((A4_W - (fullLABEL + fullGridW + fullLABEL)) / 2);
    var fOriginY = MARGIN;

    var cvs = document.createElement('canvas');
    cvs.width = A4_W; cvs.height = A4_H;
    var ctx = cvs.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, A4_W, A4_H);

    var fLeft = fOriginX + fullLABEL;
    var fTop = fOriginY + fullLABEL;

    // 标题
    ctx.fillStyle = '#333';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('总览  ' + GRID_SIZE + '×' + GRID_SIZE, fOriginX, fOriginY - 40);

    // 坐标轴
    var axisFont = Math.max(11, Math.round(fullFONT * 1.5));
    ctx.fillStyle = '#333';
    ctx.font = 'bold ' + axisFont + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var showEvery = GRID_SIZE > 60 ? 10 : (GRID_SIZE > 30 ? 5 : 1);
    for (var x = 0; x < GRID_SIZE; x++) {
      if (x % showEvery === 0) {
        ctx.fillText(x + 1, fLeft + x * fullCELL + fullCELL/2, fOriginY + fullLABEL/2);
        ctx.fillText(x + 1, fLeft + x * fullCELL + fullCELL/2, fTop + fullGridH + fullLABEL/2);
      }
    }
    ctx.textAlign = 'right';
    for (var y = 0; y < GRID_SIZE; y++) {
      if (y % showEvery === 0) {
        ctx.fillText(y + 1, fLeft - 12, fTop + y * fullCELL + fullCELL/2);
      }
    }
    ctx.textAlign = 'left';
    for (var y = 0; y < GRID_SIZE; y++) {
      if (y % showEvery === 0) {
        ctx.fillText(y + 1, fLeft + fullGridW + 12, fTop + y * fullCELL + fullCELL/2);
      }
    }

    // 单元格
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var y = 0; y < GRID_SIZE; y++) {
      for (var x = 0; x < GRID_SIZE; x++) {
        var gx = fLeft + x * fullCELL;
        var gy = fTop + y * fullCELL;
        var cell = beadMap[y][x];
        ctx.fillStyle = cell.hex;
        ctx.fillRect(gx, gy, fullCELL, fullCELL);
        if (showText) {
          var ccx = gx + fullCELL/2, ccy = gy + fullCELL/2;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath(); ctx.arc(ccx, ccy, fullCR + 1.5, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = cell.hex;
          ctx.beginPath(); ctx.arc(ccx, ccy, fullCR, 0, Math.PI*2); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5; ctx.stroke();
          var rr2 = parseInt(cell.hex.slice(1,3), 16);
          var gg2 = parseInt(cell.hex.slice(3,5), 16);
          var bb2 = parseInt(cell.hex.slice(5,7), 16);
          ctx.fillStyle = (0.299*rr2+0.587*gg2+0.114*bb2) > 140 ? '#000' : '#FFF';
          ctx.font = 'bold ' + fullFONT + 'px monospace';
          ctx.fillText(cell.code || '', ccx, ccy);
        }
      }
    }

    // 网格线
    ctx.strokeStyle = '#CCC'; ctx.lineWidth = 0.5;
    for (var x = 0; x <= GRID_SIZE; x++) {
      ctx.beginPath(); ctx.moveTo(fLeft + x*fullCELL, fTop); ctx.lineTo(fLeft + x*fullCELL, fTop + fullGridH); ctx.stroke();
    }
    for (var y = 0; y <= GRID_SIZE; y++) {
      ctx.beginPath(); ctx.moveTo(fLeft, fTop + y*fullCELL); ctx.lineTo(fLeft + fullGridW, fTop + y*fullCELL); ctx.stroke();
    }

    // 图例 (2.5倍)
    var fLegX = fOriginX + fullLABEL;
    var fLegY = fTop + fullGridH + fullLABEL + 100;
    var fLegAvail = fullGridW + fullLABEL;
    var fColW = Math.floor(fLegAvail / fLegCols);
    var fRowH = 65;
    ctx.fillStyle = '#333';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('材料清单：' + paletteLabel + '（总览）', fLegX, fLegY);
    fLegY += 60;
    ctx.textBaseline = 'top';
    for (var i = 0; i < globalColorList.length; i++) {
      var col = i % fLegCols;
      var row = Math.floor(i / fLegCols);
      var ex = fLegX + col * fColW;
      var ey = fLegY + row * fRowH;
      var c = globalColorList[i];
      ctx.fillStyle = c.hex;
      ctx.fillRect(ex, ey + 3, 50, 40);
      ctx.strokeStyle = '#999'; ctx.lineWidth = 0.5;
      ctx.strokeRect(ex, ey + 3, 50, 40);
      ctx.fillStyle = '#333';
      ctx.font = '30px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(c.code + '  ×' + c.count, ex + 58, ey + 3);
    }
    // 材料清单条目结束，总计锚定底部
    var fTotalY = A4_H - MARGIN;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fLegX, fTotalY - 55); ctx.lineTo(fLegX + fLegAvail, fTotalY - 55); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 38px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('总计: ' + globalTotal + ' 颗  |  色数: ' + globalColorList.length + '  |  拼板: ' +
      Math.ceil(GRID_SIZE/BOARD) + '×' + Math.ceil(GRID_SIZE/BOARD), fLegX, fTotalY);

    var link = document.createElement('a');
    link.download = ts + '_full.png';
    link.href = cvs.toDataURL('image/png');
    link.click();
  })();

  // ========== 2. 分板导出（仅当需要多板时）==========
  var boardsX = Math.ceil(GRID_SIZE / BOARD);
  var boardsY = Math.ceil(GRID_SIZE / BOARD);
  var totalBoards = boardsX * boardsY;

  if (totalBoards > 1) {
    var gridW = BOARD * CELL;
    var gridH = BOARD * CELL;

    var idx = 0;
    for (var by = 0; by < boardsY; by++) {
    for (var bx = 0; bx < boardsX; bx++) {
      idx++;

      // ---- 提取本板数据 ----
      var boardBeadMap = [];
      var boardColorUsed = {};
      var boardColorList = [];

      for (var y = 0; y < BOARD; y++) {
        boardBeadMap[y] = [];
        for (var x = 0; x < BOARD; x++) {
          var srcX = bx * BOARD + x;
          var srcY = by * BOARD + y;
          if (srcX < GRID_SIZE && srcY < GRID_SIZE) {
            var cell = beadMap[srcY][srcX];
            boardBeadMap[y][x] = cell;
            if (!boardColorUsed[cell.hex]) {
              boardColorUsed[cell.hex] = { hex: cell.hex, code: cell.code, count: 0 };
              boardColorList.push(boardColorUsed[cell.hex]);
            }
            boardColorUsed[cell.hex].count++;
          } else {
            boardBeadMap[y][x] = null; // 空白格
          }
        }
      }

      // 按色号排序
      boardColorList.sort(function(a, b) {
        return (a.code || '').localeCompare(b.code || '', undefined, {numeric: true});
      });
      var boardTotal = 0;
      for (var i = 0; i < boardColorList.length; i++) {
        boardTotal += boardColorList[i].count;
      }

      // ---- 图例布局 (2.5倍) ----
      var legendCols = boardColorList.length <= 4 ? 2 : (boardColorList.length <= 10 ? 3 : 4);
      var legendRows = Math.ceil(boardColorList.length / legendCols);
      var LEG_ROW_H = 65;

      // ---- 创建A4画布 ----
      var originX = Math.floor((A4_W - (LABEL + gridW + LABEL)) / 2);
      var originY = MARGIN;

      var offCanvas = document.createElement('canvas');
      offCanvas.width = A4_W;
      offCanvas.height = A4_H;
      var ctx = offCanvas.getContext('2d');

      // 白底
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, A4_W, A4_H);

      // 辅助
      function isLight(hex) {
        var rr = parseInt(hex.slice(1,3), 16);
        var gg = parseInt(hex.slice(3,5), 16);
        var bb = parseInt(hex.slice(5,7), 16);
        return (0.299 * rr + 0.587 * gg + 0.114 * bb) > 140;
      }

      var gLeft = originX + LABEL;
      var gTop  = originY + LABEL;

      // 本板绝对坐标起始值（1-based）
      var absX0 = bx * BOARD + 1;
      var absY0 = by * BOARD + 1;

      // ---- 板号标题 ----
      ctx.fillStyle = '#333';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('板 ' + idx + '/' + totalBoards, originX, originY - 15);

      // ---- 列号（顶部）----
      ctx.fillStyle = '#333';
      ctx.font = 'bold ' + Math.max(11, Math.round(FONT_SZ * 1.3)) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var x = 0; x < BOARD; x++) {
        var cx = gLeft + x * CELL + CELL / 2;
        ctx.fillText(absX0 + x, cx, originY + LABEL / 2);
      }

      // ---- 行号（左侧）----
      ctx.textAlign = 'right';
      for (var y = 0; y < BOARD; y++) {
        var ry = gTop + y * CELL + CELL / 2;
        ctx.fillText(absY0 + y, gLeft - 12, ry);
      }

      // ---- 列号（底部）----
      ctx.textAlign = 'center';
      var bottomY = gTop + gridH + LABEL / 2;
      for (var x = 0; x < BOARD; x++) {
        ctx.fillText(absX0 + x, gLeft + x * CELL + CELL / 2, bottomY);
      }

      // ---- 行号（右侧）----
      ctx.textAlign = 'left';
      var rightX = gLeft + gridW + 12;
      for (var y = 0; y < BOARD; y++) {
        ctx.fillText(absY0 + y, rightX, gTop + y * CELL + CELL / 2);
      }

      // ---- 单元格 ----
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var y = 0; y < BOARD; y++) {
        for (var x = 0; x < BOARD; x++) {
          var gx = gLeft + x * CELL;
          var gy = gTop + y * CELL;
          var cell = boardBeadMap[y][x];

          if (cell) {
            var ccx = gx + CELL / 2;
            var ccy = gy + CELL / 2;
            var cr = CIRCLE_R;
            var code = cell.code || '';

            ctx.fillStyle = cell.hex;
            ctx.fillRect(gx, gy, CELL, CELL);

            // 白色底圆
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(ccx, ccy, cr + 1.5, 0, Math.PI * 2);
            ctx.fill();

            // 色圆
            ctx.fillStyle = cell.hex;
            ctx.beginPath();
            ctx.arc(ccx, ccy, cr, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // 色号
            ctx.fillStyle = isLight(cell.hex) ? '#000' : '#FFF';
            ctx.font = 'bold ' + FONT_SZ + 'px monospace';
            ctx.fillText(code, ccx, ccy);
          } else {
            // 空白格（超出画布范围）
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(gx, gy, CELL, CELL);
          }
        }
      }

      // ---- 网格线 ----
      ctx.strokeStyle = '#CCC';
      ctx.lineWidth = 0.5;
      for (var x = 0; x <= BOARD; x++) {
        ctx.beginPath();
        ctx.moveTo(gLeft + x * CELL, gTop);
        ctx.lineTo(gLeft + x * CELL, gTop + gridH);
        ctx.stroke();
      }
      for (var y = 0; y <= BOARD; y++) {
        ctx.beginPath();
        ctx.moveTo(gLeft, gTop + y * CELL);
        ctx.lineTo(gLeft + gridW, gTop + y * CELL);
        ctx.stroke();
      }

      // ---- 图例/材料清单 (2.5倍) ----
      var legX = originX + LABEL;
      var legY = gTop + gridH + LABEL + 100;
      var legAvailW = gridW + LABEL;
      var colW = Math.floor(legAvailW / legendCols);

      // 标题
      ctx.fillStyle = '#333';
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('材料清单：' + paletteLabel + '  (板' + idx + '/' + totalBoards + ')', legX, legY);
      legY += 60;

      // 颜色条目
      ctx.textBaseline = 'top';
      for (var i = 0; i < boardColorList.length; i++) {
        var col = i % legendCols;
        var row = Math.floor(i / legendCols);
        var ex = legX + col * colW;
        var ey = legY + row * LEG_ROW_H;

        var c = boardColorList[i];
        var gCount = hexToGlobalCount[c.hex] || c.count;
        // 色块 (50×40)
        ctx.fillStyle = c.hex;
        ctx.fillRect(ex, ey + 3, 50, 40);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(ex, ey + 3, 50, 40);

        // 色号 + 板用量/总用量
        ctx.fillStyle = '#333';
        ctx.font = '30px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(c.code + '  ×' + c.count + '/' + gCount, ex + 58, ey + 3);
      }

      // 材料清单条目结束，总计锚定底部
      var boardTotalY = A4_H - MARGIN;
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(legX, boardTotalY - 55); ctx.lineTo(legX + legAvailW, boardTotalY - 55); ctx.stroke();
      ctx.fillStyle = '#333';
      ctx.font = 'bold 38px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('板' + idx + ' 合计: ' + boardTotal + ' 颗  |  色数: ' + boardColorList.length,
        legX, boardTotalY);

      // ---- 下载本板 ----
      var link = document.createElement('a');
      link.download = ts + '_' + idx + '.png';
      link.href = offCanvas.toDataURL('image/png');
      link.click();
    }
  }
  } // end if (totalBoards > 1)

  if (totalBoards > 1) {
    showToast('拼豆图纸已导出 (1张总览 + ' + totalBoards + '张分板, ' + ts + ')');
  } else {
    showToast('拼豆图纸已导出 (1张总览, ' + ts + ')');
  }
}

// --- 鐎电厧鍙嗛崶鍓у & 鐟佷礁澹€ ---
