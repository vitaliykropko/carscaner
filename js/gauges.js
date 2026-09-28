/**
 * Canvas-based Realtime Gauges and Strip-Chart Recorder
 * Спортивный стиль приборной панели Mazda 6 GH (Soul Red / High Contrast Dark).
 */

export class GaugeRenderer {
  /**
   * Отрисовка кругового циферблата
   */
  static drawCircularGauge(canvas, value, min, max, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Ресайз под HiDPI если нужно
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width;
    const h = rect.height || canvas.height;

    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;

    // Углы шкалы: от 135 градусов до 405 градусов (размах 270 градусов)
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const totalAngle = endAngle - startAngle;

    const clampedVal = Math.max(min, Math.min(max, value || 0));
    const ratio = (clampedVal - min) / (max - min);
    const valueAngle = startAngle + ratio * totalAngle;

    // 1. Фоновая дуга
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = '#222634';
    ctx.lineWidth = radius * 0.12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 2. Красная зона (для тахометра, если задана redline)
    if (options.redline && options.redline < max) {
      const redRatio = (options.redline - min) / (max - min);
      const redStart = startAngle + redRatio * totalAngle;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, redStart, endAngle);
      ctx.strokeStyle = 'rgba(230, 30, 45, 0.35)';
      ctx.lineWidth = radius * 0.12;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }

    // 3. Активная полоса значения
    if (ratio > 0.005) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, valueAngle);
      const grad = ctx.createLinearGradient(0, cy, w, cy);
      grad.addColorStop(0, options.primaryColor || '#ff4d5a');
      grad.addColorStop(1, options.accentColor || '#c40e22');
      ctx.strokeStyle = grad;
      ctx.lineWidth = radius * 0.12;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 4. Засечки и деления
    const ticks = options.ticks || 8;
    for (let i = 0; i <= ticks; i++) {
      const tRatio = i / ticks;
      const angle = startAngle + tRatio * totalAngle;
      const tickVal = Math.round(min + tRatio * (max - min));
      const isMajor = i % 2 === 0;

      const innerR = radius - (isMajor ? radius * 0.22 : radius * 0.15);
      const outerR = radius - radius * 0.08;

      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * outerR;
      const y2 = cy + Math.sin(angle) * outerR;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isMajor ? '#8e9aaf' : '#454c5e';
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();

      // Подписи главных засечек
      if (isMajor && radius > 70) {
        const textR = innerR - 14;
        const tx = cx + Math.cos(angle) * textR;
        const ty = cy + Math.sin(angle) * textR;
        ctx.fillStyle = '#7a8599';
        ctx.font = `600 ${Math.max(10, Math.floor(radius * 0.12))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = options.formatTick ? options.formatTick(tickVal) : tickVal;
        ctx.fillText(label, tx, ty);
      }
    }

    // 5. Стрелка
    const needleR = radius * 0.85;
    const nx = cx + Math.cos(valueAngle) * needleR;
    const ny = cy + Math.sin(valueAngle) * needleR;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = '#ff3344';
    ctx.lineWidth = Math.max(3, radius * 0.04);
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ff1a2d';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 6. Центральная крышка
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1d26';
    ctx.fill();
    ctx.strokeStyle = '#c40e22';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 7. Цифровое значение и единица измерения
    ctx.fillStyle = '#f0f3f8';
    ctx.font = `bold ${Math.max(16, Math.floor(radius * 0.32))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(clampedVal)}`, cx, cy + radius * 0.55);

    ctx.fillStyle = '#8e9aaf';
    ctx.font = `500 ${Math.max(10, Math.floor(radius * 0.14))}px system-ui, sans-serif`;
    ctx.fillText(options.unit || '', cx, cy + radius * 0.8);

    ctx.restore();
  }
}

/**
 * Интерактивный самописец (Realtime Strip-Chart)
 */
export class LiveChartRecorder {
  constructor(canvas, maxPoints = 80) {
    this.canvas = canvas;
    this.maxPoints = maxPoints;
    this.dataPoints = [];
    this.currentMetric = 'rpm';
    this.isPaused = false;
  }

  setMetric(metricName) {
    this.currentMetric = metricName;
    this.dataPoints = [];
    this.render();
  }

  addPoint(val) {
    if (this.isPaused) return;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    this.dataPoints.push({ time: timeStr, value: val });
    if (this.dataPoints.length > this.maxPoints) {
      this.dataPoints.shift();
    }
    this.render();
  }

  clear() {
    this.dataPoints = [];
    this.render();
  }

  render() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || this.canvas.width;
    const h = rect.height || this.canvas.height;

    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padLeft = 45;
    const padRight = 15;
    const padTop = 20;
    const padBottom = 25;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    // Сетка
    ctx.strokeStyle = '#1e2330';
    ctx.lineWidth = 1;

    // Горизонтальные линии сетки
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padTop + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
    }

    if (this.dataPoints.length < 2) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Ожидание данных телеметрии...', w / 2, h / 2);
      ctx.restore();
      return;
    }

    // Min / Max для авто-масштаба
    const values = this.dataPoints.map(p => p.value);
    let minVal = Math.min(...values);
    let maxVal = Math.max(...values);

    if (minVal === maxVal) {
      minVal -= 10;
      maxVal += 10;
    } else {
      const margin = (maxVal - minVal) * 0.15;
      minVal = Math.floor(minVal - margin);
      maxVal = Math.ceil(maxVal + margin);
    }

    // Отрисовка значений по шкале Y
    ctx.fillStyle = '#7a8599';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
      const y = padTop + (chartH / gridLines) * i;
      const v = Math.round(maxVal - (i / gridLines) * (maxVal - minVal));
      ctx.fillText(`${v}`, padLeft - 6, y);
    }

    // График линии
    const getX = (idx) => padLeft + (idx / (this.maxPoints - 1)) * chartW;
    const getY = (val) => padTop + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;

    // Градиентная область под графиком
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + chartH);

    for (let i = 0; i < this.dataPoints.length; i++) {
      const x = getX(i);
      const y = getY(this.dataPoints[i].value);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }

    const lastX = getX(this.dataPoints.length - 1);
    ctx.lineTo(lastX, padTop + chartH);
    ctx.closePath();

    const areaGrad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    areaGrad.addColorStop(0, 'rgba(230, 28, 36, 0.35)');
    areaGrad.addColorStop(1, 'rgba(230, 28, 36, 0.0)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Сама линия графика
    ctx.beginPath();
    for (let i = 0; i < this.dataPoints.length; i++) {
      const x = getX(i);
      const y = getY(this.dataPoints[i].value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#ff3344';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 51, 68, 0.6)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Текущая точка
    const curP = this.dataPoints[this.dataPoints.length - 1];
    const curX = getX(this.dataPoints.length - 1);
    const curY = getY(curP.value);
    ctx.beginPath();
    ctx.arc(curX, curY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#c40e22';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }
}
