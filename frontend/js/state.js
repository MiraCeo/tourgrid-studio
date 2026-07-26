/* ============================================================
   閸嶅繒绀岄悽鑽ょ椽鏉堟垵娅?- 閺嶇绺鹃柅鏄忕帆
   ============================================================ */

// --- 鐢悂鍣?---
let GRID_SIZE = 24;
const BASE_CELL_SIZE = 16; // 100%缂傗晜鏂侀弮鍓佹畱閸嶅繒绀岄弽鐓庢槀鐎?px)
const NAV_CELL_SIZE = 4;   // 鐎佃壈鍩呴崳銊︾槨娑擃亜鍎氱槐鐘崇壐閻ㄥ嫬鏄傜€?
const API_BASE_URL = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';
const CONVERTER_VERSION = '1.0.0';
const DEFAULT_PALETTE_ID = 'natural-64-v1';
let documentMetadata = TourgridStorage.defaultMetadata();

// 裁切对话框格子数选择
let cropGridSize = 24;
// --- 閼瑰弶婢橀弫鐗堝祦閿涘牆濮╅幀浣瑰絹閸欐牜鏁剧敮鍐ц厬娴ｈ法鏁ゆ０婊嗗閿?--
function getUsedColors() {
  const colorCount = {};
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const c = pixelData[y][x];
      colorCount[c] = (colorCount[c] || 0) + 1;
    }
  }
  // 閹稿濞囬悽銊╊暥濞嗭繝妾锋惔蹇ョ礉閹烘帡娅庣痪顖滄閼冲本娅?
  const sorted = Object.entries(colorCount)
    .filter(([color]) => color !== '#FFFFFF')
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  // 婵绮撻崠鍛儓姒涙垼澹婇崪宀€娅ч懝璇х礄閸╄櫣顢呴懝璇х礆
  if (!sorted.includes('#000000')) sorted.push('#000000');
  sorted.push('#FFFFFF');
  return sorted;
}

function updateColorUsageSummary() {
  var summary = document.getElementById('colorUsageSummary');
  if (!summary || !pixelData.length) return;
  var counts = {};
  var painted = 0;
  for (var y = 0; y < GRID_SIZE; y++) {
    for (var x = 0; x < GRID_SIZE; x++) {
      var color = pixelData[y][x].toUpperCase();
      if (color === '#FFFFFF') continue;
      counts[color] = (counts[color] || 0) + 1;
      painted++;
    }
  }
  summary.textContent = '已用颜色 ' + Object.keys(counts).length + ' 种 · 已绘制 ' + painted + ' 格';
  updateConversionResultSummary();
}

function updateConversionResultSummary() {
  var summary = document.getElementById('conversionResultSummary');
  if (!summary) return;
  var sourceLabels = {
    canvas: '当前画布',
    server: '服务器转换',
    local: '本地备用转换'
  };
  var parts = [sourceLabels[documentMetadata.sourceMode] || '当前画布'];
  if (documentMetadata.paletteId) parts.push(documentMetadata.paletteId);
  if (documentMetadata.paletteVersion !== null) {
    parts.push('色板 v' + documentMetadata.paletteVersion);
  }
  if (documentMetadata.converterVersion) {
    parts.push('转换器 ' + documentMetadata.converterVersion);
  }
  summary.textContent = parts.join(' · ');
}

let currentPaletteIdx = 0;
let overlayVisible = false;   // overlay toggle state
let overlayOpacity = 0.4;      // overlay opacity
let currentColor = '#000000';
let currentTool = 'brush'; // 'brush' | 'eraser'
let paletteMode = 'canvas';       // 'canvas' | 'official'

