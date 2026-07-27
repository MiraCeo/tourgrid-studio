var workShareModalTrigger = null;
var activeSharedWorkCode = null;

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

  codeOutput.textContent = code;
  result.hidden = false;
}

function readWorkMetadata(inputId, label, defaultValue) {
  var input = document.getElementById(inputId);
  var value = String(input ? input.value : '').trim();
  if (Array.from(value).length > 10) {
    throw new Error(label + '不能超过10个字。');
  }
  return value || defaultValue;
}

async function publishCurrentWork() {
  var button = document.getElementById('publishWorkButton');
  if (button) button.disabled = true;
  setWorkShareStatus('正在保存作品……', 'loading');

  try {
    var title = readWorkMetadata(
      'workTitleInput',
      '作品标题',
      '很糊的画'
    );
    var authorName = readWorkMetadata(
      'workAuthorInput',
      '作者名称',
      '博士'
    );
    var encoded = TourgridWorkCodec.packPixels(
      pixelData,
      EXHIBITION_DATA
    );
    var response = await fetch(API_BASE_URL + '/api/v1/works', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        schemaVersion: 1,
        paletteId: DEFAULT_PALETTE_ID,
        paletteVersion: DEFAULT_PALETTE_VERSION,
        pixels: encoded,
        title: title,
        authorName: authorName
      })
    });
    var body = await response.json();
    if (!response.ok) throw new Error(apiErrorMessage(response, body));

    updatePublishedWorkResult(body.code);
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
  try {
    await navigator.clipboard.writeText(code);
  } catch (_error) {
    var temporary = document.createElement('textarea');
    temporary.value = code;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
  }
  showToast('分享码已复制');
}

function normalizeShareCode(value) {
  return String(value || '').trim();
}

async function loadSharedWorkByCode(code, options) {
  options = options || {};
  var normalized = normalizeShareCode(code);
  if (!/^[1-9A-HJ-NP-Za-km-z]{12}$/.test(normalized)) {
    throw new Error('请输入有效的12位Base58分享码。');
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
  pixelData = restoredPixels;
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
  var button = document.getElementById('loadWorkButton');
  if (button) button.disabled = true;
  setWorkShareStatus('正在读取作品……', 'loading');
  try {
    var work = await loadSharedWorkByCode(input.value, {
      keepModalOpen: true
    });
    input.value = work.code;
    setWorkShareStatus(
      '读取成功 · 浏览 ' + work.viewCount + ' 次',
      'success'
    );
    window.setTimeout(closeWorkShareModal, 450);
  } catch (error) {
    setWorkShareStatus(error.message || '读取作品失败。', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function loadSharedWorkFromQuery() {
  var code = new URL(window.location.href).searchParams.get('work');
  if (!code) return;
  loadSharedWorkByCode(code).catch(function(error) {
    openWorkShareModal('load');
    document.getElementById('workCodeInput').value = code;
    setWorkShareStatus(error.message || '读取分享作品失败。', 'error');
  });
}
