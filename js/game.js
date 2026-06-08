/**
 * game.js — 共享游戏逻辑
 * 网格渲染、翻转动画、示例图片生成
 */
(function (global) {
  'use strict';

  var Game = {};

  /**
   * 压缩图片为 JPEG base64（最大600px）
   */
  Game.compressImage = function (imageData, maxSize, quality) {
    maxSize = maxSize || 600;
    quality = quality || 0.6;
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (w > maxSize || h > maxSize) {
          var scale = maxSize / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = imageData;
    });
  };

  /**
   * 生成示例图片
   */
  Game.generateDemoImage = function () {
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    var ctx = canvas.getContext('2d');

    var palettes = [
      ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'],
      ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7'],
      ['#fa709a', '#fee140'], ['#a18cd1', '#fbc2eb'],
      ['#fccb90', '#d57eeb'], ['#e0c3fc', '#8ec5fc']
    ];
    var pal = palettes[Math.floor(Math.random() * palettes.length)];
    var grad = ctx.createLinearGradient(0, 0, 600, 600);
    grad.addColorStop(0, pal[0]);
    grad.addColorStop(1, pal[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 600, 600);

    var shapes = Math.floor(Math.random() * 5) + 3;
    for (var i = 0; i < shapes; i++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.3 + 0.1) + ')';
      ctx.beginPath();
      var type = Math.floor(Math.random() * 3);
      if (type === 0) {
        ctx.arc(Math.random() * 600, Math.random() * 600, Math.random() * 120 + 40, 0, Math.PI * 2);
      } else if (type === 1) {
        ctx.rect(Math.random() * 400, Math.random() * 400, Math.random() * 200 + 80, Math.random() * 200 + 80);
      } else {
        var cx = Math.random() * 600, cy = Math.random() * 600, s = Math.random() * 120 + 60;
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx - s, cy + s);
        ctx.lineTo(cx + s, cy + s);
        ctx.closePath();
      }
      ctx.fill();
    }

    var texts = ['HELLO', 'WOW', 'COOL', 'NICE', 'GREAT', 'SUPER', 'STAR', 'LUCKY'];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texts[Math.floor(Math.random() * texts.length)], 300, 300);

    return canvas.toDataURL('image/jpeg', 0.85);
  };

  /**
   * 渲染网格到指定容器
   * @param {HTMLElement} container - 网格容器
   * @param {string} imageData - base64 图片
   * @param {number} gridSize - N×N
   * @param {boolean[]} revealed - 初始揭示状态
   * @param {function} onCellClick - 点击回调(index)，可选（null=只读）
   */
  Game.renderGrid = function (container, imageData, gridSize, revealed, onCellClick) {
    container.innerHTML = '';

    var maxSize = Math.min(
      window.innerWidth - (window.innerWidth > 768 ? 340 : 40),
      window.innerHeight - (window.innerWidth > 768 ? 40 : 360),
      560
    );
    var safeSize = Math.max(200, maxSize);
    container.style.width = safeSize + 'px';
    container.style.height = safeSize + 'px';
    container.style.gridTemplateColumns = 'repeat(' + gridSize + ', 1fr)';
    container.style.gridTemplateRows = 'repeat(' + gridSize + ', 1fr)';

    var totalCells = gridSize * gridSize;
    var img = new Image();
    img.onload = function () {
      var imgW = img.naturalWidth;
      var imgH = img.naturalHeight;
      var bgSizeX = gridSize * 100;
      var bgSizeY = gridSize * 100;

      for (var row = 0; row < gridSize; row++) {
        for (var col = 0; col < gridSize; col++) {
          var idx = row * gridSize + col;
          var bgX = gridSize > 1 ? (col / (gridSize - 1)) * 100 : 50;
          var bgY = gridSize > 1 ? (row / (gridSize - 1)) * 100 : 50;

          var cell = document.createElement('div');
          cell.className = 'cell';
          cell.dataset.index = idx;

          var inner = document.createElement('div');
          inner.className = 'cell-inner';

          var front = document.createElement('div');
          front.className = 'cell-front';

          var back = document.createElement('div');
          back.className = 'cell-back';
          back.style.backgroundImage = 'url(' + imageData + ')';

          if (gridSize === 1) {
            back.style.backgroundSize = '100% 100%';
            back.style.backgroundPosition = '50% 50%';
          } else {
            back.style.backgroundSize = bgSizeX + '% ' + bgSizeY + '%';
            back.style.backgroundPosition = bgX + '% ' + bgY + '%';
          }

          inner.appendChild(front);
          inner.appendChild(back);
          cell.appendChild(inner);

          if (revealed && revealed[idx]) {
            cell.classList.add('flipped');
          }

          if (onCellClick) {
            cell.addEventListener('click', function (e) {
              var i = parseInt(this.dataset.index, 10);
              onCellClick(i);
            });
          }

          container.appendChild(cell);
        }
      }
    };
    img.src = imageData;
  };

  /**
   * 翻转指定格子（动画）
   */
  Game.flipCell = function (container, index) {
    var cell = container.children[index];
    if (cell && !cell.classList.contains('flipped')) {
      cell.classList.add('flipped');
    }
  };

  /**
   * 重置所有格子为遮盖
   */
  Game.resetCells = function (container) {
    var cells = container.querySelectorAll('.cell');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('flipped');
    }
  };

  /**
   * 渲染玩家队列
   */
  Game.renderPlayerQueue = function (container, players, currentIdx, myConnId) {
    container.innerHTML = '';
    var list = document.createElement('div');
    list.className = 'queue-list';

    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var item = document.createElement('div');
      item.className = 'queue-item';

      if (i === currentIdx) {
        item.classList.add('current');
      } else if (p.eliminated) {
        item.classList.add('eliminated');
      }

      var nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = p.name;

      if (p.connId === myConnId) {
        var badge = document.createElement('span');
        badge.className = 'me-badge';
        badge.textContent = '你';
        nameSpan.appendChild(badge);
      }

      var statusSpan = document.createElement('span');
      statusSpan.className = 'player-status';
      if (i === currentIdx) {
        statusSpan.textContent = '回答中...';
      } else if (p.eliminated) {
        statusSpan.textContent = '已猜错';
      } else {
        statusSpan.textContent = '等待';
      }

      item.appendChild(nameSpan);
      item.appendChild(statusSpan);
      list.appendChild(item);
    }

    container.appendChild(list);
  };

  /**
   * 计算得分
   */
  Game.calcScore = function (totalCells, revealedCount) {
    return Math.max(0, (totalCells - revealedCount) * 10);
  };

  global.Game = Game;

})(window);