// ============================================================
// 官方色板数据 — MARD拼豆291色 (来源: beadcolors)
// 数据格式: { code, hex, name }
// 色系: A黄橙 B绿 C蓝 D紫 E粉 F红 G肤色 H灰 M高级灰 P/R/Q/T/Y/ZG特殊色
// ============================================================
// MARD拼豆 — 291色
const MARD_DATA = [
	  { code: "A1", hex: "#FAF4C8", name: "A1" },
	  { code: "A2", hex: "#FFFFD5", name: "A2" },
	  { code: "A3", hex: "#FEFF8B", name: "A3" },
	  { code: "A4", hex: "#FBED56", name: "A4" },
	  { code: "A5", hex: "#F4D738", name: "A5" },
	  { code: "A6", hex: "#FEAC4C", name: "A6" },
	  { code: "A7", hex: "#FE8B4C", name: "A7" },
	  { code: "A8", hex: "#FFDA45", name: "A8" },
	  { code: "A9", hex: "#FF995B", name: "A9" },
	  { code: "A10", hex: "#F77C31", name: "A10" },
	  { code: "A11", hex: "#FFDD99", name: "A11" },
	  { code: "A12", hex: "#FE9F72", name: "A12" },
	  { code: "A13", hex: "#FFC365", name: "A13" },
	  { code: "A14", hex: "#FD543D", name: "A14" },
	  { code: "A15", hex: "#FFF365", name: "A15" },
	  { code: "A16", hex: "#FFFF9F", name: "A16" },
	  { code: "A17", hex: "#FFE36E", name: "A17" },
	  { code: "A18", hex: "#FEBE7D", name: "A18" },
	  { code: "A19", hex: "#FD7C72", name: "A19" },
	  { code: "A20", hex: "#FFD568", name: "A20" },
	  { code: "A21", hex: "#FFE395", name: "A21" },
	  { code: "A22", hex: "#F4F57D", name: "A22" },
	  { code: "A23", hex: "#E6C9B7", name: "A23" },
	  { code: "A24", hex: "#F7F8A2", name: "A24" },
	  { code: "A25", hex: "#FFD67D", name: "A25" },
	  { code: "A26", hex: "#FFC830", name: "A26" },
	  { code: "B1", hex: "#E6EE31", name: "B1" },
	  { code: "B2", hex: "#63F347", name: "B2" },
	  { code: "B3", hex: "#9EF780", name: "B3" },
	  { code: "B4", hex: "#5DE035", name: "B4" },
	  { code: "B5", hex: "#35E352", name: "B5" },
	  { code: "B6", hex: "#65E2A6", name: "B6" },
	  { code: "B7", hex: "#3DAF80", name: "B7" },
	  { code: "B8", hex: "#1C9C4F", name: "B8" },
	  { code: "B9", hex: "#27523A", name: "B9" },
	  { code: "B10", hex: "#95D3C2", name: "B10" },
	  { code: "B11", hex: "#5D722A", name: "B11" },
	  { code: "B12", hex: "#166F41", name: "B12" },
	  { code: "B13", hex: "#CAEB7B", name: "B13" },
	  { code: "B14", hex: "#ADE946", name: "B14" },
	  { code: "B15", hex: "#2E5132", name: "B15" },
	  { code: "B16", hex: "#C5ED9C", name: "B16" },
	  { code: "B17", hex: "#9BB13A", name: "B17" },
	  { code: "B18", hex: "#E6EE49", name: "B18" },
	  { code: "B19", hex: "#24B88C", name: "B19" },
	  { code: "B20", hex: "#C2F0CC", name: "B20" },
	  { code: "B21", hex: "#156A6B", name: "B21" },
	  { code: "B22", hex: "#0B3C43", name: "B22" },
	  { code: "B23", hex: "#303A21", name: "B23" },
	  { code: "B24", hex: "#EEFCA5", name: "B24" },
	  { code: "B25", hex: "#4E846D", name: "B25" },
	  { code: "B26", hex: "#8D7A35", name: "B26" },
	  { code: "B27", hex: "#CCE1AF", name: "B27" },
	  { code: "B28", hex: "#9EE5B9", name: "B28" },
	  { code: "B29", hex: "#C5E254", name: "B29" },
	  { code: "B30", hex: "#E2FCB1", name: "B30" },
	  { code: "B31", hex: "#B0E792", name: "B31" },
	  { code: "B32", hex: "#9CAB5A", name: "B32" },
	  { code: "C1", hex: "#E8FFE7", name: "C1" },
	  { code: "C2", hex: "#A9F9FC", name: "C2" },
	  { code: "C3", hex: "#A0E2FB", name: "C3" },
	  { code: "C4", hex: "#41CCFF", name: "C4" },
	  { code: "C5", hex: "#01ACEB", name: "C5" },
	  { code: "C6", hex: "#50AAF0", name: "C6" },
	  { code: "C7", hex: "#3677D2", name: "C7" },
	  { code: "C8", hex: "#0F54C0", name: "C8" },
	  { code: "C9", hex: "#324BCA", name: "C9" },
	  { code: "C10", hex: "#3EBCE2", name: "C10" },
	  { code: "C11", hex: "#28DDDE", name: "C11" },
	  { code: "C12", hex: "#1C334D", name: "C12" },
	  { code: "C13", hex: "#CDE8FF", name: "C13" },
	  { code: "C14", hex: "#D5FDFF", name: "C14" },
	  { code: "C15", hex: "#22C4C6", name: "C15" },
	  { code: "C16", hex: "#1557A8", name: "C16" },
	  { code: "C17", hex: "#04D1F6", name: "C17" },
	  { code: "C18", hex: "#1D3344", name: "C18" },
	  { code: "C19", hex: "#1887A2", name: "C19" },
	  { code: "C20", hex: "#176DAF", name: "C20" },
	  { code: "C21", hex: "#BEDDFF", name: "C21" },
	  { code: "C22", hex: "#67B4BE", name: "C22" },
	  { code: "C23", hex: "#C8E2FF", name: "C23" },
	  { code: "C24", hex: "#7CC4FF", name: "C24" },
	  { code: "C25", hex: "#A9E5E5", name: "C25" },
	  { code: "C26", hex: "#3CAED8", name: "C26" },
	  { code: "C27", hex: "#D3DFFA", name: "C27" },
	  { code: "C28", hex: "#BBCFED", name: "C28" },
	  { code: "C29", hex: "#34488E", name: "C29" },
	  { code: "D1", hex: "#AEB4F2", name: "D1" },
	  { code: "D2", hex: "#858EDD", name: "D2" },
	  { code: "D3", hex: "#2F54AF", name: "D3" },
	  { code: "D4", hex: "#182A84", name: "D4" },
	  { code: "D5", hex: "#B843C5", name: "D5" },
	  { code: "D6", hex: "#AC7BDE", name: "D6" },
	  { code: "D7", hex: "#8854B3", name: "D7" },
	  { code: "D8", hex: "#E2D3FF", name: "D8" },
	  { code: "D9", hex: "#D5B9F8", name: "D9" },
	  { code: "D10", hex: "#361851", name: "D10" },
	  { code: "D11", hex: "#B9BAE1", name: "D11" },
	  { code: "D12", hex: "#DE9AD4", name: "D12" },
	  { code: "D13", hex: "#B90095", name: "D13" },
	  { code: "D14", hex: "#8B279B", name: "D14" },
	  { code: "D15", hex: "#2F1F90", name: "D15" },
	  { code: "D16", hex: "#E3E1EE", name: "D16" },
	  { code: "D17", hex: "#C4D4F6", name: "D17" },
	  { code: "D18", hex: "#A45EC7", name: "D18" },
	  { code: "D19", hex: "#D8C3D7", name: "D19" },
	  { code: "D20", hex: "#9C32B2", name: "D20" },
	  { code: "D21", hex: "#9A009B", name: "D21" },
	  { code: "D22", hex: "#333A95", name: "D22" },
	  { code: "D23", hex: "#EBDAFC", name: "D23" },
	  { code: "D24", hex: "#7786E5", name: "D24" },
	  { code: "D25", hex: "#494FC7", name: "D25" },
	  { code: "D26", hex: "#DFC2F8", name: "D26" },
	  { code: "E1", hex: "#FDD3CC", name: "E1" },
	  { code: "E2", hex: "#FEC0DF", name: "E2" },
	  { code: "E3", hex: "#FFB7E7", name: "E3" },
	  { code: "E4", hex: "#E8649E", name: "E4" },
	  { code: "E5", hex: "#F551A2", name: "E5" },
	  { code: "E6", hex: "#F13D74", name: "E6" },
	  { code: "E7", hex: "#C63478", name: "E7" },
	  { code: "E8", hex: "#FFDBE9", name: "E8" },
	  { code: "E9", hex: "#E970CC", name: "E9" },
	  { code: "E10", hex: "#D33793", name: "E10" },
	  { code: "E11", hex: "#FCDDD2", name: "E11" },
	  { code: "E12", hex: "#F78FC3", name: "E12" },
	  { code: "E13", hex: "#B5006D", name: "E13" },
	  { code: "E14", hex: "#FFD1BA", name: "E14" },
	  { code: "E15", hex: "#F8C7C9", name: "E15" },
	  { code: "E16", hex: "#FFF3EB", name: "E16" },
	  { code: "E17", hex: "#FFE2EA", name: "E17" },
	  { code: "E18", hex: "#FFC7DB", name: "E18" },
	  { code: "E19", hex: "#FEBAD5", name: "E19" },
	  { code: "E20", hex: "#D8C7D1", name: "E20" },
	  { code: "E21", hex: "#BD9DA1", name: "E21" },
	  { code: "E22", hex: "#B785A1", name: "E22" },
	  { code: "E23", hex: "#937A8D", name: "E23" },
	  { code: "E24", hex: "#E1BCE8", name: "E24" },
	  { code: "F1", hex: "#FD957B", name: "F1" },
	  { code: "F2", hex: "#FC3D46", name: "F2" },
	  { code: "F3", hex: "#F74941", name: "F3" },
	  { code: "F4", hex: "#FC283C", name: "F4" },
	  { code: "F5", hex: "#E7002F", name: "F5" },
	  { code: "F6", hex: "#943630", name: "F6" },
	  { code: "F7", hex: "#971937", name: "F7" },
	  { code: "F8", hex: "#BC0028", name: "F8" },
	  { code: "F9", hex: "#E2677A", name: "F9" },
	  { code: "F10", hex: "#8A4526", name: "F10" },
	  { code: "F11", hex: "#5A2121", name: "F11" },
	  { code: "F12", hex: "#FD4E6A", name: "F12" },
	  { code: "F13", hex: "#F35744", name: "F13" },
	  { code: "F14", hex: "#FFA9AD", name: "F14" },
	  { code: "F15", hex: "#D30022", name: "F15" },
	  { code: "F16", hex: "#FEC2A6", name: "F16" },
	  { code: "F17", hex: "#E69C79", name: "F17" },
	  { code: "F18", hex: "#D37C46", name: "F18" },
	  { code: "F19", hex: "#C1444A", name: "F19" },
	  { code: "F20", hex: "#CD9391", name: "F20" },
	  { code: "F21", hex: "#F7B4C6", name: "F21" },
	  { code: "F22", hex: "#FDC0D0", name: "F22" },
	  { code: "F23", hex: "#F67E66", name: "F23" },
	  { code: "F24", hex: "#E698AA", name: "F24" },
	  { code: "F25", hex: "#E54B4F", name: "F25" },
	  { code: "G1", hex: "#FFE2CE", name: "G1" },
	  { code: "G2", hex: "#FFC4AA", name: "G2" },
	  { code: "G3", hex: "#F4C3A5", name: "G3" },
	  { code: "G4", hex: "#E1B383", name: "G4" },
	  { code: "G5", hex: "#EDB045", name: "G5" },
	  { code: "G6", hex: "#E99C17", name: "G6" },
	  { code: "G7", hex: "#9D5B3E", name: "G7" },
	  { code: "G8", hex: "#753832", name: "G8" },
	  { code: "G9", hex: "#E6B483", name: "G9" },
	  { code: "G10", hex: "#D98C39", name: "G10" },
	  { code: "G11", hex: "#E0C593", name: "G11" },
	  { code: "G12", hex: "#FFC890", name: "G12" },
	  { code: "G13", hex: "#B7714A", name: "G13" },
	  { code: "G14", hex: "#8D614C", name: "G14" },
	  { code: "G15", hex: "#FCF9E0", name: "G15" },
	  { code: "G16", hex: "#F2D9BA", name: "G16" },
	  { code: "G17", hex: "#78524B", name: "G17" },
	  { code: "G18", hex: "#FFE4CC", name: "G18" },
	  { code: "G19", hex: "#E07935", name: "G19" },
	  { code: "G20", hex: "#A94023", name: "G20" },
	  { code: "G21", hex: "#B88558", name: "G21" },
	  { code: "H1", hex: "#FDFBFF", name: "H1" },
	  { code: "H2", hex: "#FEFFFF", name: "H2" },
	  { code: "H3", hex: "#B6B1BA", name: "H3" },
	  { code: "H4", hex: "#89858C", name: "H4" },
	  { code: "H5", hex: "#48464E", name: "H5" },
	  { code: "H6", hex: "#2F2B2F", name: "H6" },
	  { code: "H7", hex: "#000000", name: "H7" },
	  { code: "H8", hex: "#E7D6DB", name: "H8" },
	  { code: "H9", hex: "#EDEDED", name: "H9" },
	  { code: "H10", hex: "#EEE9EA", name: "H10" },
	  { code: "H11", hex: "#CECDD5", name: "H11" },
	  { code: "H12", hex: "#FFF5ED", name: "H12" },
	  { code: "H13", hex: "#F5ECD2", name: "H13" },
	  { code: "H14", hex: "#CFD7D3", name: "H14" },
	  { code: "H15", hex: "#98A6A8", name: "H15" },
	  { code: "H16", hex: "#1D1414", name: "H16" },
	  { code: "H17", hex: "#F1EDED", name: "H17" },
	  { code: "H18", hex: "#FFFDF0", name: "H18" },
	  { code: "H19", hex: "#F6EFE2", name: "H19" },
	  { code: "H20", hex: "#949FA3", name: "H20" },
	  { code: "H21", hex: "#FFFBE1", name: "H21" },
	  { code: "H22", hex: "#CACAD4", name: "H22" },
	  { code: "H23", hex: "#9A9D94", name: "H23" },
	  { code: "M1", hex: "#BCC6B8", name: "M1" },
	  { code: "M2", hex: "#8AA386", name: "M2" },
	  { code: "M3", hex: "#697D80", name: "M3" },
	  { code: "M4", hex: "#E3D2BC", name: "M4" },
	  { code: "M5", hex: "#D0CCAA", name: "M5" },
	  { code: "M6", hex: "#B0A782", name: "M6" },
	  { code: "M7", hex: "#B4A497", name: "M7" },
	  { code: "M8", hex: "#B38281", name: "M8" },
	  { code: "M9", hex: "#A58767", name: "M9" },
	  { code: "M10", hex: "#C5B2BC", name: "M10" },
	  { code: "M11", hex: "#9F7594", name: "M11" },
	  { code: "M12", hex: "#644749", name: "M12" },
	  { code: "M13", hex: "#D19066", name: "M13" },
	  { code: "M14", hex: "#C77362", name: "M14" },
	  { code: "M15", hex: "#757D78", name: "M15" },
	  { code: "P1", hex: "#FCF7F8", name: "P1" },
	  { code: "P2", hex: "#B0A9AC", name: "P2" },
	  { code: "P3", hex: "#AFDCAB", name: "P3" },
	  { code: "P4", hex: "#FEA49F", name: "P4" },
	  { code: "P5", hex: "#EE8C3E", name: "P5" },
	  { code: "P6", hex: "#5FD0A7", name: "P6" },
	  { code: "P7", hex: "#EB9270", name: "P7" },
	  { code: "P8", hex: "#F0D958", name: "P8" },
	  { code: "P9", hex: "#D9D9D9", name: "P9" },
	  { code: "P10", hex: "#D9C7EA", name: "P10" },
	  { code: "P11", hex: "#F3ECC9", name: "P11" },
	  { code: "P12", hex: "#E6EEF2", name: "P12" },
	  { code: "P13", hex: "#AACBEF", name: "P13" },
	  { code: "P14", hex: "#337680", name: "P14" },
	  { code: "P15", hex: "#668575", name: "P15" },
	  { code: "P16", hex: "#FEBF45", name: "P16" },
	  { code: "P17", hex: "#FEA324", name: "P17" },
	  { code: "P18", hex: "#FEB89F", name: "P18" },
	  { code: "P19", hex: "#FFFEEC", name: "P19" },
	  { code: "P20", hex: "#FEBECF", name: "P20" },
	  { code: "P21", hex: "#ECBEBF", name: "P21" },
	  { code: "P22", hex: "#E4A89F", name: "P22" },
	  { code: "P23", hex: "#A56268", name: "P23" },
	  { code: "Q1", hex: "#F2A5E8", name: "Q1" },
	  { code: "Q2", hex: "#E9EC91", name: "Q2" },
	  { code: "Q3", hex: "#FFFF00", name: "Q3" },
	  { code: "Q4", hex: "#FFEBFA", name: "Q4" },
	  { code: "Q5", hex: "#76CEDE", name: "Q5" },
	  { code: "R1", hex: "#D50D21", name: "R1" },
	  { code: "R2", hex: "#F92F83", name: "R2" },
	  { code: "R3", hex: "#FD8324", name: "R3" },
	  { code: "R4", hex: "#F8EC31", name: "R4" },
	  { code: "R5", hex: "#35C75B", name: "R5" },
	  { code: "R6", hex: "#238891", name: "R6" },
	  { code: "R7", hex: "#19779D", name: "R7" },
	  { code: "R8", hex: "#1A60C3", name: "R8" },
	  { code: "R9", hex: "#9A56B4", name: "R9" },
	  { code: "R10", hex: "#FFDB4C", name: "R10" },
	  { code: "R11", hex: "#FFEBFA", name: "R11" },
	  { code: "R12", hex: "#D8D5CE", name: "R12" },
	  { code: "R13", hex: "#55514C", name: "R13" },
	  { code: "R14", hex: "#9FE4DF", name: "R14" },
	  { code: "R15", hex: "#77CEE9", name: "R15" },
	  { code: "R16", hex: "#3ECFCA", name: "R16" },
	  { code: "R17", hex: "#4A867A", name: "R17" },
	  { code: "R18", hex: "#7FCD9D", name: "R18" },
	  { code: "R19", hex: "#CDE55D", name: "R19" },
	  { code: "R20", hex: "#E8C7B4", name: "R20" },
	  { code: "R21", hex: "#AD6F3C", name: "R21" },
	  { code: "R22", hex: "#6C372F", name: "R22" },
	  { code: "R23", hex: "#FEB872", name: "R23" },
	  { code: "R24", hex: "#F3C1C0", name: "R24" },
	  { code: "R25", hex: "#C9675E", name: "R25" },
	  { code: "R26", hex: "#D293BE", name: "R26" },
	  { code: "R27", hex: "#EA8CB1", name: "R27" },
	  { code: "R28", hex: "#9C87D6", name: "R28" },
	  { code: "T1", hex: "#FFFFFF", name: "T1" },
	  { code: "Y1", hex: "#FD6FB4", name: "Y1" },
	  { code: "Y2", hex: "#FEB481", name: "Y2" },
	  { code: "Y3", hex: "#D7FAA0", name: "Y3" },
	  { code: "Y4", hex: "#8BDBFA", name: "Y4" },
	  { code: "Y5", hex: "#E987EA", name: "Y5" },
	  { code: "ZG1", hex: "#DAABB3", name: "ZG1" },
	  { code: "ZG2", hex: "#D6AA87", name: "ZG2" },
	  { code: "ZG3", hex: "#C1BD8D", name: "ZG3" },
	  { code: "ZG4", hex: "#96869F", name: "ZG4" },
	  { code: "ZG5", hex: "#8490A6", name: "ZG5" },
	  { code: "ZG6", hex: "#94BFE2", name: "ZG6" },
	  { code: "ZG7", hex: "#E2A9D2", name: "ZG7" },
	  { code: "ZG8", hex: "#AB91C0", name: "ZG8" }
];

