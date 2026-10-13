import { useRef, useEffect } from 'react';

const FALLOFF_CURVES = {
  linear: t => t,
  smooth: t => t * t * (3 - 2 * t),
  sharp: t => t * t * t
};

const hexToRgb = hex => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(v.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

const CursorGrid = ({
  cellSize = 70,
  color = '#ffffff',
  radius = 140,
  falloff = 'smooth',
  holdTime = 400,
  fadeDuration = 800,
  lineWidth = 1.2,
  maxOpacity = 1,
  fillOpacity = 0,
  gridOpacity = 0,
  cellRadius = 0,
  clickPulse = true,
  pulseSpeed = 600,
  className = ''
}) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const propsRef = useRef({});
  propsRef.current = { cellSize, color, radius, falloff, holdTime, fadeDuration, lineWidth, maxOpacity, fillOpacity, gridOpacity, cellRadius, clickPulse, pulseSpeed };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let cols = 0, rows = 0, offX = 0, offY = 0, w = 0, h = 0;
    let alphas = new Float32Array(0), touched = new Float64Array(0);
    const pulses = [];
    let raf = 0, running = false, lastFrame = 0;

    const rebuild = (sizeHint) => {
      const p = propsRef.current;
      w = (sizeHint && sizeHint.w) || container.offsetWidth || container.getBoundingClientRect().width;
      h = (sizeHint && sizeHint.h) || container.offsetHeight || container.getBoundingClientRect().height;
      if (!w || !h) return false;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / p.cellSize) + 1;
      rows = Math.ceil(h / p.cellSize) + 1;
      offX = (w - cols * p.cellSize) / 2;
      offY = (h - rows * p.cellSize) / 2;
      alphas = new Float32Array(cols * rows);
      touched = new Float64Array(cols * rows);
      return true;
    };

    const cellCenter = i => {
      const p = propsRef.current;
      return [offX + (i % cols) * p.cellSize + p.cellSize / 2, offY + Math.floor(i / cols) * p.cellSize + p.cellSize / 2];
    };

    const energize = (x, y, boost) => {
      const p = propsRef.current;
      const r = Math.max(p.radius, 1);
      const ease = FALLOFF_CURVES[p.falloff] || FALLOFF_CURVES.linear;
      const now = performance.now();
      const minCol = Math.max(0, Math.floor((x - r - offX) / p.cellSize));
      const maxCol = Math.min(cols - 1, Math.floor((x + r - offX) / p.cellSize));
      const minRow = Math.max(0, Math.floor((y - r - offY) / p.cellSize));
      const maxRow = Math.min(rows - 1, Math.floor((y + r - offY) / p.cellSize));
      for (let cRow = minRow; cRow <= maxRow; cRow++) {
        for (let cCol = minCol; cCol <= maxCol; cCol++) {
          const i = cRow * cols + cCol;
          const [cx, cy] = cellCenter(i);
          const dist = Math.hypot(cx - x, cy - y);
          if (dist > r) continue;
          const level = ease(1 - dist / r) * p.maxOpacity * (boost || 1);
          if (level > alphas[i]) { alphas[i] = level; touched[i] = now; }
          else if (level > 0) { touched[i] = now; }
        }
      }
    };

    const draw = now => {
      const p = propsRef.current;
      const dt = Math.min(now - lastFrame, 50);
      lastFrame = now;
      ctx.clearRect(0, 0, w, h);
      const [cr, cg, cb] = hexToRgb(p.color);

      if (p.gridOpacity > 0) {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${p.gridOpacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) { const x = Math.round(offX + c * p.cellSize) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let r2 = 0; r2 <= rows; r2++) { const y = Math.round(offY + r2 * p.cellSize) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
      }

      for (let pi = pulses.length - 1; pi >= 0; pi--) {
        const pulse = pulses[pi];
        const ringR = ((now - pulse.t0) / 1000) * p.pulseSpeed;
        if (ringR > Math.hypot(w, h)) { pulses.splice(pi, 1); continue; }
        const band = p.cellSize;
        const minCol = Math.max(0, Math.floor((pulse.x - ringR - band - offX) / p.cellSize));
        const maxCol = Math.min(cols - 1, Math.floor((pulse.x + ringR + band - offX) / p.cellSize));
        const minRow = Math.max(0, Math.floor((pulse.y - ringR - band - offY) / p.cellSize));
        const maxRow = Math.min(rows - 1, Math.floor((pulse.y + ringR + band - offY) / p.cellSize));
        for (let cRow = minRow; cRow <= maxRow; cRow++) {
          for (let cCol = minCol; cCol <= maxCol; cCol++) {
            const i = cRow * cols + cCol;
            const [cx, cy] = cellCenter(i);
            const dist = Math.hypot(cx - pulse.x, cy - pulse.y);
            if (Math.abs(dist - ringR) < band / 2 && p.maxOpacity > alphas[i]) { alphas[i] = p.maxOpacity; touched[i] = now; }
          }
        }
      }

      let anyVisible = pulses.length > 0;
      const fadeStep = dt / Math.max(p.fadeDuration, 16);
      const half = p.cellSize / 2;

      for (let i = 0; i < alphas.length; i++) {
        let a = alphas[i];
        if (a <= 0) continue;
        if (now - touched[i] > p.holdTime) {
          a = Math.max(0, a - fadeStep);
          alphas[i] = a;
          if (a <= 0) continue;
        }
        anyVisible = true;
        const [cx, cy] = cellCenter(i);
        const gradient = ctx.createRadialGradient(cx, cy, half * 0.1, cx, cy, p.cellSize);
        gradient.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
        gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        const x = cx - half + 0.5, y = cy - half + 0.5, s = p.cellSize - 1;
        ctx.beginPath();
        if (p.cellRadius > 0) ctx.roundRect(x, y, s, s, p.cellRadius); else ctx.rect(x, y, s, s);
        if (p.fillOpacity > 0) { ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * p.fillOpacity})`; ctx.fill(); }
        ctx.strokeStyle = gradient;
        ctx.lineWidth = p.lineWidth;
        ctx.stroke();
      }

      if (anyVisible) raf = requestAnimationFrame(draw);
      else { running = false; if (propsRef.current.gridOpacity <= 0) ctx.clearRect(0, 0, w, h); }
    };

    const wake = () => {
      if (running) return;
      running = true;
      lastFrame = performance.now();
      raf = requestAnimationFrame(draw);
    };
    // Kick the draw loop periodically even if rAF is throttled/paused (e.g. a
    // non-visible preview tab), so newly energized cells still get drawn once
    // the tab becomes active again.
    const nudge = setInterval(wake, 500);

    // Listeners live on the document so the layer can stay pointer-events:none
    // and the UI underneath remains clickable.
    const toLocal = e => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width ? canvas.offsetWidth / rect.width : 1;
      const sy = rect.height ? canvas.offsetHeight / rect.height : 1;
      return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
    };
    const inside = (x, y) => x >= 0 && y >= 0 && x <= w && y <= h;
    const onPointerMove = e => { const [x, y] = toLocal(e); if (!inside(x, y)) return; energize(x, y); wake(); };
    const onPointerDown = e => {
      if (!propsRef.current.clickPulse) return;
      const [x, y] = toLocal(e);
      if (!inside(x, y)) return;
      pulses.push({ x, y, t0: performance.now() });
      wake();
    };

    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      let hint = null;
      if (entry) {
        const box = entry.contentBoxSize && entry.contentBoxSize[0];
        if (box) hint = { w: box.inlineSize, h: box.blockSize };
        else if (entry.contentRect) hint = { w: entry.contentRect.width, h: entry.contentRect.height };
      }
      if (rebuild(hint)) wake();
    });
    ro.observe(container);
    if (!rebuild()) {
      // Container may not have real layout yet on a cold load. requestAnimationFrame
      // can stall indefinitely in a backgrounded/non-visible tab, so retry with
      // setTimeout instead, which keeps firing regardless of visibility.
      let tries = 0;
      const retry = () => {
        tries++;
        if (rebuild() || tries > 60) { wake(); return; }
        setTimeout(retry, 50);
      };
      setTimeout(retry, 16);
    } else {
      wake();
    }
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(nudge);
      ro.disconnect();
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [cellSize]);

  return (
    <div ref={containerRef} className={className} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
};

export default CursorGrid;
