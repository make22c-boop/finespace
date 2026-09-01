(function () {
  'use strict';

  // ---------- DOM helper ----------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') { el.className = v; }
      else if (k === 'style') { el.style.cssText = v; }
      else if (k.indexOf('on') === 0 && typeof v === 'function') { el[k] = v; }
      else if (k === 'checked' || k === 'disabled' || k === 'value') { el[k] = v; }
      else { el.setAttribute(k, v); }
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      if (typeof c === 'string' || typeof c === 'number') { el.appendChild(document.createTextNode(String(c))); }
      else { el.appendChild(c); }
    });
    return el;
  }

  // ---------- API ----------
  function api(method, url, body) {
    var opts = { method: method, credentials: 'include', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || data.error || ('요청 실패 (' + res.status + ')'));
          err.code = data.error;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function uploadPhoto(file) {
    var fd = new FormData();
    fd.append('photo', file);
    return fetch('/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.message || '업로드 실패');
        return data.url;
      });
    });
  }

  // ---------- formatting ----------
  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
  function fmtDate(ts) {
    if (!ts || Number(ts) === 0) return '';
    var d = new Date(Number(ts));
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0')
      + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var STATUS_LABEL = { pending: '대기중', approved: '승인됨', rejected: '반려됨', paid: '지급완료' };
  var STATUS_BADGE = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected', paid: 'badge-paid' };

  // ---------- state ----------
  var STATE = {
    me: { role: null, name: null },
    sites: [],
    vendors: [],
    requests: [],
    view: 'ROLE_SELECT', // ROLE_SELECT | MANAGER | CEO_LOGIN | CEO_DASHBOARD | ACCOUNTANT_LOGIN | ACCOUNTANT_DASHBOARD
    ceoTab: 'pending', // pending | all | urgentAudit
    accTab: 'toPay', // toPay | paid
    manager: { siteId: null, siteName: '', name: '' },
    loading: false,
  };

  try {
    var saved = JSON.parse(localStorage.getItem('psx_manager') || 'null');
    if (saved) { STATE.manager.name = saved.name || ''; STATE.manager.siteId = saved.siteId || null; STATE.manager.siteName = saved.siteName || ''; }
  } catch (e) {}

  function saveManagerLocal() {
    try { localStorage.setItem('psx_manager', JSON.stringify(STATE.manager)); } catch (e) {}
  }

  function toast(msg) {
    var t = h('div', { class: 'toast' }, [msg]);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function refreshAll() {
    return Promise.all([
      api('GET', '/api/sites').then(function (d) { STATE.sites = d; }),
      api('GET', '/api/vendors').then(function (d) { STATE.vendors = d; }),
      api('GET', '/api/requests').then(function (d) { STATE.requests = d; }),
    ]);
  }

  // 사용자가 화면을 조작 중일 때는(입력, 클릭, 체크박스, 폼 토글 등) 자동 새로고침으로
  // 화면을 통째로 다시 그리지 않음 — 그렇게 하면 입력 중이던 내용/한글 조합/열어둔 폼이
  // 사라져버림. 최근에 사용자가 뭔가를 조작했다면 잠시 자동 재렌더를 미룬다.
  var lastInteractionAt = 0;
  ['input', 'click', 'change', 'keydown', 'focus'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      if (app.contains(e.target)) { lastInteractionAt = Date.now(); }
    }, true);
  });
  function recentlyInteracting() {
    return (Date.now() - lastInteractionAt) < 5000;
  }

  // 위 5초 창(recentlyInteracting)만으로는 부족한 경우가 있음 — 예를 들어 사진을 찍으러
  // 카메라 앱으로 나갔다가 돌아오거나, 한참 생각하다 입력을 이어가는 경우 5초가 넘게
  // 지나버림. 그래서 "현재 화면에 저장 안 된 입력 내용이 남아있는지" 자체를 검사해서,
  // 내용이 남아있으면 시간에 상관없이 자동 새로고침으로 화면을 덮어쓰지 않도록 한다.
  // 각 화면(폼)은 자신이 그려질 때 unsavedCheckers 배열에 자기 상태를 검사하는 함수를
  // 등록하고, render()가 다시 호출될 때마다 배열은 초기화된다.
  var unsavedCheckers = [];
  function hasUnsavedFormContent() {
    try {
      return unsavedCheckers.some(function (fn) {
        try { return !!fn(); } catch (e) { return false; }
      });
    } catch (e) { return false; }
  }

  var pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      refreshAll().then(function () {
        if (!recentlyInteracting() && !hasUnsavedFormContent()) { render(); }
      }).catch(function () {});
    }, 6000);
  }

  // ---------- root render ----------
  var app = document.getElementById('app');

  function render() {
    unsavedCheckers = [];
    app.innerHTML = '';
    if (STATE.view === 'ROLE_SELECT') { app.appendChild(viewRoleSelect()); return; }
    if (STATE.view === 'MANAGER') { app.appendChild(viewManager()); return; }
    if (STATE.view === 'CEO_LOGIN') { app.appendChild(viewLogin('ceo', '대표', '0001 (변경됨일 수 있음)')); return; }
    if (STATE.view === 'CEO_DASHBOARD') { app.appendChild(viewCeoDashboard()); return; }
    if (STATE.view === 'ACCOUNTANT_LOGIN') { app.appendChild(viewLogin('accountant', '경리', '1000 (변경됨일 수 있음)')); return; }
    if (STATE.view === 'ACCOUNTANT_DASHBOARD') { app.appendChild(viewAccountantDashboard()); return; }
  }

  function topbar(title, sub, onBack) {
    var right = null;
    if (STATE.me.role) {
      right = h('button', { onclick: function () {
        api('POST', '/api/auth/logout').then(function () {
          STATE.me = { role: null, name: null };
          STATE.view = 'ROLE_SELECT';
          render();
        });
      } }, ['로그아웃']);
    } else if (onBack) {
      right = h('button', { onclick: onBack }, ['← 뒤로']);
    }
    return h('div', { class: 'topbar' }, [
      h('div', {}, [
        h('h1', {}, [title]),
        sub ? h('div', { class: 'sub' }, [sub]) : null,
      ]),
      right,
    ]);
  }

  // ---------- ROLE SELECT ----------
  function viewRoleSelect() {
    var wrap = h('div', {}, [
      topbar('파인스페이스 지출결의', '역할을 선택해주세요'),
      h('div', { class: 'container' }, [
        h('div', { class: 'role-grid' }, [
          h('div', { class: 'role-card', onclick: function () { STATE.view = 'MANAGER'; render(); } }, [
            h('div', { class: 'emoji' }, ['🏗️']),
            h('div', {}, [
              h('div', { class: 'title' }, ['현장담당자']),
              h('div', { class: 'desc' }, ['지출요청을 제출합니다']),
            ]),
          ]),
          h('div', { class: 'role-card', onclick: function () { STATE.view = 'CEO_LOGIN'; render(); } }, [
            h('div', { class: 'emoji' }, ['✅']),
            h('div', {}, [
              h('div', { class: 'title' }, ['대표']),
              h('div', { class: 'desc' }, ['지출요청을 승인/반려합니다']),
            ]),
          ]),
          h('div', { class: 'role-card', onclick: function () { STATE.view = 'ACCOUNTANT_LOGIN'; render(); } }, [
            h('div', { class: 'emoji' }, ['💳']),
            h('div', {}, [
              h('div', { class: 'title' }, ['경리']),
              h('div', { class: 'desc' }, ['승인된 건을 지급 처리합니다']),
            ]),
          ]),
        ]),
      ]),
    ]);
    return wrap;
  }

  // ---------- LOGIN ----------
  function viewLogin(role, label, hint) {
    var pwVal = '';
    var errMsg = '';
    var wrap = h('div', {}, [
      topbar(label + ' 로그인', null, function () { STATE.view = 'ROLE_SELECT'; render(); }),
      h('div', { class: 'container' }, []),
    ]);
    var container = wrap.querySelector('.container');

    function submit() {
      api('POST', '/api/auth/login', { role: role, password: pwVal }).then(function (data) {
        STATE.me = { role: data.role, name: data.name };
        STATE.view = role === 'ceo' ? 'CEO_DASHBOARD' : 'ACCOUNTANT_DASHBOARD';
        STATE.loading = true;
        render();
        refreshAll().then(function () { STATE.loading = false; render(); startPolling(); });
      }).catch(function (err) {
        errMsg = err.message || '로그인 실패';
        rerenderForm();
      });
    }

    function rerenderForm() {
      var old = container.querySelector('.login-form');
      var box = h('div', { class: 'card login-form' }, [
        h('label', {}, ['비밀번호']),
        h('input', {
          type: 'password', autocomplete: 'off', placeholder: '비밀번호 입력',
          oninput: function (e) { pwVal = e.target.value; },
          onkeydown: function (e) { if (e.key === 'Enter') submit(); },
        }, []),
        errMsg ? h('div', { class: 'field-hint', style: 'color:#dc2626;' }, [errMsg]) : null,
        h('button', { class: 'btn btn-primary', onclick: submit }, ['로그인']),
      ]);
      if (old) old.replaceWith(box); else container.appendChild(box);
    }
    rerenderForm();
    return wrap;
  }

  // ---------- MANAGER ----------
  function viewManager() {
    if (!STATE.manager.siteId) {
      return viewManagerSetup();
    }
    return viewManagerHome();
  }

  function viewManagerSetup() {
    var nameVal = STATE.manager.name;
    var newSiteName = '';
    var showNewSite = false;
    var siteFilterText = '';
    var showClosedSites = false;

    unsavedCheckers.push(function () {
      return !!(nameVal && nameVal.trim()) || !!(showNewSite && newSiteName && newSiteName.trim());
    });

    var wrap = h('div', {}, [
      topbar('현장담당자', '현장과 이름을 선택해주세요', function () { STATE.view = 'ROLE_SELECT'; render(); }),
      h('div', { class: 'container' }, []),
    ]);
    var container = wrap.querySelector('.container');

    function drawBody() {
      container.innerHTML = '';

      container.appendChild(h('label', {}, ['담당자 이름']));
      container.appendChild(h('input', {
        type: 'text', placeholder: '이름 입력', value: nameVal,
        oninput: function (e) { nameVal = e.target.value; },
      }, []));

      container.appendChild(h('label', {}, ['현장 선택']));
      container.appendChild(h('input', {
        type: 'text', placeholder: '현장 이름 검색', value: siteFilterText, autocomplete: 'off',
        oninput: function (e) { siteFilterText = e.target.value; renderSiteChips(); },
      }, []));
      var siteChips = h('div', { class: 'chip-row' }, []);
      container.appendChild(siteChips);

      function renderSiteChips() {
        siteChips.innerHTML = '';
        var q = siteFilterText.trim().toLowerCase();
        var list = STATE.sites.filter(function (s) {
          if (!showClosedSites && s.active === false) return false;
          if (!q) return true;
          return (s.name || '').toLowerCase().indexOf(q) !== -1;
        });
        if (!list.length) {
          siteChips.appendChild(h('div', { class: 'field-hint' }, [q ? '검색 결과가 없습니다.' : '표시할 현장이 없습니다.']));
        }
        list.forEach(function (s) {
          siteChips.appendChild(h('div', {
            class: 'chip' + (STATE.manager.siteId === s.id ? ' active' : '') + (s.active === false ? ' inactive' : ''),
            onclick: function () { STATE.manager.siteId = s.id; STATE.manager.siteName = s.name; drawBody(); },
          }, [s.name + (s.active === false ? ' (종료됨)' : '')]));
        });
      }
      renderSiteChips();

      container.appendChild(h('button', {
        class: 'btn btn-secondary btn-sm', style: 'margin-top:8px;',
        onclick: function () { showClosedSites = !showClosedSites; renderSiteChips(); },
      }, [showClosedSites ? '종료된 현장 숨기기' : '종료된 현장도 보기']));

      if (!STATE.sites.length) {
        container.appendChild(h('div', { class: 'field-hint' }, ['등록된 현장이 없습니다. 아래에서 새로 추가해주세요.']));
      }

      container.appendChild(h('button', {
        class: 'btn btn-secondary', style: 'margin-top:12px;',
        onclick: function () { showNewSite = !showNewSite; drawBody(); },
      }, [showNewSite ? '취소' : '+ 새 현장 추가']));

      if (showNewSite) {
        container.appendChild(h('div', { class: 'card', style: 'margin-top:10px;' }, [
          h('label', {}, ['새 현장 이름']),
          h('input', {
            type: 'text', placeholder: '예: OO아파트 신축현장', value: newSiteName,
            oninput: function (e) { newSiteName = e.target.value; },
          }, []),
          h('button', {
            class: 'btn btn-primary', onclick: function () {
              var n = newSiteName.trim();
              if (!n) { toast('현장 이름을 입력해주세요.'); return; }
              api('POST', '/api/sites', { name: n, manager: nameVal }).then(function (site) {
                STATE.sites.unshift(site);
                STATE.manager.siteId = site.id;
                STATE.manager.siteName = site.name;
                showNewSite = false;
                drawBody();
              }).catch(function (err) { toast(err.message); });
            },
          }, ['현장 추가']),
        ]));
      }

      container.appendChild(h('button', {
        class: 'btn btn-primary', style: 'margin-top:20px;',
        onclick: function () {
          if (!nameVal.trim()) { toast('이름을 입력해주세요.'); return; }
          if (!STATE.manager.siteId) { toast('현장을 선택해주세요.'); return; }
          STATE.manager.name = nameVal.trim();
          saveManagerLocal();
          STATE.loading = true;
          render();
          refreshAll().then(function () { STATE.loading = false; render(); startPolling(); });
        },
      }, ['확인']));
    }

    drawBody();
    return wrap;
  }

  function viewManagerHome() {
    var draft = { editingId: null, date: todayStr(), vendorId: null, vendorName: '', amount: '', description: '', memo: '', photoUrls: [], isUrgent: false, urgentReason: '' };
    var showNewVendor = false;
    var newVendor = { name: '', bank: '', account: '', contact: '', bizNo: '', memo: '' };
    var uploading = false;

    function resetDraft() {
      draft.editingId = null;
      draft.date = todayStr(); draft.vendorId = null; draft.vendorName = ''; draft.amount = '';
      draft.description = ''; draft.memo = ''; draft.photoUrls = []; draft.isUrgent = false; draft.urgentReason = '';
    }

    function startEdit(row) {
      draft.editingId = row.id;
      draft.date = row.date;
      draft.vendorId = row.vendor_id;
      draft.vendorName = row.vendor_name || '';
      draft.amount = String(row.amount);
      draft.description = row.description || '';
      draft.memo = row.memo || '';
      draft.photoUrls = Array.isArray(row.photo_urls) && row.photo_urls.length ? row.photo_urls.slice() : (row.photo_url ? [row.photo_url] : []);
      draft.isUrgent = false;
      draft.urgentReason = '';
      toast('수정 모드입니다. 내용을 고친 후 "수정 완료"를 눌러주세요.');
      drawAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    unsavedCheckers.push(function () {
      return !!(draft.editingId || (draft.vendorName && draft.vendorName.trim()) ||
        (draft.amount !== '' && draft.amount !== null && String(draft.amount).trim()) ||
        (draft.description && draft.description.trim()) || (draft.memo && draft.memo.trim()) ||
        (draft.photoUrls && draft.photoUrls.length) || (draft.urgentReason && draft.urgentReason.trim()) ||
        (showNewVendor && newVendor.name && newVendor.name.trim()));
    });

    var wrap = h('div', {}, [
      topbar('현장담당자 · ' + STATE.manager.name, STATE.manager.siteName, function () {
        STATE.manager = { siteId: null, siteName: '', name: STATE.manager.name };
        saveManagerLocal();
        render();
      }),
      h('div', { class: 'container' }, []),
    ]);
    var container = wrap.querySelector('.container');

    function myRequests() {
      return STATE.requests.filter(function (r) { return r.site_id === STATE.manager.siteId; });
    }

    function drawStats() {
      var mine = myRequests();
      var pending = mine.filter(function (r) { return r.status === 'pending'; }).length;
      var approved = mine.filter(function (r) { return r.status === 'approved' || r.status === 'paid'; }).length;
      var urgent = mine.filter(function (r) { return r.is_urgent; }).length;
      return h('div', { class: 'quick-stats' }, [
        h('div', { class: 'stat-box pending' }, [h('div', { class: 'num' }, [pending]), h('div', { class: 'label' }, ['대기중'])]),
        h('div', { class: 'stat-box approved' }, [h('div', { class: 'num' }, [approved]), h('div', { class: 'label' }, ['승인/지급'])]),
        h('div', { class: 'stat-box urgent' }, [h('div', { class: 'num' }, [urgent]), h('div', { class: 'label' }, ['초긴급'])]),
      ]);
    }

    function drawForm() {
      var box = h('div', { class: 'card' }, []);

      box.appendChild(h('label', {}, ['날짜']));
      box.appendChild(h('input', { type: 'date', value: draft.date, oninput: function (e) { draft.date = e.target.value; } }, []));

      box.appendChild(h('label', {}, ['거래처 (직접 입력하거나 아래 목록에서 선택)']));
      box.appendChild(h('input', {
        type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        placeholder: '예: 대한철강, OO주유소', value: draft.vendorName,
        oninput: function (e) { draft.vendorName = e.target.value; draft.vendorId = null; },
      }, []));
      if (STATE.vendors.length) {
        var vchips = h('div', { class: 'chip-row' }, []);
        STATE.vendors.forEach(function (v) {
          vchips.appendChild(h('div', {
            class: 'chip' + (draft.vendorId === v.id ? ' active' : ''),
            onclick: function () {
              draft.vendorId = v.id; draft.vendorName = v.name;
              var input = box.querySelector('input[type=text]');
              if (input) input.value = v.name;
              vchips.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
              this.classList.add('active');
            },
          }, [v.name]));
        });
        box.appendChild(vchips);
      }
      box.appendChild(h('button', {
        class: 'btn btn-secondary btn-sm', style: 'margin-top:8px;',
        onclick: function () { showNewVendor = !showNewVendor; drawAll(); },
      }, [showNewVendor ? '취소' : '+ 새 거래처 등록']));

      if (showNewVendor) {
        box.appendChild(vendorRegForm());
      }

      box.appendChild(h('label', {}, ['금액']));
      box.appendChild(h('input', { type: 'number', inputmode: 'numeric', placeholder: '숫자만 입력', value: draft.amount, oninput: function (e) { draft.amount = e.target.value; } }, []));

      box.appendChild(h('label', {}, ['내용']));
      box.appendChild(h('input', { type: 'text', placeholder: '예: 철근 자재 구매', value: draft.description, oninput: function (e) { draft.description = e.target.value; } }, []));

      box.appendChild(h('label', {}, ['메모 (선택)']));
      box.appendChild(h('textarea', { oninput: function (e) { draft.memo = e.target.value; } }, []));

      box.appendChild(h('label', {}, ['증빙 사진/영수증 첨부 (여러 장 가능)']));
      function photoStatusText() {
        if (uploading) return '업로드 중...';
        return draft.photoUrls.length ? (draft.photoUrls.length + '장 첨부됨 ✓') : '첨부된 근거자료(사진)이 없습니다.';
      }
      var photoStatus = h('div', { class: 'field-hint' }, [photoStatusText()]);
      var photoPreview = h('div', { class: 'photo-preview-row' }, []);
      function renderPhotoPreview() {
        photoPreview.innerHTML = '';
        draft.photoUrls.forEach(function (url, idx) {
          photoPreview.appendChild(h('div', { class: 'photo-thumb' }, [
            h('img', { src: url, alt: '첨부 사진' }, []),
            h('button', {
              type: 'button', class: 'photo-thumb-remove',
              onclick: function () {
                draft.photoUrls.splice(idx, 1);
                photoStatus.textContent = photoStatusText();
                renderPhotoPreview();
              },
            }, ['✕']),
          ]));
        });
      }
      renderPhotoPreview();
      box.appendChild(h('input', {
        type: 'file', accept: 'image/*', capture: 'environment', multiple: true,
        onchange: function (e) {
          var files = Array.prototype.slice.call(e.target.files || []);
          if (!files.length) return;
          uploading = true;
          var total = files.length, done = 0;
          photoStatus.textContent = '업로드 중... (0/' + total + ')';
          var uploadNext = function (i) {
            if (i >= files.length) {
              uploading = false;
              photoStatus.textContent = photoStatusText();
              renderPhotoPreview();
              e.target.value = '';
              return;
            }
            uploadPhoto(files[i]).then(function (url) {
              draft.photoUrls.push(url);
              done++;
              photoStatus.textContent = '업로드 중... (' + done + '/' + total + ')';
              uploadNext(i + 1);
            }).catch(function (err) {
              uploading = false;
              photoStatus.textContent = '업로드 실패: ' + err.message;
              renderPhotoPreview();
            });
          };
          uploadNext(0);
        },
      }, []));
      box.appendChild(photoStatus);
      box.appendChild(photoPreview);

      box.appendChild(h('div', { class: 'checkbox-row' }, [
        h('input', { type: 'checkbox', id: 'urgentChk', checked: draft.isUrgent, onchange: function (e) { draft.isUrgent = e.target.checked; drawAll(); } }, []),
        h('label', { for: 'urgentChk' }, ['🚨 초긴급 (대표 승인 없이 즉시 처리, 사유 필수 · 사후 감사 대상)']),
      ]));
      if (draft.isUrgent) {
        box.appendChild(h('div', { class: 'banner banner-urgent', style: 'margin-top:8px;' }, [
          '초긴급으로 표시하면 대표 승인 절차 없이 바로 승인 처리되며, 사유와 함께 기록되어 추후 대표님이 확인합니다.',
        ]));
        box.appendChild(h('label', {}, ['초긴급 사유 (필수)']));
        box.appendChild(h('input', { type: 'text', placeholder: '예: 긴급 자재 미납 시 공정 중단', value: draft.urgentReason, oninput: function (e) { draft.urgentReason = e.target.value; } }, []));
      }

      box.appendChild(h('button', {
        class: 'btn btn-primary', onclick: function () {
          if (!draft.date) { toast('날짜를 입력해주세요.'); return; }
          if (!draft.vendorName.trim()) { toast('거래처를 입력해주세요.'); return; }
          var amt = Number(draft.amount);
          if (!amt || amt <= 0) { toast('금액을 올바르게 입력해주세요.'); return; }
          if (!draft.description.trim()) { toast('내용을 입력해주세요.'); return; }
          if (draft.isUrgent && !draft.urgentReason.trim()) { toast('초긴급 사유를 입력해주세요.'); return; }
          if (uploading) { toast('사진 업로드가 끝날 때까지 기다려주세요.'); return; }

          if (draft.editingId) {
            api('PUT', '/api/requests/' + draft.editingId, {
              date: draft.date,
              vendor_id: draft.vendorId,
              vendor_name: draft.vendorName.trim(),
              amount: amt,
              description: draft.description.trim(),
              memo: draft.memo,
              photo_urls: draft.photoUrls,
            }).then(function (updated) {
              applyUpdatedRequest(updated);
              toast('지출요청이 수정되었습니다.');
              resetDraft();
              drawAll();
            }).catch(function (err) { toast(err.message); });
            return;
          }

          api('POST', '/api/requests', {
            site_id: STATE.manager.siteId,
            site_name: STATE.manager.siteName,
            manager_name: STATE.manager.name,
            date: draft.date,
            vendor_id: draft.vendorId,
            vendor_name: draft.vendorName.trim(),
            amount: amt,
            description: draft.description.trim(),
            memo: draft.memo,
            photo_urls: draft.photoUrls,
            is_urgent: draft.isUrgent,
            urgent_reason: draft.urgentReason,
          }).then(function (reqRow) {
            STATE.requests.unshift(reqRow);
            toast(draft.isUrgent ? '초긴급 지출요청이 제출·자동승인되었습니다.' : '지출요청이 제출되었습니다.');
            resetDraft();
            drawAll();
          }).catch(function (err) { toast(err.message); });
        },
      }, [draft.editingId ? '수정 완료' : '지출요청 제출']));

      if (draft.editingId) {
        box.appendChild(h('button', {
          class: 'btn btn-secondary', style: 'margin-top:8px;',
          onclick: function () { resetDraft(); drawAll(); },
        }, ['수정 취소']));
      }

      return box;
    }

    function vendorRegForm() {
      return h('div', { class: 'card', style: 'margin-top:8px;background:#f9fafb;' }, [
        h('label', {}, ['거래처명']),
        h('input', { type: 'text', value: newVendor.name, oninput: function (e) { newVendor.name = e.target.value; } }, []),
        h('label', {}, ['은행']),
        h('input', { type: 'text', value: newVendor.bank, oninput: function (e) { newVendor.bank = e.target.value; } }, []),
        h('label', {}, ['계좌번호']),
        h('input', { type: 'text', value: newVendor.account, oninput: function (e) { newVendor.account = e.target.value; } }, []),
        h('label', {}, ['연락처']),
        h('input', { type: 'text', value: newVendor.contact, oninput: function (e) { newVendor.contact = e.target.value; } }, []),
        h('label', {}, ['사업자등록번호']),
        h('input', { type: 'text', value: newVendor.bizNo, oninput: function (e) { newVendor.bizNo = e.target.value; } }, []),
        h('button', {
          class: 'btn btn-primary btn-sm', onclick: function () {
            if (!newVendor.name.trim()) { toast('거래처명을 입력해주세요.'); return; }
            api('POST', '/api/vendors', {
              name: newVendor.name.trim(), bank: newVendor.bank, account: newVendor.account,
              contact: newVendor.contact, biz_no: newVendor.bizNo, memo: '',
            }).then(function (v) {
              STATE.vendors.unshift(v);
              draft.vendorId = v.id; draft.vendorName = v.name;
              showNewVendor = false;
              newVendor = { name: '', bank: '', account: '', contact: '', bizNo: '', memo: '' };
              toast('거래처가 등록되었습니다.');
              drawAll();
            }).catch(function (err) { toast(err.message); });
          },
        }, ['거래처 등록']),
      ]);
    }

    function drawList() {
      var wrap2 = h('div', {}, []);
      wrap2.appendChild(h('div', { class: 'section-title' }, ['내가 제출한 요청']));
      var mine = myRequests();
      if (!mine.length) {
        wrap2.appendChild(h('div', { class: 'empty' }, ['제출한 요청이 없습니다.']));
      } else {
        mine.forEach(function (r) {
          wrap2.appendChild(requestCard(r, {
            actions: r.status === 'pending' ? function (row) {
              return h('div', { class: 'req-actions' }, [
                h('button', { class: 'btn btn-secondary', onclick: function () { startEdit(row); } }, ['✏️ 수정 (회수)']),
              ]);
            } : null,
          }));
        });
      }
      return wrap2;
    }

    function drawAll() {
      container.innerHTML = '';
      container.appendChild(drawStats());
      container.appendChild(h('div', { class: 'section-title' }, ['새 지출요청']));
      container.appendChild(drawForm());
      container.appendChild(drawList());
    }

    drawAll();
    return wrap;
  }

  // ---------- request card (shared) ----------
  function requestCard(r, opts) {
    opts = opts || {};
    var card = h('div', { class: 'req-card' }, []);
    var row1 = h('div', { class: 'row1' }, [
      h('div', {}, [
        h('span', { class: 'amount' }, [won(r.amount)]),
        h('span', { class: 'badge ' + (STATUS_BADGE[r.status] || '') }, [STATUS_LABEL[r.status] || r.status]),
        r.is_urgent ? h('span', { class: 'badge badge-urgent' }, ['초긴급']) : null,
      ]),
    ]);
    card.appendChild(row1);
    card.appendChild(h('div', { class: 'desc' }, [r.description]));
    card.appendChild(h('div', { class: 'meta' }, [
      r.site_name + ' · ' + r.manager_name + ' · ' + r.date,
      h_br(),
      '거래처: ' + (r.vendor_name || '-') + (r.memo ? (' · 메모: ' + r.memo) : ''),
    ]));
    if (r.is_urgent && r.urgent_reason) {
      card.appendChild(h('div', { class: 'banner banner-urgent', style: 'margin-top:8px;' }, ['초긴급 사유: ' + r.urgent_reason]));
    }
    if (r.status === 'rejected' && r.ceo_comment) {
      card.appendChild(h('div', { class: 'field-hint', style: 'color:#b91c1c;' }, ['반려 사유: ' + r.ceo_comment]));
    }
    if (r.status === 'approved' && r.ceo_comment && !r.is_urgent) {
      card.appendChild(h('div', { class: 'field-hint' }, ['승인 의견: ' + r.ceo_comment]));
    }
    if (r.ceo_by) {
      card.appendChild(h('div', { class: 'field-hint' }, [(r.is_urgent ? '자동승인' : '승인/반려') + ': ' + r.ceo_by + ' (' + fmtDate(r.ceo_at) + ')']));
    }
    if (r.paid_by) {
      card.appendChild(h('div', { class: 'field-hint' }, ['지급: ' + r.paid_by + ' · ' + r.paid_date + (r.paid_memo ? (' · ' + r.paid_memo) : '')]));
    }
    var cardPhotoUrls = Array.isArray(r.photo_urls) && r.photo_urls.length ? r.photo_urls : (r.photo_url ? [r.photo_url] : []);
    if (cardPhotoUrls.length) {
      var photoRow = h('div', { class: 'req-photo-row' }, []);
      cardPhotoUrls.forEach(function (url) {
        photoRow.appendChild(h('img', { class: 'req-photo', src: url, alt: '증빙 사진' }, []));
      });
      card.appendChild(photoRow);
    }
    if (opts.actions) {
      card.appendChild(opts.actions(r));
    }
    return card;
  }
  function h_br() { return document.createElement('br'); }

  // ---------- CEO DASHBOARD ----------
  function viewCeoDashboard() {
    var wrap = h('div', {}, [
      topbar('대표 · ' + STATE.me.name, '지출요청 승인'),
      h('div', { class: 'container' }, []),
    ]);
    var container = wrap.querySelector('.container');
    var ceoComments = {};

    unsavedCheckers.push(function () {
      return Object.keys(ceoComments).some(function (id) { return ceoComments[id] && ceoComments[id].trim(); });
    });

    function draw() {
      container.innerHTML = '';
      if (STATE.loading) { container.appendChild(h('div', { class: 'empty' }, ['불러오는 중...'])); return; }

      var pending = STATE.requests.filter(function (r) { return r.status === 'pending'; });
      var urgentAuto = STATE.requests.filter(function (r) { return r.is_urgent; });
      var all = STATE.requests;

      container.appendChild(h('div', { class: 'quick-stats' }, [
        h('div', { class: 'stat-box pending' }, [h('div', { class: 'num' }, [pending.length]), h('div', { class: 'label' }, ['승인대기'])]),
        h('div', { class: 'stat-box approved' }, [h('div', { class: 'num' }, [all.filter(function (r) { return r.status === 'approved' || r.status === 'paid'; }).length]), h('div', { class: 'label' }, ['승인됨'])]),
        h('div', { class: 'stat-box urgent' }, [h('div', { class: 'num' }, [urgentAuto.length]), h('div', { class: 'label' }, ['초긴급건'])]),
      ]));

      var tabs = h('div', { class: 'tabs' }, []);
      [['pending', '승인대기'], ['all', '전체내역'], ['urgentAudit', '초긴급 감사']].forEach(function (t) {
        tabs.appendChild(h('div', { class: 'tab' + (STATE.ceoTab === t[0] ? ' active' : ''), onclick: function () { STATE.ceoTab = t[0]; draw(); } }, [t[1]]));
      });
      container.appendChild(tabs);

      var list;
      if (STATE.ceoTab === 'pending') list = pending;
      else if (STATE.ceoTab === 'urgentAudit') list = urgentAuto;
      else list = all;

      if (!list.length) {
        container.appendChild(h('div', { class: 'empty' }, ['표시할 요청이 없습니다.']));
      } else {
        list.forEach(function (r) {
          container.appendChild(requestCard(r, {
            actions: function (row) {
              if (row.status !== 'pending') return h('div', {}, []);
              if (ceoComments[row.id] === undefined) ceoComments[row.id] = '';
              var actWrap = h('div', {}, [
                h('input', {
                  type: 'text', placeholder: '승인/반려 의견 (선택)', value: ceoComments[row.id],
                  oninput: function (e) { ceoComments[row.id] = e.target.value; },
                }, []),
                h('div', { class: 'req-actions' }, [
                  h('button', {
                    class: 'btn btn-success', onclick: function () {
                      api('POST', '/api/requests/' + row.id + '/decide', { decision: 'approved', comment: ceoComments[row.id] }).then(function (updated) {
                        applyUpdatedRequest(updated);
                        delete ceoComments[row.id];
                        toast('승인 처리되었습니다.');
                        draw();
                      }).catch(function (err) { toast(err.message); });
                    },
                  }, ['승인']),
                  h('button', {
                    class: 'btn btn-danger', onclick: function () {
                      api('POST', '/api/requests/' + row.id + '/decide', { decision: 'rejected', comment: ceoComments[row.id] }).then(function (updated) {
                        delete ceoComments[row.id];
                        applyUpdatedRequest(updated);
                        toast('반려 처리되었습니다.');
                        draw();
                      }).catch(function (err) { toast(err.message); });
                    },
                  }, ['반려']),
                ]),
              ]);
              return actWrap;
            },
          }));
        });
      }

      container.appendChild(h('div', { class: 'section-title' }, ['현장 / 거래처 관리']));
      container.appendChild(siteVendorManageBox());
    }

    draw();
    return wrap;
  }

  // ---------- ACCOUNTANT DASHBOARD ----------
  function viewAccountantDashboard() {
    var wrap = h('div', {}, [
      topbar('경리 · ' + STATE.me.name, '지급 처리 / 지출결의서'),
      h('div', { class: 'container' }, []),
    ]);
    var container = wrap.querySelector('.container');
    var accMemos = {};

    unsavedCheckers.push(function () {
      return Object.keys(accMemos).some(function (id) { return accMemos[id] && accMemos[id].trim(); });
    });

    function draw() {
      container.innerHTML = '';
      if (STATE.loading) { container.appendChild(h('div', { class: 'empty' }, ['불러오는 중...'])); return; }

      var toPay = STATE.requests.filter(function (r) { return r.status === 'approved'; });
      var paid = STATE.requests.filter(function (r) { return r.status === 'paid'; });

      container.appendChild(h('div', { class: 'quick-stats' }, [
        h('div', { class: 'stat-box pending' }, [h('div', { class: 'num' }, [toPay.length]), h('div', { class: 'label' }, ['지급대기'])]),
        h('div', { class: 'stat-box approved' }, [h('div', { class: 'num' }, [paid.length]), h('div', { class: 'label' }, ['지급완료'])]),
        h('div', { class: 'stat-box urgent' }, [h('div', { class: 'num' }, [toPay.filter(function (r) { return r.is_urgent; }).length]), h('div', { class: 'label' }, ['초긴급'])]),
      ]));

      container.appendChild(exportBox());

      var tabs = h('div', { class: 'tabs' }, []);
      [['toPay', '지급대기'], ['paid', '지급완료']].forEach(function (t) {
        tabs.appendChild(h('div', { class: 'tab' + (STATE.accTab === t[0] ? ' active' : ''), onclick: function () { STATE.accTab = t[0]; draw(); } }, [t[1]]));
      });
      container.appendChild(tabs);

      var list = STATE.accTab === 'toPay' ? toPay : paid;
      if (!list.length) {
        container.appendChild(h('div', { class: 'empty' }, ['표시할 요청이 없습니다.']));
      } else {
        list.forEach(function (r) {
          container.appendChild(requestCard(r, {
            actions: function (row) {
              var actWrap = h('div', {}, []);
              if (row.status === 'approved') {
                var dateVal = todayStr();
                if (accMemos[row.id] === undefined) accMemos[row.id] = '';
                actWrap.appendChild(h('label', {}, ['지급일']));
                actWrap.appendChild(h('input', { type: 'date', value: dateVal, oninput: function (e) { dateVal = e.target.value; } }, []));
                actWrap.appendChild(h('input', {
                  type: 'text', placeholder: '지급 메모 (선택)', value: accMemos[row.id],
                  oninput: function (e) { accMemos[row.id] = e.target.value; },
                }, []));
                actWrap.appendChild(h('div', { class: 'req-actions' }, [
                  h('button', {
                    class: 'btn btn-success', onclick: function () {
                      api('POST', '/api/requests/' + row.id + '/pay', { paid_date: dateVal, paid_memo: accMemos[row.id] }).then(function (updated) {
                        applyUpdatedRequest(updated);
                        delete accMemos[row.id];
                        toast('지급 처리되었습니다.');
                        draw();
                      }).catch(function (err) { toast(err.message); });
                    },
                  }, ['지급 완료 처리']),
                ]));
              }
              actWrap.appendChild(h('div', { class: 'req-actions' }, [
                h('button', { class: 'btn btn-secondary', onclick: function () { printRequest(row); } }, ['🖨 지출결의서 인쇄']),
              ]));
              return actWrap;
            },
          }));
        });
      }

      container.appendChild(h('div', { class: 'section-title' }, ['현장 / 거래처 관리']));
      container.appendChild(siteVendorManageBox());
    }

    draw();
    return wrap;
  }

  function exportBox() {
    var monthVal = new Date().toISOString().slice(0, 7);
    return h('div', { class: 'card' }, [
      h('label', {}, ['월별 엑셀 내보내기']),
      h('input', { type: 'month', value: monthVal, oninput: function (e) { monthVal = e.target.value; } }, []),
      h('div', { class: 'req-actions' }, [
        h('button', { class: 'btn btn-secondary', onclick: function () { window.location.href = '/api/requests/export?month=' + encodeURIComponent(monthVal); } }, ['이번 달 다운로드']),
        h('button', { class: 'btn btn-secondary', onclick: function () { window.location.href = '/api/requests/export'; } }, ['전체 다운로드']),
      ]),
    ]);
  }

  function siteVendorManageBox() {
    var wrap = h('div', {}, []);
    var newSiteName = '';
    var newVendor = { name: '', bank: '', account: '', contact: '', bizNo: '' };

    unsavedCheckers.push(function () {
      return !!(newSiteName && newSiteName.trim()) || !!(newVendor.name && newVendor.name.trim());
    });

    var siteChipsRow = h('div', { class: 'chip-row' }, STATE.sites.map(function (s) {
      return h('div', { class: 'chip site-manage-chip' + (s.active === false ? ' inactive' : '') }, [
        h('span', {}, [s.name + (s.active === false ? ' (종료됨)' : '')]),
        h('button', {
          type: 'button', class: 'chip-toggle-btn',
          onclick: function () {
            var nextActive = s.active === false;
            api('PATCH', '/api/sites/' + s.id, { active: nextActive }).then(function (updated) {
              var idx = STATE.sites.findIndex(function (x) { return x.id === updated.id; });
              if (idx >= 0) STATE.sites[idx] = updated;
              toast(nextActive ? '현장을 다시 활성화했습니다.' : '현장을 종료 처리했습니다. (현장담당자 선택 목록에서 제외되며, 기존 요청 내역은 그대로 보존됩니다)');
              render();
            }).catch(function (err) { toast(err.message); });
          },
        }, [s.active === false ? '재개' : '종료']),
      ]);
    }));

    var siteCard = h('div', { class: 'card' }, [
      h('label', {}, ['현장 목록 (' + STATE.sites.length + ')']),
      siteChipsRow,
      h('label', {}, ['새 현장 추가']),
      h('input', { type: 'text', placeholder: '현장 이름', oninput: function (e) { newSiteName = e.target.value; } }, []),
      h('button', {
        class: 'btn btn-secondary btn-sm', onclick: function () {
          if (!newSiteName.trim()) { toast('현장 이름을 입력해주세요.'); return; }
          api('POST', '/api/sites', { name: newSiteName.trim(), manager: '' }).then(function (s) {
            STATE.sites.unshift(s);
            toast('현장이 추가되었습니다.');
            render();
          }).catch(function (err) { toast(err.message); });
        },
      }, ['현장 추가']),
    ]);

    var vendorCard = h('div', { class: 'card' }, [
      h('label', {}, ['거래처 목록 (' + STATE.vendors.length + ')']),
      h('div', { class: 'chip-row' }, STATE.vendors.map(function (v) { return h('div', { class: 'chip' }, [v.name]); })),
      h('label', {}, ['새 거래처 등록']),
      h('input', { type: 'text', placeholder: '거래처명', oninput: function (e) { newVendor.name = e.target.value; } }, []),
      h('input', { type: 'text', placeholder: '은행', oninput: function (e) { newVendor.bank = e.target.value; } }, []),
      h('input', { type: 'text', placeholder: '계좌번호', oninput: function (e) { newVendor.account = e.target.value; } }, []),
      h('input', { type: 'text', placeholder: '연락처', oninput: function (e) { newVendor.contact = e.target.value; } }, []),
      h('input', { type: 'text', placeholder: '사업자등록번호', oninput: function (e) { newVendor.bizNo = e.target.value; } }, []),
      h('button', {
        class: 'btn btn-secondary btn-sm', onclick: function () {
          if (!newVendor.name.trim()) { toast('거래처명을 입력해주세요.'); return; }
          api('POST', '/api/vendors', {
            name: newVendor.name.trim(), bank: newVendor.bank, account: newVendor.account,
            contact: newVendor.contact, biz_no: newVendor.bizNo, memo: '',
          }).then(function (v) {
            STATE.vendors.unshift(v);
            toast('거래처가 등록되었습니다.');
            render();
          }).catch(function (err) { toast(err.message); });
        },
      }, ['거래처 등록']),
    ]);

    wrap.appendChild(siteCard);
    wrap.appendChild(vendorCard);
    return wrap;
  }

  function applyUpdatedRequest(updated) {
    var idx = STATE.requests.findIndex(function (r) { return r.id === updated.id; });
    if (idx >= 0) STATE.requests[idx] = updated;
  }

  // ---------- print (지출결의서) ----------
  function printRequest(r) {
    var area = document.getElementById('printArea');
    area.innerHTML = '';
    area.appendChild(h('h2', {}, ['지 출 결 의 서']));
    area.appendChild(h('div', { class: 'sub-title' }, ['파인스페이스']));

    var table = h('table', { class: 'print-table' }, []);
    function row(label, val) {
      table.appendChild(h('tr', {}, [h('th', {}, [label]), h('td', {}, [val || '-'])]));
    }
    row('현장', r.site_name);
    row('담당자', r.manager_name);
    row('요청일', r.date);
    row('거래처', r.vendor_name);
    row('금액', won(r.amount));
    row('내용', r.description);
    row('메모', r.memo);
    row('구분', r.is_urgent ? ('초긴급 (사유: ' + r.urgent_reason + ')') : '일반');
    row('승인', (r.ceo_by || '-') + (r.ceo_at ? (' / ' + fmtDate(r.ceo_at)) : ''));
    row('승인의견', r.ceo_comment);
    row('지급', (r.paid_by || '-') + (r.paid_date ? (' / ' + r.paid_date) : ''));
    row('지급메모', r.paid_memo);
    area.appendChild(table);

    var printPhotoUrls = Array.isArray(r.photo_urls) && r.photo_urls.length ? r.photo_urls : (r.photo_url ? [r.photo_url] : []);
    if (printPhotoUrls.length) {
      area.appendChild(h('div', { class: 'evidence-title' }, ['첨부 증빙자료 (' + printPhotoUrls.length + '장)']));
      var evidenceRow = h('div', { class: 'evidence-photo-row' }, []);
      printPhotoUrls.forEach(function (url) {
        evidenceRow.appendChild(h('img', { class: 'evidence-photo', src: url }, []));
      });
      area.appendChild(evidenceRow);
    } else {
      area.appendChild(h('div', { class: 'evidence-title' }, ['첨부된 근거자료(사진)이 없습니다.']));
    }

    area.appendChild(h('div', { class: 'sign-row' }, [
      h('div', {}, ['대표: ' + (r.ceo_by || '_______') + ' (인)']),
      h('div', {}, ['경리: ' + (r.paid_by || '_______') + ' (인)']),
    ]));

    area.classList.add('active');
    setTimeout(function () {
      window.print();
    }, 50);
  }
  window.addEventListener('afterprint', function () {
    var area = document.getElementById('printArea');
    area.classList.remove('active');
    area.innerHTML = '';
  });

  // ---------- boot ----------
  function boot() {
    api('GET', '/api/auth/me').then(function (data) {
      if (data.role === 'ceo') {
        STATE.me = { role: 'ceo', name: data.name };
        STATE.view = 'CEO_DASHBOARD';
      } else if (data.role === 'accountant') {
        STATE.me = { role: 'accountant', name: data.name };
        STATE.view = 'ACCOUNTANT_DASHBOARD';
      }
      STATE.loading = true;
      render();
      return refreshAll().then(function () {
        STATE.loading = false;
        render();
        startPolling();
      });
    }).catch(function () {
      render();
    });
  }

  boot();
})();
