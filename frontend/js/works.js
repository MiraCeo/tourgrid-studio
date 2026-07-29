var workShareModalTrigger = null;
var activeSharedWorkCode = null;
var pendingPublish = null;
var pendingSharedWorkCode = null;
var SHARE_CODE_PATTERN = '[1-9A-HJ-NP-Za-km-z]{12}';

function setWorkShareStatus(message, state) {
  var status = document.getElementById('workShareStatus');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.state = state || '';
}

function openWorkShareModal(mode) {
  hideExportDropdown();
  var modal = document.getElementById('workShareModal');
  if (!modal) return;
  workShareModalTrigger = document.activeElement;
  modal.hidden = false;
  var dialog = modal.querySelector('.work-share-modal');
  if (dialog) dialog.scrollTop = 0;
  setWorkShareStatus('', '');
  requestAnimationFrame(function() {
    modal.classList.add('show');
    if (mode === 'load') {
      document.getElementById('workCodeInput').focus();
    } else {
      document.getElementById('workTitleInput').focus();
    }
  });
}

function closeWorkShareModal() {
  var modal = document.getElementById('workShareModal');
  if (!modal || modal.hidden) return;
  cancelPublishConfirmation(true);
  hideReadReplaceConfirmation();
  modal.classList.remove('show');
  window.setTimeout(function() {
    if (!modal.classList.contains('show')) modal.hidden = true;
  }, 180);
  if (
    workShareModalTrigger &&
    typeof workShareModalTrigger.focus === 'function'
  ) {
    workShareModalTrigger.focus();
  }
  if (
    modal.contains(document.activeElement) ||
    document.activeElement === workShareModalTrigger
  ) {
    document.activeElement.blur();
  }
}

function closeWorkShareModalFromBackdrop(event) {
  if (event.target === event.currentTarget) closeWorkShareModal();
}

