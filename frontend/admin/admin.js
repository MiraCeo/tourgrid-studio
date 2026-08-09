(function() {
  'use strict';

  var FAVORITES_STORAGE_KEY = 'tourgrid_admin_favorite_works_v1';
  var SHARE_CODE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{12}$/;
  var token = '';
  var works = [];
  var currentPage = 1;
  var totalPages = 0;
  var totalCount = 0;
  var pageSize = 50;
  var favoriteCodes = [];
  var databaseSort = 'created_desc';
  var selectedWork = null;
  var pendingAction = null;
  var paletteCache = {};

  var loginPanel = document.getElementById('loginPanel');
  var adminApp = document.getElementById('adminApp');
  var loginForm = document.getElementById('loginForm');
  var loginError = document.getElementById('loginError');
  var statusMessage = document.getElementById('statusMessage');
  var workGrid = document.getElementById('workGrid');
  var emptyState = document.getElementById('emptyState');
  var visibleCount = document.getElementById('visibleCount');
  var pagination = document.getElementById('pagination');
  var pageButtons = document.getElementById('pageButtons');
  var statusFilter = document.getElementById('statusFilter');
  var sortFilter = document.getElementById('sortFilter');
  var detailPlaceholder = document.getElementById('detailPlaceholder');
  var detailContent = document.getElementById('detailContent');
  var actionDialog = document.getElementById('actionDialog');
  var dialogError = document.getElementById('dialogError');

  function api(path, options) {
    var request = options || {};
    var headers = new Headers(request.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    if (request.body) headers.set('Content-Type', 'application/json');
    request.headers = headers;
    request.cache = 'no-store';
    return fetch(path, request).then(async function(response) {
      var body = await response.json().catch(function() { return {}; });
      if (!response.ok) {
        var error = new Error(
          body.error && body.error.message
            ? body.error.message
            : '请求失败（' + response.status + '）'
        );
        error.code = body.error && body.error.code;
        error.status = response.status;
        throw error;
      }
      return body;
    });
  }

  function setMessage(message, isError) {
    statusMessage.textContent = message || '';
    statusMessage.classList.toggle('error', Boolean(isError));
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  function statusLabel(status) {
    return { active: '正常', hidden: '已隐藏', purged: '已清除' }[status] || status;
  }

  function loadFavoriteCodes() {
    try {
      var value = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || '[]');
      if (!Array.isArray(value)) return [];
      var seen = {};
      return value.filter(function(code) {
        if (typeof code !== 'string' || !SHARE_CODE_PATTERN.test(code) || seen[code]) {
          return false;
        }
        seen[code] = true;
        return true;
      });
    } catch (_error) {
      return [];
    }
  }

  function saveFavoriteCodes(codes) {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(codes));
      return true;
    } catch (_error) {
      setMessage('无法保存喜爱名单，请检查浏览器网站存储设置。', true);
      return false;
    }
  }

  function isFavorite(code) {
    return favoriteCodes.indexOf(code) >= 0;
  }

  function syncSortFilter() {
    var favoriteView = statusFilter.value === 'favorite';
    if (favoriteView) {
      if (sortFilter.value !== 'favorite_order') {
        databaseSort = sortFilter.value;
      }
      sortFilter.value = 'favorite_order';
      sortFilter.disabled = true;
      sortFilter.title = '喜爱作品固定按照添加顺序排列';
      return;
    }
    sortFilter.disabled = false;
    sortFilter.title = '';
    if (sortFilter.value === 'favorite_order') {
      sortFilter.value = databaseSort;
    }
  }

  function toggleFavorite(code) {
    var adding = !isFavorite(code);
    var nextCodes = adding
      ? favoriteCodes.concat(code)
      : favoriteCodes.filter(function(item) { return item !== code; });
    if (!saveFavoriteCodes(nextCodes)) return;
    favoriteCodes = nextCodes;
    setMessage(adding ? '已添加到本机喜爱名单。' : '已从本机喜爱名单移除。');
    if (statusFilter.value === 'favorite') {
      loadWorks(currentPage);
      return;
    }
    renderWorks();
    renderDetail();
  }

  function loadPalette(paletteId) {
    if (!paletteCache[paletteId]) {
      paletteCache[paletteId] = fetch('/api/v1/palettes/' + encodeURIComponent(paletteId), {
        cache: 'force-cache'
      }).then(function(response) {
        if (!response.ok) throw new Error('无法读取作品色板');
        return response.json();
      });
    }
    return paletteCache[paletteId];
  }

  function drawPreview(canvas, work) {
    if (!work.pixels) return Promise.resolve();
    return loadPalette(work.paletteId).then(function(palette) {
      var pixels = window.TourgridWorkCodec.unpackPixels(work.pixels, palette.colors);
      var context = canvas.getContext('2d');
      var size = canvas.width / 24;
      context.imageSmoothingEnabled = false;
      for (var y = 0; y < 24; y++) {
        for (var x = 0; x < 24; x++) {
          context.fillStyle = pixels[y][x];
          context.fillRect(x * size, y * size, size, size);
        }
      }
    }).catch(function(error) {
      var context = canvas.getContext('2d');
      context.fillStyle = '#202528';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ff9b9f';
      context.font = '12px sans-serif';
      context.fillText(error.message, 8, 20);
    });
  }

  function createText(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function renderWorks() {
    workGrid.replaceChildren();
    visibleCount.textContent = totalCount === 0
      ? '0 项'
      : totalCount + ' 项 · 第 ' + currentPage + ' / ' + totalPages + ' 页';
    emptyState.hidden = works.length !== 0;
    renderPagination();

    works.forEach(function(work) {
      var wrapper = document.createElement('div');
      wrapper.className = 'work-card-wrapper';
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'work-card ' + work.moderationStatus;
      if (selectedWork && selectedWork.code === work.code) {
        card.classList.add('selected');
      }
      card.dataset.code = work.code;

      if (work.pixels) {
        var canvas = document.createElement('canvas');
        canvas.width = 192;
        canvas.height = 192;
        canvas.setAttribute('aria-label', work.code + ' 作品预览');
        card.appendChild(canvas);
        drawPreview(canvas, work);
      } else {
        card.appendChild(createText('div', 'purged-thumbnail', '内容已清除'));
      }

      card.appendChild(createText('span', 'card-code', work.code));
      card.appendChild(createText(
        'span',
        'card-title',
        work.title || work.authorName || '未填写标题与作者'
      ));
      var footer = document.createElement('span');
      footer.className = 'card-footer';
      footer.appendChild(createText('span', '', statusLabel(work.moderationStatus)));
      footer.appendChild(createText('span', '', '浏览 ' + work.viewCount));
      card.appendChild(footer);
      card.addEventListener('click', function() { selectWork(work.code); });
      var favoriteButton = createText(
        'button',
        'secondary favorite-toggle',
        isFavorite(work.code) ? '★' : '☆'
      );
      favoriteButton.type = 'button';
      favoriteButton.classList.toggle('active', isFavorite(work.code));
      favoriteButton.setAttribute(
        'aria-label',
        isFavorite(work.code) ? '取消喜爱 ' + work.code : '添加喜爱 ' + work.code
      );
      favoriteButton.addEventListener('click', function() {
        toggleFavorite(work.code);
      });
      wrapper.appendChild(card);
      wrapper.appendChild(favoriteButton);
      workGrid.appendChild(wrapper);
    });
  }

  function paginationItems(page, pageCount) {
    var candidates = [1, pageCount, page - 2, page - 1, page, page + 1, page + 2]
      .filter(function(value) { return value >= 1 && value <= pageCount; })
      .filter(function(value, index, values) { return values.indexOf(value) === index; })
      .sort(function(left, right) { return left - right; });
    var items = [];
    candidates.forEach(function(value, index) {
      if (index > 0 && value - candidates[index - 1] > 1) items.push(null);
      items.push(value);
    });
    return items;
  }

  function renderPagination() {
    pagination.hidden = totalPages <= 1;
    pageButtons.replaceChildren();
    if (totalPages <= 1) return;

    paginationItems(currentPage, totalPages).forEach(function(page) {
      if (page === null) {
        pageButtons.appendChild(createText('span', 'page-ellipsis', '…'));
        return;
      }
      var button = createText('button', 'secondary small page-button', String(page));
      button.type = 'button';
      button.classList.toggle('current', page === currentPage);
      button.setAttribute('aria-current', page === currentPage ? 'page' : 'false');
      button.addEventListener('click', function() { loadWorks(page); });
      pageButtons.appendChild(button);
    });

    document.getElementById('previousPageButton').disabled = currentPage <= 1;
    document.getElementById('nextPageButton').disabled = currentPage >= totalPages;
    document.getElementById('pageJumpInput').max = String(totalPages);
    document.getElementById('pageTotalLabel').textContent = '/ ' + totalPages + ' 页';
  }

  function loadWorks(page) {
    works = [];
    selectedWork = null;
    renderDetail();
    if (page === undefined) page = 1;
    if (statusFilter.value === 'favorite') {
      return loadFavoriteWorks(page);
    }
    if (totalPages > 0) page = Math.min(page, totalPages);
    page = Math.max(1, page);
    setMessage('正在读取第 ' + page + ' 页作品…');
    var parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortFilter.value
    });
    if (statusFilter.value) parameters.set('status', statusFilter.value);
    return api('/api/v1/admin/works?' + parameters.toString())
      .then(function(body) {
        works = body.works;
        currentPage = body.page;
        totalPages = body.totalPages;
        totalCount = body.totalCount;
        renderWorks();
        setMessage(
          totalCount === 0
            ? '当前筛选下没有作品。'
            : '第 ' + currentPage + ' 页，共 ' + totalPages + ' 页。'
        );
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function(error) {
        setMessage(error.message, true);
      });
  }

  function loadFavoriteWorks(page) {
    totalCount = favoriteCodes.length;
    totalPages = Math.ceil(totalCount / pageSize);
    currentPage = Math.min(Math.max(1, page), Math.max(1, totalPages));
    if (totalCount === 0) {
      works = [];
      renderWorks();
      setMessage('本机喜爱名单为空。');
      return Promise.resolve();
    }

    var offset = (currentPage - 1) * pageSize;
    var pageCodes = favoriteCodes.slice(offset, offset + pageSize);
    setMessage('正在读取第 ' + currentPage + ' 页喜爱作品…');
    return api('/api/v1/admin/works/batch', {
      method: 'POST',
      body: JSON.stringify({ codes: pageCodes })
    }).then(function(body) {
      var worksByCode = {};
      body.works.forEach(function(work) { worksByCode[work.code] = work; });
      works = pageCodes
        .map(function(code) { return worksByCode[code]; })
        .filter(Boolean);
      renderWorks();
      var missingCount = pageCodes.length - works.length;
      setMessage(
        '第 ' + currentPage + ' 页，共 ' + totalPages + ' 页。' +
        (missingCount ? ' ' + missingCount + ' 个喜爱作品已不存在。' : '')
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function(error) {
      setMessage(error.message, true);
    });
  }

  function changePage(delta) {
    var target = currentPage + delta;
    if (target >= 1 && target <= totalPages) loadWorks(target);
  }

  function jumpToPage(event) {
    event.preventDefault();
    var target = Number(document.getElementById('pageJumpInput').value);
    if (!Number.isInteger(target) || target < 1 || target > totalPages) {
      setMessage('请输入 1 到 ' + totalPages + ' 之间的页码。', true);
      return;
    }
    document.getElementById('pageJumpInput').value = '';
    loadWorks(target);
  }

  function selectWork(code) {
    setMessage('正在读取作品详情…');
    api('/api/v1/admin/works/' + encodeURIComponent(code))
      .then(function(work) {
        selectedWork = work;
        var index = works.findIndex(function(item) { return item.code === code; });
        if (index >= 0) works[index] = work;
        renderWorks();
        renderDetail();
        setMessage('');
      })
      .catch(function(error) { setMessage(error.message, true); });
  }

  function addMetadata(list, label, value) {
    list.appendChild(createText('dt', '', label));
    list.appendChild(createText('dd', '', value === null || value === undefined || value === '' ? '—' : String(value)));
  }

  function renderDetail() {
    detailPlaceholder.hidden = Boolean(selectedWork);
    detailContent.hidden = !selectedWork;
    if (!selectedWork) return;

    var statusBadge = document.getElementById('detailStatus');
    statusBadge.className = 'status-badge ' + selectedWork.moderationStatus;
    statusBadge.textContent = statusLabel(selectedWork.moderationStatus);
    var canvas = document.getElementById('detailCanvas');
    var purgedNotice = document.getElementById('purgedNotice');
    canvas.hidden = !selectedWork.pixels;
    purgedNotice.hidden = Boolean(selectedWork.pixels);
    if (selectedWork.pixels) drawPreview(canvas, selectedWork);

    var metadata = document.getElementById('detailMetadata');
    metadata.replaceChildren();
    addMetadata(metadata, '分享码', selectedWork.code);
    addMetadata(metadata, '标题', selectedWork.title);
    addMetadata(metadata, '作者', selectedWork.authorName);
    addMetadata(metadata, '色板', selectedWork.paletteId + ' v' + selectedWork.paletteVersion);
    addMetadata(metadata, '数据版本', selectedWork.schemaVersion);
    addMetadata(metadata, '浏览次数', selectedWork.viewCount);
    addMetadata(metadata, '创建时间', formatDate(selectedWork.createdAt));
    addMetadata(metadata, '处理时间', formatDate(selectedWork.moderatedAt));
    addMetadata(metadata, '清除时间', formatDate(selectedWork.purgedAt));
    addMetadata(metadata, '处理原因', selectedWork.moderationReason);

    var favoriteButton = document.getElementById('detailFavoriteButton');
    favoriteButton.classList.toggle('active', isFavorite(selectedWork.code));
    favoriteButton.textContent = isFavorite(selectedWork.code)
      ? '★ 取消喜爱'
      : '☆ 添加喜爱';

    document.getElementById('hideButton').hidden = selectedWork.moderationStatus !== 'active';
    document.getElementById('restoreButton').hidden = selectedWork.moderationStatus !== 'hidden';
    document.getElementById('purgeButton').hidden = selectedWork.moderationStatus === 'purged';
  }

  function openAction(action) {
    if (!selectedWork) return;
    pendingAction = action;
    dialogError.hidden = true;
    document.getElementById('actionReason').value = '';
    document.getElementById('confirmationCode').value = '';
    var purge = action === 'purge';
    document.getElementById('dialogTitle').textContent =
      action === 'hide' ? '隐藏作品' : action === 'restore' ? '恢复作品' : '永久清除作品';
    document.getElementById('dialogDescription').textContent = purge
      ? '此操作不可恢复，像素画面、标题和作者将从数据库清除。'
      : action === 'hide'
        ? '隐藏后公共分享链接会返回不存在，但仍可恢复。'
        : '恢复后公共分享链接将重新可用。';
    document.getElementById('confirmationLabel').hidden = !purge;
    document.getElementById('confirmationCode').hidden = !purge;
    document.getElementById('confirmationCode').required = purge;
    document.getElementById('actionReason').required = action !== 'restore';
    document.getElementById('confirmDialogButton').className = purge ? 'danger' : '';
    actionDialog.showModal();
  }

  function submitAction(event) {
    event.preventDefault();
    if (!selectedWork || !pendingAction) return;
    var reason = document.getElementById('actionReason').value.trim();
    var payload = { reason: reason || null };
    if (pendingAction === 'purge') {
      payload.confirmationCode = document.getElementById('confirmationCode').value.trim();
    }
    var button = document.getElementById('confirmDialogButton');
    button.disabled = true;
    api(
      '/api/v1/admin/works/' + encodeURIComponent(selectedWork.code) + '/' + pendingAction,
      { method: 'POST', body: JSON.stringify(payload) }
    ).then(function(work) {
      selectedWork = work;
      var index = works.findIndex(function(item) { return item.code === work.code; });
      if (index >= 0) works[index] = work;
      if (statusFilter.value && statusFilter.value !== work.moderationStatus) {
        actionDialog.close();
        setMessage('作品状态已更新，正在刷新当前页。');
        loadAudit();
        return loadWorks(currentPage);
      }
      renderWorks();
      renderDetail();
      actionDialog.close();
      setMessage('作品状态已更新。');
      loadAudit();
    }).catch(function(error) {
      dialogError.textContent = error.message;
      dialogError.hidden = false;
    }).finally(function() {
      button.disabled = false;
    });
  }

  function loadAudit() {
    api('/api/v1/admin/moderation-events?limit=30')
      .then(function(body) {
        var list = document.getElementById('auditList');
        list.replaceChildren();
        document.getElementById('auditEmpty').hidden = body.events.length !== 0;
        body.events.forEach(function(event) {
          var item = document.createElement('li');
          item.className = 'audit-item';
          item.appendChild(createText('strong', '', event.action + ' · ' + event.targetValue));
          item.appendChild(createText(
            'div',
            'audit-meta',
            formatDate(event.createdAt) + (event.reason ? ' · ' + event.reason : '')
          ));
          list.appendChild(item);
        });
      })
      .catch(function(error) { setMessage(error.message, true); });
  }

  loginForm.addEventListener('submit', function(event) {
    event.preventDefault();
    token = document.getElementById('adminToken').value;
    loginError.hidden = true;
    api('/api/v1/admin/session').then(function() {
      favoriteCodes = loadFavoriteCodes();
      document.getElementById('adminToken').value = '';
      loginPanel.hidden = true;
      adminApp.hidden = false;
      loadWorks(1);
      loadAudit();
    }).catch(function(error) {
      token = '';
      loginError.textContent = error.message;
      loginError.hidden = false;
    });
  });

  document.getElementById('logoutButton').addEventListener('click', function() {
    token = '';
    works = [];
    currentPage = 1;
    totalPages = 0;
    totalCount = 0;
    favoriteCodes = [];
    databaseSort = 'created_desc';
    sortFilter.value = databaseSort;
    syncSortFilter();
    selectedWork = null;
    adminApp.hidden = true;
    loginPanel.hidden = false;
    renderWorks();
    renderDetail();
  });
  document.getElementById('refreshButton').addEventListener('click', function() { loadWorks(currentPage); });
  document.getElementById('auditRefreshButton').addEventListener('click', loadAudit);
  statusFilter.addEventListener('change', function() {
    syncSortFilter();
    totalPages = 0;
    loadWorks(1);
  });
  sortFilter.addEventListener('change', function() {
    databaseSort = sortFilter.value;
    totalPages = 0;
    loadWorks(1);
  });
  document.getElementById('previousPageButton').addEventListener('click', function() { changePage(-1); });
  document.getElementById('nextPageButton').addEventListener('click', function() { changePage(1); });
  document.getElementById('pageJumpForm').addEventListener('submit', jumpToPage);
  document.getElementById('detailFavoriteButton').addEventListener('click', function() {
    if (selectedWork) toggleFavorite(selectedWork.code);
  });
  document.getElementById('hideButton').addEventListener('click', function() { openAction('hide'); });
  document.getElementById('restoreButton').addEventListener('click', function() { openAction('restore'); });
  document.getElementById('purgeButton').addEventListener('click', function() { openAction('purge'); });
  document.getElementById('actionForm').addEventListener('submit', submitAction);
  document.getElementById('cancelDialogButton').addEventListener('click', function() { actionDialog.close(); });

  document.getElementById('searchForm').addEventListener('submit', function(event) {
    event.preventDefault();
    var code = document.getElementById('searchCode').value.trim();
    if (code.length !== 12) {
      setMessage('请输入完整的12位分享码。', true);
      return;
    }
    selectWork(code);
  });

  document.getElementById('banForm').addEventListener('submit', function(event) {
    event.preventDefault();
    var duration = document.getElementById('banDuration').value;
    var payload = {
      clientIp: document.getElementById('banIp').value.trim(),
      reason: document.getElementById('banReason').value.trim() || null
    };
    if (duration) payload.ttlSeconds = Number(duration);
    api('/api/v1/admin/bans', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).then(function() {
      setMessage('客户端封禁已添加。');
      event.target.reset();
    }).catch(function(error) { setMessage(error.message, true); });
  });

  document.getElementById('unbanForm').addEventListener('submit', function(event) {
    event.preventDefault();
    var clientIp = document.getElementById('unbanIp').value.trim();
    api('/api/v1/admin/bans?clientIp=' + encodeURIComponent(clientIp), {
      method: 'DELETE'
    }).then(function() {
      setMessage('客户端封禁已解除。');
      event.target.reset();
    }).catch(function(error) { setMessage(error.message, true); });
  });
})();
