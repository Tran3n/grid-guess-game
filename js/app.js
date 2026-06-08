/**
 * app.js — 应用入口，路由 & 事件绑定
 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  // ========== 可见调试日志 ==========
  window.dbg = function () {
    var overlay = document.getElementById('debug-overlay');
    if (!overlay) return;
    overlay.style.display = 'block';
    var msg = '[' + new Date().toLocaleTimeString() + '] ' +
      Array.prototype.slice.call(arguments).join(' ');
    overlay.textContent += msg + '\n';
    console.log.apply(console, arguments);
  };

  // 在脚本加载时立即打印（验证代码已更新）
  dbg('app.js loaded, version: v11-nat');

  var hostCtrl = null;
  var guestCtrl = null;
  var soloState = null;

  // ========== 页面路由 ==========
  window.showPage = function (id) {
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      pages[i].classList.remove('active');
    }
    var target = document.getElementById(id);
    if (target) target.classList.add('active');
  };

  // ========== 首页 ==========
  $('#btn-be-host').addEventListener('click', function () {
    showPage('page-host-setup');
  });

  $('#btn-be-guest').addEventListener('click', function () {
    showPage('page-guest-join');
  });

  $('#btn-solo').addEventListener('click', function () {
    showPage('page-solo');
  });

  // ========== 房主：设置页面 ==========
  var hostImageData = null;

  // 上传图片
  $('#upload-area').addEventListener('click', function () {
    $('#file-input').click();
  });

  $('#upload-area').addEventListener('dragover', function (e) {
    e.preventDefault();
    this.classList.add('dragover');
  });

  $('#upload-area').addEventListener('dragleave', function () {
    this.classList.remove('dragover');
  });

  $('#upload-area').addEventListener('drop', function (e) {
    e.preventDefault();
    this.classList.remove('dragover');
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadHostImage(file);
  });

  $('#file-input').addEventListener('change', function () {
    if (this.files[0]) loadHostImage(this.files[0]);
  });

  function loadHostImage(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      hostImageData = e.target.result;
      $('#preview-img').src = hostImageData;
      $('#preview-img').hidden = false;
      $('#upload-area .upload-placeholder').style.display = 'none';
      checkHostReady();
    };
    reader.readAsDataURL(file);
  }

  function checkHostReady() {
    var answer = $('#input-answer').value.trim();
    $('#btn-create-room').disabled = !(hostImageData && answer);
  }

  $('#input-answer').addEventListener('input', checkHostReady);

  $('#grid-size').addEventListener('input', function () {
    var v = this.value;
    $('#grid-size-display').textContent = v + ' \u00d7 ' + v;
  });

  // 创建房间
  $('#btn-create-room').addEventListener('click', function () {
    var btn = this;
    dbg('Create room button clicked');

    try {
      // 检查 PeerJS 是否已加载
      if (typeof Peer === 'undefined') {
        dbg('ERROR: Peer is undefined');
        alert('PeerJS 库未加载，无法创建房间。\n请检查网络连接后刷新页面重试。');
        return;
      }
      dbg('Peer is available:', typeof Peer);

      btn.disabled = true;
      btn.textContent = '正在连接信令服务器...';

      hostCtrl = new HostController();
      dbg('HostController created');
      hostCtrl.init();
      dbg('hostCtrl.init() returned');

      var gridSize = parseInt($('#grid-size').value, 10);
      var answer = $('#input-answer').value.trim();
      hostCtrl._imageData = hostImageData;
      hostCtrl._gridSize = gridSize;
      hostCtrl._answer = answer;

      // 超时提示（15秒）
      var timeout = setTimeout(function () {
        dbg('TIMEOUT: peer.on(open) did not fire in 15s');
        if (!document.getElementById('page-host-lobby').classList.contains('active')) {
          alert('连接信令服务器超时。\n\n请查看页面右上角的调试信息并截图发给我。');
          btn.disabled = false;
          btn.textContent = '创建房间';
          if (hostCtrl) { hostCtrl.destroy(); hostCtrl = null; }
        }
      }, 15000);

      var origOpen = hostCtrl.network.onHostOpen;
      hostCtrl.network.onHostOpen = function (peerId) {
        dbg('onHostOpen fired:', peerId);
        clearTimeout(timeout);
        btn.disabled = false;
        btn.textContent = '创建房间';
        origOpen(peerId);
      };

      var origError = hostCtrl.network.onError;
      hostCtrl.network.onError = function (err) {
        dbg('onError fired:', err.message || err);
        clearTimeout(timeout);
        btn.disabled = false;
        btn.textContent = '创建房间';
        origError(err);
      };
    } catch (e) {
      dbg('EXCEPTION:', e.message, e.stack);
      alert('代码异常: ' + e.message);
      btn.disabled = false;
      btn.textContent = '创建房间';
    }
  });

  $('#btn-back-home-1').addEventListener('click', function () {
    showPage('page-home');
    hostImageData = null;
  });

  // ========== 房主：大厅 ==========
  $('#btn-start-game').addEventListener('click', function () {
    if (!hostCtrl) return;
    hostCtrl.startGame(hostCtrl._imageData, hostCtrl._gridSize, hostCtrl._answer);
  });

  $('#btn-cancel-room').addEventListener('click', function () {
    if (hostCtrl) {
      hostCtrl.destroy();
      hostCtrl = null;
    }
    showPage('page-home');
  });

  // ========== 房主：游戏控制 ==========
  $('#btn-judge-correct').addEventListener('click', function () {
    if (hostCtrl) hostCtrl.judge(true);
  });

  $('#btn-judge-wrong').addEventListener('click', function () {
    if (hostCtrl) hostCtrl.judge(false);
  });

  $('#btn-reveal-all').addEventListener('click', function () {
    if (hostCtrl) hostCtrl.revealAll();
  });

  $('#btn-next-round').addEventListener('click', function () {
    if (hostCtrl) hostCtrl.nextRound();
    // 客人端由消息驱动
  });

  $('#btn-round-end-home').addEventListener('click', function () {
    $('#modal-round-end').classList.add('hidden');
    if (hostCtrl) {
      hostCtrl.destroy();
      hostCtrl = null;
    }
    if (guestCtrl) {
      guestCtrl.destroy();
      guestCtrl = null;
    }
    showPage('page-home');
  });

  // ========== 客人：加入 ==========
  $('#btn-join-room').addEventListener('click', function () {
    var roomId = $('#input-room-id').value.trim().toUpperCase();
    var name = $('#input-name').value.trim();

    if (!roomId) {
      $('#join-error').textContent = '请输入房间号';
      $('#join-error').classList.remove('hidden');
      return;
    }
    if (!name) {
      $('#join-error').textContent = '请输入昵称';
      $('#join-error').classList.remove('hidden');
      return;
    }

    $('#join-error').classList.add('hidden');
    guestCtrl = new GuestController();
    guestCtrl.init();
    guestCtrl.join(roomId, name);
  });

  $('#btn-back-home-2').addEventListener('click', function () {
    showPage('page-home');
  });

  // ========== 客人：等待 ==========
  $('#btn-leave-wait').addEventListener('click', function () {
    if (guestCtrl) {
      guestCtrl.destroy();
      guestCtrl = null;
    }
    showPage('page-home');
  });

  // ========== 客人：游戏操作 ==========
  $('#btn-submit-guess').addEventListener('click', function () {
    if (guestCtrl) guestCtrl.submitGuess();
  });

  $('#guest-guess-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && guestCtrl) guestCtrl.submitGuess();
  });

  // ========== 单人模式 ==========
  var soloImageData = null;

  $('#solo-upload-area').addEventListener('click', function () {
    $('#solo-file-input').click();
  });

  $('#solo-file-input').addEventListener('change', function () {
    if (this.files[0]) loadSoloImage(this.files[0]);
  });

  function loadSoloImage(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      soloImageData = e.target.result;
      $('#solo-preview-img').src = soloImageData;
      $('#solo-preview-img').hidden = false;
      $('#solo-upload-area .upload-placeholder').style.display = 'none';
      $('#btn-solo-start').disabled = false;
    };
    reader.readAsDataURL(file);
  }

  $('#solo-grid-size').addEventListener('input', function () {
    var v = this.value;
    $('#solo-grid-display').textContent = v + ' \u00d7 ' + v;
  });

  $('#btn-solo-demo').addEventListener('click', function () {
    soloImageData = Game.generateDemoImage();
    $('#solo-preview-img').src = soloImageData;
    $('#solo-preview-img').hidden = false;
    $('#solo-upload-area .upload-placeholder').style.display = 'none';
    $('#btn-solo-start').disabled = false;
  });

  $('#btn-solo-start').addEventListener('click', function () {
    var gridSize = parseInt($('#solo-grid-size').value, 10);
    soloState = {
      imageData: soloImageData,
      gridSize: gridSize,
      totalCells: gridSize * gridSize,
      revealed: new Array(gridSize * gridSize).fill(false),
      revealedCount: 0
    };

    showPage('page-solo-game');
    var container = $('#solo-grid-container');

    Game.renderGrid(container, soloImageData, gridSize, soloState.revealed, function (idx) {
      if (soloState.revealed[idx]) return;
      soloState.revealed[idx] = true;
      soloState.revealedCount++;
      Game.flipCell(container, idx);
      updateSoloStats();
    });

    updateSoloStats();
  });

  function updateSoloStats() {
    if (!soloState) return;
    $('#solo-stat-revealed').textContent = soloState.revealedCount;
    $('#solo-stat-total').textContent = soloState.totalCells;
    $('#solo-stat-score').textContent = Game.calcScore(soloState.totalCells, soloState.revealedCount);
  }

  $('#solo-btn-guess').addEventListener('click', soloGuess);
  $('#solo-guess-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') soloGuess();
  });

  function soloGuess() {
    var text = $('#solo-guess-input').value.trim();
    if (!text) return;

    var score = Game.calcScore(soloState.totalCells, soloState.revealedCount);
    alert('你猜的是: "' + text + '"\n得分: ' + score + '\n（单人模式由自己判定是否正确）');
    $('#solo-guess-input').value = '';
  }

  $('#solo-btn-reset').addEventListener('click', function () {
    if (!soloState) return;
    soloState.revealed = new Array(soloState.totalCells).fill(false);
    soloState.revealedCount = 0;
    Game.resetCells($('#solo-grid-container'));
    updateSoloStats();
  });

  $('#solo-btn-back').addEventListener('click', function () {
    soloState = null;
    showPage('page-home');
  });

  $('#btn-solo-back').addEventListener('click', function () {
    showPage('page-home');
  });

  // ========== 窗口 resize ==========
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (soloState && document.getElementById('page-solo-game').classList.contains('active')) {
        Game.renderGrid($('#solo-grid-container'), soloState.imageData, soloState.gridSize, soloState.revealed, function (idx) {
          if (soloState.revealed[idx]) return;
          soloState.revealed[idx] = true;
          soloState.revealedCount++;
          Game.flipCell($('#solo-grid-container'), idx);
          updateSoloStats();
        });
      }
    }, 200);
  });
})();