// 巡展像素官方色板(待填入)
const EXHIBITION_DATA = [];

// 当前激活的色板引用 (默认MARD)
let OFFICIAL_COLORS = EXHIBITION_DATA;

// 色板定义
const PALETTE_DEFS = [
  { id: 'exhibition', label: '巡展像素', colors: EXHIBITION_DATA, color: '#80D8F0' },
  { id: 'mard',       label: 'MARD',     colors: MARD_DATA,        color: '#F77C31' },
  { id: 'slot1',      label: '（空）',   colors: [],               color: '#555' },
  { id: 'slot2',      label: '（空）',   colors: [],               color: '#555' },
  { id: 'slot3',      label: '（空）',   colors: [],               color: '#555' },
];
let currentPaletteId = 'exhibition';

function restorePaletteSelection(paletteId) {
  var def = PALETTE_DEFS.find(function(item) { return item.id === paletteId; });
  if (!def) def = PALETTE_DEFS[0];
  currentPaletteId = def.id;
  OFFICIAL_COLORS = def.colors;
  paletteMode = def.colors.length ? 'official' : 'canvas';
  buildHexCodeMap();

  var label = document.getElementById('palettePickerLabel');
  var button = document.getElementById('palettePickerBtn');
  if (label) label.textContent = '色板: ' + def.label;
  if (button) button.style.background = def.colors.length ? '#C57820' : '#3A6BC5';
}

