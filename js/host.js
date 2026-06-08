/**
 * host.js — 房主逻辑
 * 房间创建、玩家管理、游戏状态机、判定流程
 */
(function (global) {
  'use strict';

  var MSG = Network.MSG;
  var $ = function (sel) { return document.querySelector(sel); };

  function HostController() {
    this.network = null;
    this.players = [];       // { connId, name, score, eliminated }
    this.gameState = null;   // null | { imageData, gridSize, revealed, revealedCount, currentIdx, answer }
    this.role = 'host';
  }

  // ========== 初始化 ==========

  HostController.prototype.init = function () {
    var self = this;

    this.network = new Network();

    this.network.onHostOpen = function (peerId) {
      var shortId = peerId.replace('gridgame-', '');
      $('#room-id-text').textContent = shortId;
      showPage('page-host-lobby');
    };

    this.network.onPeerJoin = function (connId) {
      // 等客人发 JOIN 消息
    };

    this.network.onPeerLeave = function (connId) {
      self.removePlayer(connId);
      self.updateLobbyUI();
      // 如果游戏中有人断线
      if (self.gameState) {
        self.handleDisconnect(connId);
      }
    };

    this.network.onMessage = function (connId, data) {
      self.handleMessage(connId, data);
    };

    this.network.onError = function (err) {
      alert('连接错误: ' + err.message);
    };

    // 实际启动 Peer 连接
    this.network.host();
  };

  // ========== 玩家管理 ==========

  HostController.prototype.addPlayer = function (connId, name) {
    // 检查重名
    for (var i = 0; i < this.players.length; i++) {
      if (this.players[i].connId === connId) return;
    }
    this.players.push({
      connId: connId,
      name: name,
      score: 0,
      eliminated: false
    });
    this.updateLobbyUI();

    // 广播新玩家加入
    this.network.broadcast({
      type: MSG.PLAYER_JOIN,
      players: this.getPlayerNames()
    });

    // 发送欢迎消息给新玩家
    this.network.sendTo(connId, {
      type: MSG.WELCOME,
      players: this.getPlayerNames()
    });
  };

  HostController.prototype.removePlayer = function (connId) {
    for (var i = 0; i < this.players.length; i++) {
      if (this.players[i].connId === connId) {
        this.players.splice(i, 1);
        break;
      }
    }
    this.network.broadcast({
      type: MSG.PLAYER_LEAVE,
      players: this.getPlayerNames()
    });
  };

  HostController.prototype.getPlayerNames = function () {
    return this.players.map(function (p) {
      return {
        name: p.name,
        connId: p.connId,
        score: p.score,
        wrongCount: p.wrongCount || 0
      };
    });
  };

  HostController.prototype.updateLobbyUI = function () {
    var list = $('#host-player-list');
    list.innerHTML = '';
    for (var i = 0; i < this.players.length; i++) {
      var div = document.createElement('div');
      div.className = 'player-item';
      div.innerHTML = '<span class="player-name">' + escapeHtml(this.players[i].name) + '</span>';
      list.appendChild(div);
    }
    $('#btn-start-game').disabled = this.players.length === 0;
  };

  // ========== 开始游戏 ==========

  HostController.prototype.startGame = function (imageData, gridSize, answer) {
    var self = this;
    var totalCells = gridSize * gridSize;

    // 重置玩家状态
    for (var i = 0; i < this.players.length; i++) {
      this.players[i].eliminated = false;
      this.players[i].wrongCount = 0;
    }

    this.gameState = {
      imageData: imageData,
      gridSize: gridSize,
      revealed: new Array(totalCells).fill(false),
      revealedCount: 0,
      currentIdx: 0,
      answer: answer,
      totalCells: totalCells,
      phase: 'reveal'  // reveal -> guess -> judge
    };

    // 压缩图片后广播
    Game.compressImage(imageData, 600, 0.6).then(function (compressed) {
      self.network.broadcast({
        type: MSG.GAME_START,
        image: compressed,
        grid: gridSize,
        players: self.getPlayerNames(),
        currentIdx: 0
      });

      // 房主自己也渲染
      showPage('page-game');
      self.renderHostGame();
      self.notifyTurn();
    });
  };

  // ========== 渲染房主游戏界面 ==========

  HostController.prototype.renderHostGame = function () {
    var gs = this.gameState;
    var container = $('#grid-container');

    // 房主的网格是只读的
    Game.renderGrid(container, gs.imageData, gs.gridSize, gs.revealed, null);

    $('#host-controls').classList.remove('hidden');
    $('#guest-controls').classList.add('hidden');

    this.updateGameStats();
    this.updatePlayerQueue();
  };

  HostController.prototype.updateGameStats = function () {
    var gs = this.gameState;
    if (!gs) return;
    var elR = $('#stat-revealed');
    var elT = $('#stat-total');
    var elS = $('#stat-score');
    if (elR) elR.textContent = gs.revealedCount;
    if (elT) elT.textContent = gs.totalCells;
    if (elS) elS.textContent = Game.calcScore(gs.totalCells, gs.revealedCount);
  };

  HostController.prototype.updatePlayerQueue = function () {
    var gs = this.gameState;
    if (!gs) return;
    Game.renderPlayerQueue($('#player-queue'), this.players, gs.currentIdx, null);
  };

  // ========== 回合通知 ==========

  HostController.prototype.notifyTurn = function () {
    var gs = this.gameState;
    if (!gs) return;
    if (this.players.length === 0) return;

    // 循环：currentIdx 始终在 [0, players.length) 内
    gs.currentIdx = gs.currentIdx % this.players.length;

    var current = this.players[gs.currentIdx];

    // 通知当前客人轮到他
    this.network.sendTo(current.connId, {
      type: MSG.YOUR_TURN,
      revealedCount: gs.revealedCount
    });

    // 通知其他人等待
    for (var i = 0; i < this.players.length; i++) {
      if (i !== gs.currentIdx) {
        this.network.sendTo(this.players[i].connId, {
          type: MSG.WAIT_TURN,
          currentName: current.name
        });
      }
    }

    // 房主UI：等待客人操作
    gs.phase = 'reveal';
    this.updatePlayerQueue();

    $('#host-guess-display').classList.add('hidden');
    $('#host-judge-btns').classList.add('hidden');
  };

  // ========== 处理消息 ==========

  HostController.prototype.handleMessage = function (connId, data) {
    var gs = this.gameState;
    var MSG = Network.MSG;

    switch (data.type) {
      case MSG.JOIN:
        this.addPlayer(connId, data.name);
        break;

      case MSG.REVEAL:
        if (!gs || gs.phase !== 'reveal') return;
        var idx = data.cellIndex;
        if (gs.revealed[idx]) return;

        // 验证是当前回答者
        var current = this.players[gs.currentIdx];
        if (!current || current.connId !== connId) return;

        gs.revealed[idx] = true;
        gs.revealedCount++;
        gs.phase = 'guess';

        // 广播揭示
        this.network.broadcast({
          type: MSG.REVEALED,
          cellIndex: idx,
          byName: current.name
        });

        // 房主也翻转
        Game.flipCell($('#grid-container'), idx);
        this.updateGameStats();

        // 所有格子翻完 → 自动结束
        if (gs.revealedCount >= gs.totalCells) {
          this.endRound(null);
          return;
        }

        // 切到猜测阶段
        this.updatePlayerQueue();
        break;

      case MSG.GUESS:
        if (!gs || gs.phase !== 'guess') return;

        var cur = this.players[gs.currentIdx];
        if (!cur || cur.connId !== connId) return;

        var guessText = data.text;

        // 广播猜测内容
        this.network.broadcast({
          type: MSG.GUESS_RECEIVED,
          playerName: cur.name,
          text: guessText
        });

        // 房主显示猜测 + 判定按钮
        gs.phase = 'judge';
        $('#host-guess-display').classList.remove('hidden');
        $('#host-guess-text').textContent = guessText;
        $('#host-judge-btns').classList.remove('hidden');
        this.updatePlayerQueue();
        break;
    }
  };

  // ========== 房主判定 ==========

  HostController.prototype.judge = function (correct) {
    var gs = this.gameState;
    if (!gs || gs.phase !== 'judge') return;

    var current = this.players[gs.currentIdx];

    if (correct) {
      // 猜对了，该玩家得分
      var score = Game.calcScore(gs.totalCells, gs.revealedCount);
      current.score += score;

      this.network.broadcast({
        type: MSG.JUDGE_RESULT,
        playerName: current.name,
        correct: true,
        score: score,
        players: this.getPlayerNames()
      });

      this.endRound(current);
    } else {
      // 猜错了 — 累计猜错次数，循环到下一个玩家
      current.wrongCount = (current.wrongCount || 0) + 1;

      this.network.broadcast({
        type: MSG.JUDGE_RESULT,
        playerName: current.name,
        correct: false,
        players: this.getPlayerNames(),
        nextIdx: (gs.currentIdx + 1) % this.players.length
      });

      // 循环到下一个玩家
      gs.currentIdx = (gs.currentIdx + 1) % this.players.length;
      gs.phase = 'reveal';

      $('#host-guess-display').classList.add('hidden');
      $('#host-judge-btns').classList.add('hidden');

      this.notifyTurn();
    }
  };

  // ========== 揭示全部 ==========

  HostController.prototype.revealAll = function () {
    var gs = this.gameState;
    if (!gs) return;

    for (var i = 0; i < gs.totalCells; i++) {
      if (!gs.revealed[i]) {
        gs.revealed[i] = true;
        gs.revealedCount++;
        Game.flipCell($('#grid-container'), i);
      }
    }

    this.network.broadcast({ type: MSG.REVEAL_ALL });
    this.updateGameStats();
    this.endRound(null);
  };

  // ========== 结束回合 ==========

  HostController.prototype.endRound = function (winner) {
    var gs = this.gameState;

    // 广播结束
    this.network.broadcast({
      type: MSG.ROUND_END,
      winner: winner ? { name: winner.name, score: winner.score } : null,
      answer: gs.answer,
      scores: this.getPlayerNames()
    });

    // 房主显示结果
    var title = winner ? winner.name + ' 猜对了!' : '没有人猜对';
    $('#round-end-title').textContent = title;
    $('#round-end-image').style.backgroundImage = 'url(' + gs.imageData + ')';
    $('#round-end-answer').textContent = '答案: ' + gs.answer;

    var scoreHtml = '<h3>积分榜</h3>';
    var sorted = this.players.slice().sort(function (a, b) { return b.score - a.score; });
    for (var i = 0; i < sorted.length; i++) {
      scoreHtml += '<div class="score-row">' +
        '<span class="rank">#' + (i + 1) + '</span>' +
        '<span class="score-name">' + escapeHtml(sorted[i].name) + '</span>' +
        '<span class="score-value">' + sorted[i].score + ' 分</span>' +
        '</div>';
    }
    $('#round-end-scores').innerHTML = scoreHtml;

    // 房主可以看到"下一局"按钮
    $('#btn-next-round').classList.remove('hidden');
    $('#modal-round-end').classList.remove('hidden');

    this.gameState = null;
  };

  // ========== 下一局 ==========

  HostController.prototype.nextRound = function () {
    $('#modal-round-end').classList.add('hidden');
    // 回到房主设置页
    this.network.broadcast({ type: 'next_round' });
    showPage('page-host-setup');
  };

  // ========== 掉线处理 ==========

  HostController.prototype.handleDisconnect = function (connId) {
    var gs = this.gameState;
    if (!gs) return;

    var idx = -1;
    for (var i = 0; i < this.players.length; i++) {
      if (this.players[i].connId === connId) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    // 如果是当前回答者掉线
    if (idx === gs.currentIdx) {
      this.players.splice(idx, 1);
      // 不改变 currentIdx，因为数组已经缩短
      if (gs.phase === 'judge' || gs.phase === 'guess') {
        gs.phase = 'reveal';
        this.notifyTurn();
      }
    }
  };

  // ========== 销毁 ==========

  HostController.prototype.destroy = function () {
    if (this.network) {
      this.network.destroy();
      this.network = null;
    }
    this.players = [];
    this.gameState = null;
  };

  // ========== Helpers ==========

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  global.HostController = HostController;

})(window);