function apiErrorMessage(response, body) {
  if (
    body &&
    body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return '服务器请求失败（HTTP ' + response.status + '）';
}

function updatePublishedWorkResult(code) {
  activeSharedWorkCode = code;
  var result = document.getElementById('publishedWorkResult');
  var codeOutput = document.getElementById('publishedWorkCode');
  var linkOutput = document.getElementById('publishedWorkLink');

  codeOutput.textContent = code;
  linkOutput.textContent = buildSharedWorkLink(code);
  linkOutput.title = buildSharedWorkLink(code);
  result.hidden = false;
}

function buildSharedWorkLink(code) {
  var url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('work', code);
  return url.toString();
}

function readWorkMetadata(inputId, label, defaultValue) {
  var input = document.getElementById(inputId);
  var value = String(input ? input.value : '').trim();
  if (Array.from(value).length > 10) {
    throw new Error(label + '不能超过10个字。');
  }
  return value || defaultValue;
}

function drawPublishConfirmationPreview() {
  var canvas = document.getElementById('publishConfirmationCanvas');
  var context = canvas.getContext('2d');
  var cellSize = canvas.width / GRID_SIZE;
  context.imageSmoothingEnabled = false;
  pixelData.forEach(function(row, y) {
    row.forEach(function(color, x) {
      context.fillStyle = color;
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    });
  });
}

function publishCurrentWork() {
  try {
    pendingPublish = {
      title: readWorkMetadata('workTitleInput', '作品标题', '很糊的画'),
      authorName: readWorkMetadata('workAuthorInput', '作者名称', '博士'),
      pixels: TourgridWorkCodec.packPixels(pixelData, EXHIBITION_DATA)
    };
  } catch (error) {
    setWorkShareStatus(error.message || '请检查作品信息。', 'error');
    return;
  }
  drawPublishConfirmationPreview();
  document.getElementById('publishConfirmationTitle').textContent =
    pendingPublish.title;
  document.getElementById('publishConfirmationAuthor').textContent =
    pendingPublish.authorName;
  document.getElementById('publishConfirmationPalette').textContent =
    DEFAULT_PALETTE_ID + ' v' + DEFAULT_PALETTE_VERSION;
  document.querySelector('.work-metadata-grid').hidden = true;
  document.getElementById('publishWorkButton').hidden = true;
  document.getElementById('publishConfirmation').hidden = false;
  setWorkShareStatus('请确认画面和作品信息后永久发布。', '');
  document.getElementById('confirmPublishButton').focus();
}

function cancelPublishConfirmation(silent) {
  pendingPublish = null;
  var confirmation = document.getElementById('publishConfirmation');
  if (!confirmation) return;
  confirmation.hidden = true;
  document.querySelector('.work-metadata-grid').hidden = false;
  document.getElementById('publishWorkButton').hidden = false;
  if (!silent) {
    setWorkShareStatus('', '');
    document.getElementById('workTitleInput').focus();
  }
}

async function confirmPublishCurrentWork() {
  if (!pendingPublish) return;
  var button = document.getElementById('confirmPublishButton');
  if (button) button.disabled = true;
  setWorkShareStatus('正在保存作品……', 'loading');

  try {
    var response = await fetch(API_BASE_URL + '/api/v1/works', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        schemaVersion: 1,
        paletteId: DEFAULT_PALETTE_ID,
        paletteVersion: DEFAULT_PALETTE_VERSION,
        pixels: pendingPublish.pixels,
        title: pendingPublish.title,
        authorName: pendingPublish.authorName
      })
    });
    var body = await response.json();
    if (!response.ok) throw new Error(apiErrorMessage(response, body));

    updatePublishedWorkResult(body.code);
    cancelPublishConfirmation(true);
    setWorkShareStatus(
      '作品已永久保存；相同画面始终保留首次保存的标题与作者。',
      'success'
    );
  } catch (error) {
    setWorkShareStatus(error.message || '保存作品失败。', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function copyPublishedWorkCode() {
  var codeOutput = document.getElementById('publishedWorkCode');
  var code = String(codeOutput ? codeOutput.textContent : '').trim();
  if (!code) return;
  await copyText(code);
  showToast('分享码已复制');
}

async function copyPublishedWorkLink() {
  var linkOutput = document.getElementById('publishedWorkLink');
  var link = String(linkOutput ? linkOutput.textContent : '').trim();
  if (!link) return;
  await copyText(link);
  showToast('完整分享链接已复制');
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_error) {
    var temporary = document.createElement('textarea');
    temporary.value = value;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
  }
}

function normalizeShareCode(value) {
  var input = String(value || '').trim();
  var exact = new RegExp('^' + SHARE_CODE_PATTERN + '$').exec(input);
  if (exact) return exact[0];

  var fromQuery = new RegExp(
    '[?&]work=(' + SHARE_CODE_PATTERN + ')(?=$|[&#])'
  ).exec(input);
  return fromQuery ? fromQuery[1] : '';
}

async function loadSharedWorkByCode(code, options) {
  options = options || {};
  var normalized = normalizeShareCode(code);
  if (!normalized) {
    throw new Error('请输入有效的12位Base58分享码或完整分享链接。');
  }

  var response = await fetch(
    API_BASE_URL + '/api/v1/works/' + encodeURIComponent(normalized)
  );
  var body = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(response, body));
  if (
    body.schemaVersion !== 1 ||
    body.paletteId !== DEFAULT_PALETTE_ID ||
    body.paletteVersion !== DEFAULT_PALETTE_VERSION
  ) {
    throw new Error('该作品使用了当前编辑器不支持的数据或色板版本。');
  }

  var restoredPixels = TourgridWorkCodec.unpackPixels(
    body.pixels,
    EXHIBITION_DATA
  );
  pushUndo();
  clearReferenceImage(false);
  replicationCompletedCells.clear();
  statisticsHighlightColor = null;
  pixelData = restoredPixels;
  restoreReplicationProgress();
  restorePaletteSelection('exhibition');
  documentMetadata = {
    sourceMode: 'shared',
    paletteId: body.paletteId,
    editorPaletteId: 'exhibition',
    paletteVersion: body.paletteVersion,
    converterVersion: null,
    importedAt: new Date().toISOString(),
    sharedCode: body.code,
    sharedTitle: body.title || '很糊的画',
    sharedAuthorName: body.authorName || '博士',
    sharedViewCount: body.viewCount
  };
  activeSharedWorkCode = body.code;
  updateTopWorkIdentity();
  renderCanvas();
  renderNavigator();
  renderColorGrid();
  updateColorUsageSummary();
  saveToStorage(true);

  if (!options.keepModalOpen) closeWorkShareModal();
  var loadedTitle = body.title || '很糊的画';
  var loadedAuthor = body.authorName || '博士';
  showToast(
    '已读取《' + loadedTitle + '》 · 作者：' + loadedAuthor
  );
  return body;
}

