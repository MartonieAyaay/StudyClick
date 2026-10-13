import { useEffect, useRef } from 'react';

// 8 white lines radiating from the click point, fading over 420ms.
// Attach the returned ref to a <canvas className="fx-layer fx-sparks" />.
export function useClickSparks({ color = '#ffffff', duration = 420, radius = 18, size = 11 } = {}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    let sparks = [];
    let raf = 0;

    // A canvas doesn't stretch from inset:0 alone — force it to fill its parent.
    cv.style.width = '100%';
    cv.style.height = '100%';

    const sizeCanvas = () => {
      const w = cv.offsetWidth, h = cv.offsetHeight;
      if (!w || !h) return false;
      const dpr = window.devicePixelRatio || 1;
      const tw = Math.round(w * dpr), th = Math.round(h * dpr);
      if (cv.width !== tw || cv.height !== th) {
        cv.width = tw;
        cv.height = th;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      cv._cssW = w;
      cv._cssH = h;
      return true;
    };
    let tries = 0;
    const trySize = () => { if (!sizeCanvas() && tries++ < 60) setTimeout(trySize, 50); };
    trySize();
    // Page height changes as content changes, not just on window resize.
    const ro = new ResizeObserver(() => sizeCanvas());
    ro.observe(cv);

    const onClick = (e) => {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const sx = cv.offsetWidth / r.width, sy = cv.offsetHeight / r.height;
      const x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sy;
      const now = performance.now();
      for (let i = 0; i < 8; i++) sparks.push({ x, y, angle: (2 * Math.PI * i) / 8, t: now });
    };
    document.addEventListener('click', onClick, true);

    const draw = (ts) => {
      ctx.clearRect(0, 0, cv._cssW || cv.width, cv._cssH || cv.height);
      if (sparks.length) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        sparks = sparks.filter((s) => {
          const p = (ts - s.t) / duration;
          if (p >= 1) return false;
          const e = p * (2 - p);
          const d = e * radius, len = size * (1 - e);
          ctx.globalAlpha = 1 - e * 0.65;
          ctx.beginPath();
          ctx.moveTo(s.x + d * Math.cos(s.angle), s.y + d * Math.sin(s.angle));
          ctx.lineTo(s.x + (d + len) * Math.cos(s.angle), s.y + (d + len) * Math.sin(s.angle));
          ctx.stroke();
          return true;
        });
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('click', onClick, true);
    };
  }, [color, duration, radius, size]);

  return canvasRef;
}
