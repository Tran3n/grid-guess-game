/**
 * network.js — PeerJS 网络封装层
 * 提供房主创建房间、客人加入房间、消息收发、连接管理
 */
(function (global) {
  'use strict';

  var MSG_TYPES = {
    // 客人 → 房主
    JOIN: 'join',
    READY: 'ready',
    REVEAL: 'reveal',
    GUESS: 'guess',

    // 房主 → 客人
    WELCOME: 'welcome',
    PLAYER_JOIN: 'player_join',
    PLAYER_LEAVE: 'player_leave',
    GAME_START: 'game_start',
    REVEALED: 'revealed',
    YOUR_TURN: 'your_turn',
    WAIT_TURN: 'wait_turn',
    GUESS_RECEIVED: 'guess_received',
    JUDGE_RESULT: 'judge_result',
    ROUND_END: 'round_end',
    REVEAL_ALL: 'reveal_all',
    HOST_DISCONNECTED: 'host_disconnected',
    ERROR: 'error'
  };

  /**
   * Network 类
   */
  function Network() {
    this.peer = null;
    this.conns = {};     // connId -> DataConnection
    this.hostConn = null; // 客人端：与房主的连接
    this.role = null;     // 'host' | 'guest'
    this.onMessage = null;      // function(connId, data)
    this.onHostOpen = null;     // function(peerId)
    this.onGuestOpen = null;    // function()
    this.onGuestClose = null;   // function()
    this.onPeerJoin = null;     // function(connId)
    this.onPeerLeave = null;    // function(connId)
    this.onError = null;        // function(err)
  }

  /**
   * 房主：创建房间
   */
  Network.prototype.host = function () {
    var self = this;
    this.role = 'host';

    console.log('[Network] Starting host, checking PeerJS availability...');
    if (typeof Peer === 'undefined') {
      console.error('[Network] Peer is undefined! PeerJS library not loaded.');
      if (self.onError) self.onError(new Error('PeerJS 库未加载'));
      return;
    }
    console.log('[Network] Peer is available:', typeof Peer);

    // 生成6位短ID
    var shortId = generateShortId();
    var fullId = 'gridgame-' + shortId;
    console.log('[Network] Creating peer with id:', fullId);

    this.peer = new Peer(fullId, {
      debug: 2
    });

    console.log('[Network] Peer created, waiting for open event...');

    this.peer.on('open', function (id) {
      console.log('[Network] OPEN event fired, id:', id);
      if (self.onHostOpen) self.onHostOpen(id);
    });

    this.peer.on('connection', function (conn) {
      conn.on('open', function () {
        self.conns[conn.peer] = conn;
        if (self.onPeerJoin) self.onPeerJoin(conn.peer);
      });

      conn.on('data', function (data) {
        if (self.onMessage) self.onMessage(conn.peer, data);
      });

      conn.on('close', function () {
        delete self.conns[conn.peer];
        if (self.onPeerLeave) self.onPeerLeave(conn.peer);
      });

      conn.on('error', function () {
        delete self.conns[conn.peer];
        if (self.onPeerLeave) self.onPeerLeave(conn.peer);
      });
    });

    this.peer.on('error', function (err) {
      console.error('[Network] host error:', err.type, err.message || err);
      if (err.type === 'unavailable-id') {
        // ID 冲突，重试
        self.destroy();
        self.host();
        return;
      }
      if (self.onError) self.onError(err);
    });

    this.peer.on('disconnected', function () {
      console.warn('[Network] host disconnected from signaling server');
    });

    this.peer.on('close', function () {
      console.log('[Network] host peer closed');
    });
  };

  /**
   * 客人：加入房间
   */
  Network.prototype.join = function (roomId, playerName) {
    var self = this;
    this.role = 'guest';

    this.peer = new Peer(undefined, { debug: 1 });

    this.peer.on('open', function () {
      var targetId = 'gridgame-' + roomId;
      var conn = self.peer.connect(targetId, { reliable: true });

      conn.on('open', function () {
        self.hostConn = conn;
        conn.send({ type: MSG_TYPES.JOIN, name: playerName });
        if (self.onGuestOpen) self.onGuestOpen();
      });

      conn.on('data', function (data) {
        if (self.onMessage) self.onMessage(null, data);
      });

      conn.on('close', function () {
        self.hostConn = null;
        if (self.onGuestClose) self.onGuestClose();
      });

      conn.on('error', function () {
        self.hostConn = null;
        if (self.onError) self.onError(new Error('Connection error'));
      });
    });

    this.peer.on('error', function (err) {
      if (err.type === 'peer-unavailable') {
        if (self.onError) self.onError(new Error('找不到该房间，请检查房间号'));
      } else {
        if (self.onError) self.onError(err);
      }
    });
  };

  /**
   * 房主：广播给所有客人
   */
  Network.prototype.broadcast = function (data) {
    var keys = Object.keys(this.conns);
    for (var i = 0; i < keys.length; i++) {
      this.conns[keys[i]].send(data);
    }
  };

  /**
   * 房主：发给指定客人
   */
  Network.prototype.sendTo = function (connId, data) {
    var conn = this.conns[connId];
    if (conn) conn.send(data);
  };

  /**
   * 客人：发给房主
   */
  Network.prototype.send = function (data) {
    if (this.hostConn) this.hostConn.send(data);
  };

  /**
   * 获取连接数（房主用）
   */
  Network.prototype.getConnCount = function () {
    return Object.keys(this.conns).length;
  };

  /**
   * 销毁连接
   */
  Network.prototype.destroy = function () {
    var keys = Object.keys(this.conns);
    for (var i = 0; i < keys.length; i++) {
      this.conns[keys[i]].close();
    }
    this.conns = {};
    if (this.hostConn) {
      this.hostConn.close();
      this.hostConn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.role = null;
  };

  /**
   * 获取短房间号（从 peer id 提取）
   */
  Network.prototype.getShortId = function () {
    if (this.peer && this.peer.id) {
      return this.peer.id.replace('gridgame-', '');
    }
    return '';
  };

  /**
   * 生成6位短ID（字母+数字）
   */
  function generateShortId() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var id = '';
    for (var i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  // 导出
  Network.MSG = MSG_TYPES;
  global.Network = Network;

})(window);
