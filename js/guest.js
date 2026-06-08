/**
 * guest.js — 客人逻辑
 * 加入房间、接收游戏状态、翻格子、提交猜测
 */
(function (global) {
  'use strict';

  var MSG = Network.MSG;
  var $ = function (sel) { return document.querySelector(sel); };

  function GuestController() {
    this.network = null;
    this.myName = '';
    this.myConnId = '';      // 由服务器端 peer ID 充当
    this.players = [];       // 从房主同步的玩家列表
    this.gameState = null;   // { imageData, gridSize, revealed, revealedCount }
    this.isMyTurn = false;
    this.hasFlipped = false;  // 本回合是否已翻格子
  }

  // ========== 初始化 ==========

  GuestController.prototype.init = function () {
    this.network = new Network();
    var self = this;

    this.network.onGuestOpen = function () {
      self.myConnId = self.network.peer.id;
    };

    this.network.onGuestClose = function () {
      // 房主断连
      showPage('page-home');
      alert('房主已断开连接');
      self.destroy();
    };

    this.network.onMessage = function (connId, data) {
      self.handleMessage(data);
    };

    this.network.onError = function (err) {
      var errEl = $('#join-error');
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    };
  };

  // ========== 加入房间 ==========

  GuestController.prototype.join = function (roomId, name) {
    this.myName = name;
    this.network.join(roomId, name);
  };

  // ========== 处理房主消息 ==========

  GuestController.prototype.handleMessage = function (data) {
    var MSG = Network.MSG;

    switch (data.type) {
      case MSG.WELCOME:
        this.players = data.players || [];
        showPage('page-guest-wait');
        $('#guest-room-info').textContent = '已加入，房间内有 ' + this.players.length + ' 位玩家';
        break;

      case MSG.PLAYER_JOIN:
        this.players = data.players || [];
        $('#guest-room-info').textContent = '已加入，房间内有 ' + this.players.length + ' 位玩家';
        break;

      case MSG.PLAYER_LEAVE:
        this.players = data.players || [];
        break;

      case MSG.GAME_START:
        this.onGameStart(data);
        break;

      case MSG.REVEALED:
        this.onCellRevealed(data);
        break;

      case MSG.YOUR_TURN:
        this.onMyTurn();
        break;

      case MSG.WAIT_TURN:
        this.onWaitTurn(data);
        break;

      case MSG.GUESS_RECEIVED:
        this.onGuessReceived(data);
        break;

      case MSG.JUDGE_RESULT:
        this.onJudgeResult(data);
        break;

      case MSG.ROUND_END:
        this.onRoundEnd(data);
        break;

      case MSG.REVEAL_ALL:
        this.onRevealAll();
        break;

      case 'next_round':
        this.onNextRound();
        break;

      case MSG.HOST_DISCONNECTED:
        showPage('page-home');
        alert('房主已断开连接');
        this.destroy();
        break;
    }
  };

  // ========== 游戏开始 ==========

  GuestController.prototype.onGameStart = function (data) {
    this.gameState = {
      imageData: data.image,
      gridSize: data.grid,
      revealed: new Array(data.grid * data.grid).fill(false),
      revealedCount: 0,
      totalCells: data.grid * data.grid
    };

    if (data.players) {
      this.players = data.players;
    }

    showPage('page-game');

    var container = $('#grid-container');
    var self = this;

    Game.renderGrid(container, data.image, data.grid, this.gameState.revealed, function (idx) {
      self.onCellClick(idx);
    });

    // 客人控件可见
    $('#guest-controls').classList.remove('hidden');
    $('#host-controls').classList.add('hidden');

    this.updateGameStats();
    this.updatePlayerQueue(-1);
    this.showWaiting();
  };

  // ========== 格子点击 ==========

  GuestController.prototype.onCellClick = function (idx) {
    if (!this.isMyTurn || this.hasFlipped) return;
    if (!this.gameState || this.gameState.revealed[idx]) return;

    this.hasFlipped = true;

    // 发送翻转请求给房主
    this.network.send({
      type: MSG.REVEAL,
      cellIndex: idx
    });
  };

  // ========== 格子被揭示（房主广播） ==========

  GuestController.prototype.onCellRevealed = function (data) {
    if (!this.gameState) return;
    var idx = data.cellIndex;
    this.gameState.revealed[idx] = true;
    this.gameState.revealedCount++;

    Game.flipCell($('#grid-container'), idx);
    this.updateGameStats();
  };

  // ========== 轮到我 ==========

  GuestController.prototype.onMyTurn = function () {
    this.isMyTurn = true;
    this.hasFlipped = false;

    // 步骤1：翻格子
    $('#guest-turn-step1').classList.remove('hidden');
    $('#guest-turn-step2').classList.add('hidden');
    $('#guest-turn-waiting').classList.add('hidden');

    this.updatePlayerQueue(this.myConnId);
  };

  // ========== 等待其他人 ==========

  GuestController.prototype.onWaitTurn = function (data) {
    this.isMyTurn = false;
    this.showWaiting();
    $('#guest-turn-waiting .turn-hint').textContent = data.currentName + ' 正在回答...';
  };

  GuestController.prototype.showWaiting = function () {
    $('#guest-turn-step1').classList.add('hidden');
    $('#guest-turn-step2').classList.add('hidden');
    $('#guest-turn-waiting').classList.remove('hidden');
    $('#guest-turn-waiting .turn-hint').textContent = '等待其他玩家...';
  };

  // ========== 收到揭示后切到猜测步骤 ==========

  // 客人在自己翻完格子后，本地切到 step2
  // 需要在 onMyTurn 后、第一次 onCellRevealed 时自动切换
  GuestController.prototype.onCellRevealed = (function () {
    var original = GuestController.prototype.onCellRevealed;
    return function (data) {
      if (!this.gameState) return;
      var idx = data.cellIndex;
      this.gameState.revealed[idx] = true;
      this.gameState.revealedCount++;

      Game.flipCell($('#grid-container'), idx);
      this.updateGameStats();

      // 如果是我的回合且刚翻完，切到猜测步骤
      if (this.isMyTurn && this.hasFlipped) {
        $('#guest-turn-step1').classList.add('hidden');
        $('#guest-turn-step2').classList.remove('hidden');
        $('#guest-turn-waiting').classList.add('hidden');
        $('#guest-guess-input').value = '';
        $('#guest-guess-input').focus();
      }
    };
  })();

  // ========== 收到别人的猜测 ==========

  GuestController.prototype.onGuessReceived = function (data) {
    // 可以在 UI 上显示 toast
    // 简化处理：暂不显示
  };

  // ========== 判定结果 ==========

  GuestController.prototype.onJudgeResult = function (data) {
    if (data.correct) {
      this.isMyTurn = false;
      this.showWaiting();
    } else {
      if (this.isMyTurn) {
        this.isMyTurn = false;
        this.showWaiting();
        $('#guest-turn-waiting .turn-hint').textContent = '猜测错误，等待下一位...';
      }
    }
    this.updatePlayerQueue(null);
  };

  // ========== 提交猜测 ==========

  GuestController.prototype.submitGuess = function () {
    if (!this.isMyTurn) return;
    var text = $('#guest-guess-input').value.trim();
    if (!text) {
      $('#guest-guess-input').focus();
      return;
    }

    this.network.send({
      type: MSG.GUESS,
      text: text
    });

    // 等待判定
    this.showWaiting();
    $('#guest-turn-waiting .turn-hint').textContent = '已提交猜测，等待房主判定...';
  };

  // ========== 揭示全部 ==========

  GuestController.prototype.onRevealAll = function () {
    if (!this.gameState) return;
    var gs = this.gameState;
    for (var i = 0; i < gs.totalCells; i++) {
      if (!gs.revealed[i]) {
        gs.revealed[i] = true;
        gs.revealedCount++;
        Game.flipCell($('#grid-container'), i);
      }
    }
    this.updateGameStats();
  };

  // ========== 回合结束 ==========

  GuestController.prototype.onRoundEnd = function (data) {
    this.isMyTurn = false;

    var title = data.winner ? data.winner.name + ' 猜对了!' : '没有人猜对';
    $('#round-end-title').textContent = title;
    $('#round-end-image').style.backgroundImage = 'url(' + this.gameState.imageData + ')';
    $('#round-end-answer').textContent = '答案: ' + data.answer;

    var scoreHtml = '<h3>积分榜</h3>';
    var sorted = (data.scores || []).sort(function (a, b) { return b.score - a.score; });
    for (var i = 0; i < sorted.length; i++) {
      var isMe = sorted[i].connId === this.myConnId;
      scoreHtml += '<div class="score-row' + (isMe ? ' me' : '') + '">' +
        '<span class="rank">#' + (i + 1) + '</span>' +
        '<span class="score-name">' + escapeHtml(sorted[i].name) + '</span>' +
        '<span class="score-value">' + sorted[i].score + ' 分</span>' +
        '</div>';
    }
    $('#round-end-scores').innerHTML = scoreHtml;

    // 客人隐藏"下一局"按钮
    $('#btn-next-round').classList.add('hidden');
    $('#modal-round-end').classList.remove('hidden');
  };

  // ========== 下一局 ==========

  GuestController.prototype.onNextRound = function () {
    this.gameState = null;
    showPage('page-guest-wait');
    $('#modal-round-end').classList.add('hidden');
    $('#guest-room-info').textContent = '等待房主开始下一局...';
  };

  // ========== UI 更新 ==========

  GuestController.prototype.updateGameStats = function () {
    if (!this.gameState) return;
    var gs = this.gameState;
    $('#stat-revealed').textContent = gs.revealedCount;
    $('#stat-total').textContent = gs.totalCells;
    var score = Game.calcScore(gs.totalCells, gs.revealedCount);
    $('#stat-score').textContent = score;
  };

  GuestController.prototype.updatePlayerQueue = function (myConnId) {
    if (!this.players.length) return;
    // 找到当前回答者的 index
    var currentIdx = -1;
    if (this.gameState) {
      // 通过判断谁的 turn 来确定
      // 简化：如果 isMyTurn 则 myConnId 对应的是 current
    }
    Game.renderPlayerQueue($('#player-queue'), this.players, currentIdx, myConnId || this.myConnId);
  };

  // ========== 销毁 ==========

  GuestController.prototype.destroy = function () {
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }
    this.gameState = null;
    this.players = [];
  };

  // ========== Helpers ==========

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  global.GuestController = GuestController;

})(window);
