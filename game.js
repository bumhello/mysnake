/* =========================================================
   Змейка — Telegram Mini App
   Canvas 2D, управление свайпами, эффекты (частицы, свечение,
   тряска экрана). Без сохранения рекордов.
   ========================================================= */

(() => {
  "use strict";

  // ---------- Telegram WebApp (опционально) ----------
  // Скрипт telegram.org подключён с async — он может загрузиться ПОСЛЕ game.js
  // (или не загрузиться, если сеть его блокирует). Поэтому берём WebApp лениво.
  const getTg = () =>
    window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  let tgReady = false;
  function initTelegram() {
    const tg = getTg();
    if (!tg || tgReady) return;
    tgReady = true;
    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#0b1020");
      tg.setBackgroundColor("#0b1020");
    } catch (_) { /* игнорируем ошибки интеграции */ }
  }

  const haptic = (type) => {
    const tg = getTg();
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (type === "impact") tg.HapticFeedback.impactOccurred("light");
      else if (type === "success") tg.HapticFeedback.notificationOccurred("success");
      else if (type === "error") tg.HapticFeedback.notificationOccurred("error");
    } catch (_) { /* noop */ }
  };

  // ---------- Конфигурация ----------
  const CONFIG = {
    cols: 20,              // клеток по горизонтали
    rows: 24,              // клеток по вертикали
    startLength: 3,        // начальная длина змейки
    baseInterval: 150,     // базовый интервал шага, мс
    minInterval: 70,       // минимальный интервал (макс. скорость)
    speedUpPerFood: 4,     // на сколько мс ускоряться за каждую еду
    turnQueueMax: 3,       // макс. очередь поворотов
    swipeThreshold: 18,    // минимальный свайп, px
    particlesMax: 220,
  };

  // ---------- DOM ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const speedEl = document.getElementById("speed");
  const overlay = document.getElementById("overlay");
  const overlayIcon = document.getElementById("overlayIcon");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayHint = document.getElementById("overlayHint");

  // ---------- Состояние игры ----------
  const DIR = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const STATE = { MENU: 0, PLAYING: 1, PAUSED: 2, DEAD: 3 };

  let state = STATE.MENU;
  let snake = [];              // [{x, y}, ...] head first
  let dir = DIR.right;
  const turnQueue = [];
  let food = null;
  let score = 0;
  let stepInterval = CONFIG.baseInterval;
  let lastStep = 0;
  let cell = 24;               // размер клетки в px
  let dpr = 1;

  // Эффекты
  const particles = [];
  let shake = 0;               // тряска, мс
  let flash = 0;               // вспышка при смерти
  let glowPulse = 0;           // пульсация еды

  // ---------- Размеры канваса ----------
  function resize() {
    const stage = canvas.parentElement;
    const availW = stage.clientWidth - 20;
    const availH = stage.clientHeight - 20;
    const byW = availW / CONFIG.cols;
    const byH = availH / CONFIG.rows;
    cell = Math.floor(Math.min(byW, byH));

    const cssW = cell * CONFIG.cols;
    const cssH = cell * CONFIG.rows;
    dpr = Math.min(window.devicePixelRatio || 1, 3);

    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------- Игровая логика ----------
  function resetGame() {
    const cx = Math.floor(CONFIG.cols / 2);
    const cy = Math.floor(CONFIG.rows / 2);
    snake = [];
    for (let i = 0; i < CONFIG.startLength; i++) {
      snake.push({ x: cx - i, y: cy });
    }
    dir = DIR.right;
    turnQueue.length = 0;
    score = 0;
    stepInterval = CONFIG.baseInterval;
    particles.length = 0;
    shake = 0;
    flash = 0;
    spawnFood();
    updateHUD();
  }

  function spawnFood() {
    const free = [];
    for (let y = 0; y < CONFIG.rows; y++) {
      for (let x = 0; x < CONFIG.cols; x++) {
        if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
      }
    }
    food = free.length ? free[(Math.random() * free.length) | 0] : null;
    if (!food) winGame();
  }

  function queueTurn(nextDir) {
    if (state !== STATE.PLAYING) return;
    const last = turnQueue.length ? turnQueue[turnQueue.length - 1] : dir;
    // запрет разворота на 180°
    if (last.x + nextDir.x === 0 && last.y + nextDir.y === 0) return;
    if (last.x === nextDir.x && last.y === nextDir.y) return;
    if (turnQueue.length < CONFIG.turnQueueMax) turnQueue.push(nextDir);
  }

  function step() {
    if (turnQueue.length) dir = turnQueue.shift();

    const head = snake[0];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    // столкновения
    const hitWall =
      next.x < 0 || next.y < 0 || next.x >= CONFIG.cols || next.y >= CONFIG.rows;
    const hitSelf = snake.some((s, i) => i < snake.length - 1 && s.x === next.x && s.y === next.y);

    if (hitWall || hitSelf) {
      die();
      return;
    }

    snake.unshift(next);

    if (food && next.x === food.x && next.y === food.y) {
      score += 10;
      stepInterval = Math.max(CONFIG.minInterval, stepInterval - CONFIG.speedUpPerFood);
      burst(
        food.x * cell + cell / 2,
        food.y * cell + cell / 2,
        ["#4ade80", "#22d3ee", "#facc15"],
        16
      );
      haptic("success");
      spawnFood();
      updateHUD();
    } else {
      snake.pop();
    }
  }

  function die() {
    state = STATE.DEAD;
    shake = 420;
    flash = 320;
    const head = snake[0];
    burst(
      head.x * cell + cell / 2,
      head.y * cell + cell / 2,
      ["#f87171", "#fb923c", "#facc15"],
      34
    );
    haptic("error");
    showOverlay("💀", "Игра окончена", `Очки: ${score}`, "Свайпните, чтобы сыграть ещё");
  }

  function winGame() {
    state = STATE.DEAD;
    flash = 300;
    haptic("success");
    showOverlay("🏆", "Победа!", `Вы заполнили всё поле: ${score}`, "Свайпните, чтобы сыграть ещё");
  }

  function startGame() {
    resetGame();
    state = STATE.PLAYING;
    lastStep = performance.now();
    hideOverlay();
  }

  function resumeGame() {
    state = STATE.PLAYING;
    lastStep = performance.now();
    hideOverlay();
  }

  // ---------- Эффекты ----------
  function burst(x, y, colors, count) {
    for (let i = 0; i < count && particles.length < CONFIG.particlesMax; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 1.4 + Math.random() * 1.6,
        size: 2 + Math.random() * 4,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * (dt / 1000);
      p.y += p.vy * (dt / 1000);
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= p.decay * (dt / 1000);
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (flash > 0) flash = Math.max(0, flash - dt);
    glowPulse += dt / 300;
  }

  // ---------- Отрисовка ----------
  function draw() {
    const W = CONFIG.cols * cell;
    const H = CONFIG.rows * cell;

    ctx.save();

    // тряска экрана
    if (shake > 0) {
      const amp = (shake / 420) * 7;
      ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    // фон: шахматная сетка
    ctx.fillStyle = "#0e1428";
    ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.fillStyle = "rgba(255,255,255,0.022)";
    for (let y = 0; y < CONFIG.rows; y++) {
      for (let x = (y % 2); x < CONFIG.cols; x += 2) {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // рамка поля
    ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // еда со свечением
    if (food) {
      const fx = food.x * cell + cell / 2;
      const fy = food.y * cell + cell / 2;
      const pulse = 1 + Math.sin(glowPulse) * 0.18;
      const r = (cell * 0.34) * pulse;

      const glow = ctx.createRadialGradient(fx, fy, 1, fx, fy, cell * 1.4);
      glow.addColorStop(0, "rgba(250, 204, 21, 0.55)");
      glow.addColorStop(1, "rgba(250, 204, 21, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(fx - cell * 1.4, fy - cell * 1.4, cell * 2.8, cell * 2.8);

      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(fx - r * 0.3, fy - r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    // змейка
    const n = snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const seg = snake[i];
      const t = i / Math.max(1, n - 1);
      const px = seg.x * cell;
      const py = seg.y * cell;
      const inset = 1.5 + t * 2;
      const radius = i === 0 ? cell * 0.32 : cell * 0.24;

      // цвет от головы (ярко-зелёный) к хвосту (бирюзовый)
      const g = Math.round(222 - t * 60);
      const b = Math.round(128 + t * 80);
      const bodyColor = `rgb(74, ${g}, ${b})`;

      ctx.shadowColor = i === 0 ? "rgba(74,222,128,0.9)" : "rgba(34,211,238,0.35)";
      ctx.shadowBlur = i === 0 ? 14 : 6;

      ctx.fillStyle = bodyColor;
      roundRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2, radius);
      ctx.fill();
      ctx.shadowBlur = 0;

      // глаза на голове
      if (i === 0) drawEyes(px, py);
    }

    // частицы
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // вспышка при смерти
    if (flash > 0) {
      ctx.fillStyle = `rgba(248, 113, 113, ${(flash / 320) * 0.45})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }

    ctx.restore();
  }

  function drawEyes(px, py) {
    // направление взгляда
    const cx = px + cell / 2;
    const cy = py + cell / 2;
    const off = cell * 0.2;
    const lookX = dir.x * cell * 0.08;
    const lookY = dir.y * cell * 0.08;

    const e1 = { x: cx + (dir.y !== 0 ? -off : 0) + lookX, y: cy + (dir.x !== 0 ? -off : 0) + lookY };
    const e2 = { x: cx + (dir.y !== 0 ? off : 0) + lookX, y: cy + (dir.x !== 0 ? off : 0) + lookY };

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(e1.x, e1.y, cell * 0.11, 0, Math.PI * 2);
    ctx.arc(e2.x, e2.y, cell * 0.11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0b1020";
    ctx.beginPath();
    ctx.arc(e1.x + lookX, e1.y + lookY, cell * 0.055, 0, Math.PI * 2);
    ctx.arc(e2.x + lookX, e2.y + lookY, cell * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Главный цикл ----------
  let lastFrame = performance.now();

  function loop(now) {
    const dt = Math.min(64, now - lastFrame);
    lastFrame = now;

    if (state === STATE.PLAYING) {
      if (now - lastStep >= stepInterval) {
        lastStep = now;
        step();
      }
    }

    updateEffects(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function updateHUD() {
    scoreEl.textContent = String(score);
    const lvl = Math.max(1, Math.round((CONFIG.baseInterval - stepInterval) / CONFIG.speedUpPerFood) + 1);
    speedEl.textContent = String(lvl);
  }

  // ---------- Оверлеи ----------
  function showOverlay(icon, title, text, hint) {
    overlayIcon.textContent = icon;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayHint.textContent = hint;
    overlay.classList.add("overlay--visible");
  }

  function hideOverlay() {
    overlay.classList.remove("overlay--visible");
  }

  // ---------- Управление: свайпы ----------
  let touchStart = null;

  function getTouchPoint(e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function onStart(e) {
    touchStart = getTouchPoint(e);
  }

  function onEnd(e) {
    if (!touchStart) return;
    const end = getTouchPoint(e);
    const dx = end.x - touchStart.x;
    const dy = end.y - touchStart.y;
    touchStart = null;

    if (Math.abs(dx) < CONFIG.swipeThreshold && Math.abs(dy) < CONFIG.swipeThreshold) {
      // тап: старт/рестарт/продолжение
      if (state === STATE.MENU || state === STATE.DEAD) startGame();
      else if (state === STATE.PAUSED) resumeGame();
      return;
    }

    if (state === STATE.MENU || state === STATE.DEAD) {
      startGame();
      return;
    }

    if (state === STATE.PAUSED) {
      resumeGame();
      return;
    }

    if (state === STATE.PLAYING) {
      if (Math.abs(dx) > Math.abs(dy)) {
        queueTurn(dx > 0 ? DIR.right : DIR.left);
      } else {
        queueTurn(dy > 0 ? DIR.down : DIR.up);
      }
    }
  }

  // touch-события (мобильные)
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });

  // мышь как "свайп" (для десктопа/превью)
  document.addEventListener("mousedown", onStart);
  document.addEventListener("mouseup", onEnd);

  // защита от контекстного меню и выделения
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dragstart", (e) => e.preventDefault());

  // пауза при сворачивании вкладки
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === STATE.PLAYING) {
      state = STATE.PAUSED;
      showOverlay("⏸", "Пауза", "Игра приостановлена", "Свайпните, чтобы продолжить");
    }
  });

  // ---------- Запуск ----------
  initTelegram();
  // Telegram-скрипт грузится async — если он пришёл позже, дождёмся события load
  window.addEventListener("load", initTelegram);
  // и подстрахуемся парой коротких проверок (на случай кэша/быстрой загрузки)
  setTimeout(initTelegram, 0);
  setTimeout(initTelegram, 500);

  resize();
  resetGame();
  showOverlay("🐍", "Змейка", "Свайпните по экрану, чтобы начать", "Ешьте еду, расти, не врезайтесь!");
  requestAnimationFrame(loop);
})();