async function loadSharedWorkFromInput() {
  var input = document.getElementById('workCodeInput');
  var code = normalizeShareCode(input.value);
  if (!code) {
    setWorkShareStatus(
      '请输入有效的12位Base58分享码或完整分享链接。',
      'error'
    );
    return;
  }
  input.value = code;
  if (canvasHasContent()) {
    showReadReplaceConfirmation(code);
    return;
  }
  await performSharedWorkLoad(code);
}

function canvasHasContent() {
  return pixelData.some(function(row) {
    return row.some(function(color) {
      return String(color).toUpperCase() !== '#FFFFFF';
    });
  });
}

function showReadReplaceConfirmation(code) {
  pendingSharedWorkCode = code;
  document.getElementById('readReplaceConfirmation').hidden = false;
  setWorkShareStatus('读取前请选择如何保护当前画布。', '');
  document.getElementById('checkpointAndLoadButton').focus();
}

function hideReadReplaceConfirmation() {
  pendingSharedWorkCode = null;
  var confirmation = document.getElementById('readReplaceConfirmation');
  if (confirmation) confirmation.hidden = true;
}

async function performSharedWorkLoad(code) {
  var button = document.getElementById('loadWorkButton');
  if (button) button.disabled = true;
  document.getElementById('checkpointAndLoadButton').disabled = true;
  document.getElementById('loadWithoutCheckpointButton').disabled = true;
  setWorkShareStatus('正在读取作品……', 'loading');
  try {
    var work = await loadSharedWorkByCode(code, {
      keepModalOpen: true
    });
    document.getElementById('workCodeInput').value = work.code;
    hideReadReplaceConfirmation();
    setWorkShareStatus(
      '读取成功 · 浏览 ' + work.viewCount + ' 次',
      'success'
    );
    window.setTimeout(closeWorkShareModal, 450);
  } catch (error) {
    setWorkShareStatus(error.message || '读取作品失败。', 'error');
  } finally {
    if (button) button.disabled = false;
    document.getElementById('checkpointAndLoadButton').disabled = false;
    document.getElementById('loadWithoutCheckpointButton').disabled = false;
  }
}

async function checkpointAndLoadSharedWork() {
  var code = pendingSharedWorkCode;
  if (!code) return;
  if (!manualSave()) {
    setWorkShareStatus('无法创建读取前恢复点，尚未替换当前画布。', 'error');
    return;
  }
  showToast('已创建读取前恢复点');
  await performSharedWorkLoad(code);
}

async function loadSharedWorkWithoutCheckpoint() {
  var code = pendingSharedWorkCode;
  if (!code) return;
  await performSharedWorkLoad(code);
}

function cancelReadReplaceConfirmation() {
  hideReadReplaceConfirmation();
  setWorkShareStatus('已取消读取，当前画布未改变。', '');
  document.getElementById('workCodeInput').focus();
}

function loadSharedWorkFromQuery() {
  var code = new URL(window.location.href).searchParams.get('work');
  if (!code) return;
  if (canvasHasContent()) {
    openWorkShareModal('load');
    document.getElementById('workCodeInput').value = code;
    showReadReplaceConfirmation(code);
    return;
  }
  loadSharedWorkByCode(code).catch(function(error) {
    openWorkShareModal('load');
    document.getElementById('workCodeInput').value = code;
    setWorkShareStatus(error.message || '读取分享作品失败。', 'error');
  });
}