// hex→色号缩写映射表 (用于画布像素格显示)
let hexToCodeMap = {};
function buildHexCodeMap() {
  hexToCodeMap = {};
  OFFICIAL_COLORS.forEach(function(entry) {
    hexToCodeMap[entry.hex.toUpperCase()] = entry.code.replace(/^80-/, '');
  });
}
buildHexCodeMap();

// 提取色板条目的hex值
function paletteHex(entry) {
  return typeof entry === 'string' ? entry : entry.hex;
}
// 提取色板条目的色号(无则返回空)
function paletteCode(entry) {
  return typeof entry === 'string' ? '' : (entry.code || '');
}
// 通过hex查找色板条目
function findPaletteEntry(hex) {
  return OFFICIAL_COLORS.find(function(e) { return paletteHex(e) === hex; });
}

// --- 閻㈣绔烽悩鑸碘偓?---
let pixelData = [];     // 2D閺佹壆绮?[y][x] = '#rrggbb'
let zoom = 100;         // zoom
let isDrawing = false;
let lastPaintedX = -1;
let lastPaintedY = -1;

// --- 本地存储：自动保存/加载像素数据 ---
var STORAGE_KEY = 'pixel_editor_save';

function saveToStorage(silent) {
  try {
    var data = TourgridStorage.serialize({
      gridSize: GRID_SIZE,
      pixels: pixelData.map(function(row) { return row.slice(); }),
      metadata: Object.assign({}, documentMetadata, {
        editorPaletteId: currentPaletteId
      })
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!silent) showToast('💾 已存档 (' + GRID_SIZE + '×' + GRID_SIZE + ')');
  } catch(e) {
    // localStorage满或不可用，静默忽略
  }
}

function manualSave() {
  saveToStorage();
}

function loadFromStorage() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return TourgridStorage.migrate(JSON.parse(raw));
  } catch(e) {
    return null;
  }
}

function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
}

// --- 閹锋牗瀚块獮宕囆╅悩鑸碘偓?---
let isPanning = false;
let spaceHeld = false;
let panStartX = 0, panStartY = 0;
let panScrollStartX = 0, panScrollStartY = 0;

// --- 閹俱倝鏀㈤弽?---
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];

// --- DOM瀵洜鏁?---
let mainCanvas, mainCtx, navCanvas, navCtx;
let canvasContainer, centerPanel, gridInfoEl;

// --- init ---
