<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { PerformanceMonitor, type PerformanceData } from "../../PerformanceMonitor";
  import type { RenderingEngine } from "../../../../../rendering/src/types/RenderingEngine";

  interface Props {
    data?: PerformanceData | null;
    renderingEngine?: RenderingEngine | null;
    active?: boolean;
  }

  let { data = null, renderingEngine = null, active = true }: Props = $props();

  let graphCanvas: HTMLCanvasElement = $state(null!);
  let performanceMonitor: PerformanceMonitor | null = null;
  let visibleSamples = $state(180);
  let showFPS = $state(false);
  let downsample = $state(1);
  let yOffset = $state(0);
  let xOffset = $state(0);
  let centered = $state(false);
  let graphPaused = $state(false);
  let manualPause = false;
  let frozenData: PerformanceData | null = null;
  let dragging = $state(false);
  let yZoom = $state(1);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartYOffset = 0;
  let dragStartXOffset = 0;

  // Cursor/hover state
  let hoverX = -1; // -1 means no hover, otherwise CSS px relative to canvas left

  // Easter egg state
  let starField: { x: number; y: number; r: number; brightness: number }[] = [];
  let starFieldGenerated = false;

  // Screen refresh rate detection
  let detectedHz = 0;
  let hzDetectionDone = false;

  function detectScreenHz() {
    if (hzDetectionDone) {
      return;
    }
    let timestamps: number[] = [];
    const measure = (t: number) => {
      timestamps.push(t);
      if (timestamps.length < 20) {
        requestAnimationFrame(measure);
      } else {
        hzDetectionDone = true;
        const intervals: number[] = [];
        for (let i = 1; i < timestamps.length; i++) {
          intervals.push(timestamps[i] - timestamps[i - 1]);
        }
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        const rawHz = 1000 / median;
        const common = [60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
        let best = 60;
        let bestDist = Infinity;
        for (const hz of common) {
          const dist = Math.abs(rawHz - hz);
          if (dist < bestDist) {
            bestDist = dist; best = hz; 
          }
        }
        detectedHz = best;
      }
    };
    requestAnimationFrame(measure);
  }

  const SAMPLE_STEPS = [30, 60, 90, 120, 180, 300, 450, 600, 900, 1200, 1800, 3600];
  const YZOOM_STEPS = [1, 2, 4, 8, 16, 32];

  function arrayMax(arr: number[]): number {
    let m = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > m) {
        m = arr[i];
      }
    }
    return m;
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+scroll: vertical zoom
      if (e.deltaY < 0) {
        const idx = YZOOM_STEPS.indexOf(yZoom);
        if (idx >= 0 && idx < YZOOM_STEPS.length - 1) {
          yZoom = YZOOM_STEPS[idx + 1];
        } else if (idx < 0) {
          yZoom = YZOOM_STEPS[1] ?? 2;
        }
      } else {
        const idx = YZOOM_STEPS.indexOf(yZoom);
        if (idx > 0) {
          yZoom = YZOOM_STEPS[idx - 1];
        }
      }
      adjustYOffsetForZoom();
    } else {
      // Normal scroll: change visible time range
      const idx = SAMPLE_STEPS.indexOf(visibleSamples);
      if (e.deltaY > 0) {
        if (idx < SAMPLE_STEPS.length - 1) {
          visibleSamples = SAMPLE_STEPS[idx + 1];
        }
      } else {
        if (idx > 0) {
          visibleSamples = SAMPLE_STEPS[idx - 1];
        }
      }
    }
    clampXOffset();
  }

  function clampXOffset() {
    const activeData = graphPaused ? frozenData : data;
    const total = activeData?.frameTimeHistory?.length ?? 0;
    const downTotal = Math.floor(total / downsample);
    const maxPoints = Math.ceil(visibleSamples / downsample);
    const maxOffset = Math.max(0, downTotal - maxPoints);
    xOffset = Math.max(0, Math.min(xOffset, maxOffset));
  }

  function handleMouseDown(e: MouseEvent) {
    if (!graphPaused) {
      graphPaused = true;
      frozenData = data ? { ...data, frameTimeHistory: [...data.frameTimeHistory] } : null;
    }
    dragging = true;
    hoverX = -1;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartYOffset = yOffset;
    dragStartXOffset = xOffset;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!dragging || !graphCanvas) {
      return;
    }
    const rect = graphCanvas.getBoundingClientRect();
    const graphH = rect.height - 32;
    const graphW = rect.width - 8;

    if (!centered) {
      const activeData = graphPaused ? frozenData : data;
      const history = activeData?.frameTimeHistory ?? [];
      const fc = activeData?.frameTimeCount ?? history.length;
      const rawVisible = getRawVisibleSlice(history, fc);

      let scale: number;
      if (showFPS) {
        const fpsVals = rawVisible.map(ms => ms > 0 ? 1000 / ms : 0);
        const visMax = fpsVals.length > 0 ? arrayMax(fpsVals) : 60;
        scale = Math.max(60, visMax) * 1.15 / yZoom;
      } else {
        const visMax = rawVisible.length > 0 ? arrayMax(rawVisible) : 33.3;
        scale = Math.max(33.3, visMax) * 1.15 / yZoom;
      }

      const dy = e.clientY - dragStartY;
      const unitsPerPixel = scale / graphH;
      // Natural drag: drag up (dy<0) → yOffset increases → line moves up
      yOffset = dragStartYOffset - dy * unitsPerPixel;
    }

    const dx = e.clientX - dragStartX;
    const samplesPerPixel = visibleSamples / graphW;
    xOffset = Math.round(dragStartXOffset + dx * samplesPerPixel);
    clampXOffset();
  }

  function handleMouseUp() {
    dragging = false;
    if (graphPaused && !manualPause) {
      graphPaused = false;
      frozenData = null;
      xOffset = 0;
    }
  }

  function redrawGraph() {
    if (!graphCanvas) {
      return;
    }
    const activeData = graphPaused ? frozenData : data;
    if (activeData?.frameTimeHistory) {
      drawGraph(graphCanvas, activeData);
    }
  }

  function handleGraphMouseMove(e: MouseEvent) {
    if (!graphCanvas || dragging) {
      return;
    }
    const rect = graphCanvas.getBoundingClientRect();
    hoverX = e.clientX - rect.left;
    redrawGraph();
  }

  function handleGraphMouseLeave() {
    hoverX = -1;
    redrawGraph();
  }

  function toggleGraphPause() {
    if (graphPaused) {
      graphPaused = false;
      manualPause = false;
      frozenData = null;
      xOffset = 0;
    } else {
      graphPaused = true;
      manualPause = true;
      frozenData = data ? { ...data, frameTimeHistory: [...data.frameTimeHistory] } : null;
    }
  }

  function cycleYZoom() {
    const idx = YZOOM_STEPS.indexOf(yZoom);
    if (idx >= 0 && idx < YZOOM_STEPS.length - 1) {
      yZoom = YZOOM_STEPS[idx + 1];
    } else {
      yZoom = 1;
    }
  }

  function cycleYZoomAndCenter() {
    cycleYZoom();
    adjustYOffsetForZoom();
  }

  function handleYZoomWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) {
      const idx = YZOOM_STEPS.indexOf(yZoom);
      if (idx >= 0 && idx < YZOOM_STEPS.length - 1) {
        yZoom = YZOOM_STEPS[idx + 1];
      } else if (idx < 0) {
        yZoom = YZOOM_STEPS[1] ?? 2;
      }
    } else {
      const idx = YZOOM_STEPS.indexOf(yZoom);
      if (idx > 0) {
        yZoom = YZOOM_STEPS[idx - 1];
      }
    }
    adjustYOffsetForZoom();
  }

  function adjustYOffsetForZoom() {
    const activeData = graphPaused ? frozenData : data;
    const history = activeData?.frameTimeHistory ?? [];
    const fc = activeData?.frameTimeCount ?? history.length;
    const rawVisible = getRawVisibleSlice(history, fc);
    if (rawVisible.length === 0) {
      yOffset = 0; return; 
    }

    if (showFPS) {
      const fpsVals = rawVisible.map(ms => ms > 0 ? 1000 / ms : 0);
      const avg = visibleAvg(fpsVals);
      const visMax = fpsVals.length > 0 ? arrayMax(fpsVals) : 60;
      const zoomedScale = Math.max(60, visMax) * 1.15 / yZoom;
      // Place avg at 40% from bottom: (avg + yOffset) / zoomedScale = 0.4
      yOffset = 0.4 * zoomedScale - avg;
    } else {
      const avg = visibleAvg(rawVisible);
      const visMax = rawVisible.length > 0 ? arrayMax(rawVisible) : 33.3;
      const zoomedScale = Math.max(33.3, visMax) * 1.15 / yZoom;
      yOffset = 0.4 * zoomedScale - avg;
    }
  }

  /** Bring the line back into the visible area if it's off-screen */

  function resetView() {
    yOffset = 0;
    xOffset = 0;
    yZoom = 1;
    visibleSamples = 180;
    centered = false;
  }

  /** Format visible time window as a human-readable label */
  function computeTimeWindowLabel(samples: number): string {
    const sec = samples / 60;
    if (sec < 1) {
      return `${Math.round(sec * 1000)}ms`;
    }
    if (sec >= 60) {
      return `${(sec / 60).toFixed(0)}m`;
    }
    return sec === Math.floor(sec) ? `${sec.toFixed(0)}s` : `${sec.toFixed(1)}s`;
  }

  let timeWindowLabel = $derived(computeTimeWindowLabel(visibleSamples));

  function cycleHZoom() {
    const idx = SAMPLE_STEPS.indexOf(visibleSamples);
    if (idx >= 0 && idx < SAMPLE_STEPS.length - 1) {
      visibleSamples = SAMPLE_STEPS[idx + 1];
    } else {
      visibleSamples = SAMPLE_STEPS[0];
    }
    clampXOffset();
  }

  function handleHZoomWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const idx = SAMPLE_STEPS.indexOf(visibleSamples);
    if (e.deltaY > 0) {
      if (idx < SAMPLE_STEPS.length - 1) {
        visibleSamples = SAMPLE_STEPS[idx + 1];
      }
    } else {
      if (idx > 0) {
        visibleSamples = SAMPLE_STEPS[idx - 1];
      }
    }
    clampXOffset();
  }

  const DOWNSAMPLE_OPTIONS = [1, 2, 4, 8];

  function downsampleLabel(d: number): string {
    return `1:${d}`;
  }

  function downsampleHistory(raw: number[], frameCount: number): number[] {
    if (downsample <= 1) {
      return raw;
    }
    const result: number[] = [];
    // Align groups to absolute frame numbers so completed groups are stable
    // even when the raw history is a sliding window (shift + push).
    const firstAbsIdx = frameCount - raw.length;
    const skip = (downsample - (firstAbsIdx % downsample)) % downsample;
    for (let i = skip; i + downsample <= raw.length; i += downsample) {
      let sum = 0;
      for (let j = i; j < i + downsample; j++) {
        sum += raw[j];
      }
      result.push(sum / downsample);
    }
    return result;
  }

  function getVisibleSlice(fullHistory: number[], frameCount: number): number[] {
    const downsampled = downsampleHistory(fullHistory, frameCount);
    // Limit to ceil(visibleSamples / downsample) so the line fills exactly
    // the graph width — not downsample× wider, which causes flicker/jumping.
    const maxPoints = Math.ceil(visibleSamples / downsample);
    const end = downsampled.length - xOffset;
    const start = Math.max(0, end - maxPoints);
    return downsampled.slice(start, end);
  }

  function generateStarField(w: number, h: number) {
    if (starFieldGenerated) {
      return;
    }
    starField = [];
    for (let i = 0; i < 120; i++) {
      starField.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.5 + 0.3,
        brightness: Math.random() * 0.6 + 0.4,
      });
    }
    starFieldGenerated = true;
  }

  function drawSpaceEasterEgg(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    pad: { top: number; bottom: number; left: number; right: number },
    graphH: number, graphW: number,
    spaceAmount: number,
  ) {
    generateStarField(graphW, graphH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, graphW, graphH);
    ctx.clip();

    for (const star of starField) {
      const alpha = Math.min(1, spaceAmount) * star.brightness;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(pad.left + star.x, pad.top + star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (spaceAmount > 0.5) {
      const moonAlpha = Math.min(1, (spaceAmount - 0.5) * 2);
      const moonX = pad.left + graphW * 0.75;
      const moonY = pad.top + graphH * 0.3;
      const moonR = Math.min(graphW, graphH) * 0.12;

      const glow = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, moonR * 2.5);
      glow.addColorStop(0, `rgba(200, 210, 230, ${(moonAlpha * 0.15).toFixed(2)})`);
      glow.addColorStop(1, "rgba(200, 210, 230, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR * 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(220, 225, 235, ${moonAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.fill();

      const craters = [
        { dx: -0.3, dy: -0.2, r: 0.2 },
        { dx: 0.2, dy: 0.3, r: 0.15 },
        { dx: -0.1, dy: 0.4, r: 0.12 },
        { dx: 0.35, dy: -0.1, r: 0.1 },
      ];
      for (const c of craters) {
        ctx.fillStyle = `rgba(180, 185, 200, ${(moonAlpha * 0.5).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(moonX + c.dx * moonR, moonY + c.dy * moonR, c.r * moonR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /** Get the raw (non-downsampled) visible slice for computing vertical scale.
   *  This prevents downsample averaging from affecting the Y-axis range. */
  function getRawVisibleSlice(fullHistory: number[], frameCount: number): number[] {
    const end = fullHistory.length - xOffset;
    const start = Math.max(0, end - visibleSamples);
    return fullHistory.slice(start, end);
  }

  function drawGraph(canvas: HTMLCanvasElement, activeData: PerformanceData) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const fullHistory = activeData.frameTimeHistory;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    const style = getComputedStyle(canvas);
    const bg = style.getPropertyValue("--vscode-editor-background").trim() || "#1e1e1e";
    const panelBg = style.getPropertyValue("--vscode-panel-background").trim() || bg;
    const fg = style.getPropertyValue("--vscode-foreground").trim() || "#cccccc";
    const fgDim = style.getPropertyValue("--vscode-descriptionForeground").trim() || "#888888";

    // Use panel background (slightly lighter than editor bg in most themes)
    ctx.fillStyle = panelBg;
    ctx.fillRect(0, 0, w, h);

    const pad = { top: 2, bottom: 0, left: 2, right: 6 };
    const graphW = w - pad.left - pad.right;
    const graphH = h - pad.top - pad.bottom;

    const history = getVisibleSlice(fullHistory, activeData.frameTimeCount);
    // Use raw (non-downsampled) visible range for vertical scale so
    // changing downsample doesn't affect Y-axis zoom level.
    const rawVisible = getRawVisibleSlice(fullHistory, activeData.frameTimeCount);

    // Save/restore around graph drawing to prevent clip leaks
    ctx.save();
    if (showFPS) {
      drawFPSGraph(ctx, history, rawVisible, w, h, pad, graphW, graphH, fg, fgDim);
    } else {
      drawMsGraph(ctx, history, rawVisible, w, h, pad, graphW, graphH, fg, fgDim);
    }
    ctx.restore();

    // X-axis, stats, and cursor drawn with clean context state (no clips)
    drawXAxis(ctx, history, pad, graphW, graphH, fg, fgDim);
    drawStats(ctx, activeData, pad, graphW, graphH, fg, fgDim);
    drawCursor(ctx, history, rawVisible, pad, graphW, graphH, fg);
  }

  function visibleAvg(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const v of values) {
      sum += v;
    }
    return sum / values.length;
  }

  function computeYOffset(avg: number, maxScale: number): number {
    if (!centered) {
      return yOffset;
    }
    return 0.5 * maxScale - avg;
  }

  function drawStats(
    ctx: CanvasRenderingContext2D,
    activeData: PerformanceData,
    pad: { top: number; bottom: number; left: number; right: number },
    graphW: number, graphH: number,
    fg: string, fgDim: string,
  ) {
    const x = pad.left + graphW;
    const y = pad.top + graphH - 40; // inside graph area, well above x-axis labels
    ctx.font = "10px monospace";
    ctx.textAlign = "right";

    if (showFPS) {
      const fps = activeData.currentFPS;
      const minFps = activeData.maxFrameTime > 0 ? 1000 / activeData.maxFrameTime : 0;
      const maxFps = activeData.minFrameTime > 0 ? 1000 / activeData.minFrameTime : 0;
      ctx.fillStyle = fg;
      ctx.fillText(`avg ${fps.toFixed(0)}  min ${minFps.toFixed(0)}  max ${maxFps.toFixed(0)}`, x, y);
    } else {
      ctx.fillStyle = fg;
      ctx.fillText(`avg ${activeData.avgFrameTime.toFixed(1)}ms  min ${activeData.minFrameTime.toFixed(1)}ms  max ${activeData.maxFrameTime.toFixed(1)}ms`, x, y);
    }
  }

  function drawXAxis(
    ctx: CanvasRenderingContext2D,
    history: number[],
    pad: { top: number; bottom: number; left: number; right: number },
    graphW: number, graphH: number,
    fg: string, fgDim: string,
  ) {
    ctx.save();

    const rightX = pad.left + graphW;
    // Draw labels inside the graph area, with safe margin from canvas bottom
    const labelY = pad.top + graphH - 15;

    if (history.length < 2) {
      ctx.restore(); return; 
    }

    // Use the nominal time window (visibleSamples / 60fps) for stable tick spacing.
    // Computing from actual frame times causes ticks to flash as values fluctuate.
    const totalTimeSec = visibleSamples / 60;

    if (totalTimeSec < 0.05) {
      ctx.restore(); return; 
    }

    // Pick a tick interval that gives roughly 3-8 ticks
    const tickIntervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    let tickInterval = 1;
    for (const t of tickIntervals) {
      if (totalTimeSec / t <= 8) {
        tickInterval = t;
        break;
      }
    }

    // Map seconds-ago to x position — always spans the full time window
    // so the axis is static regardless of how much data has arrived
    const timeToX = (secAgo: number): number => {
      return rightX - (secAgo / totalTimeSec) * graphW;
    };

    ctx.font = "10px monospace";
    ctx.textBaseline = "bottom";
    ctx.globalAlpha = 0.7;

    // "now" label at right edge
    ctx.fillStyle = fg;
    ctx.textAlign = "right";
    ctx.fillText("now", rightX - 2, labelY);

    // Time labels
    for (let sec = tickInterval; sec <= totalTimeSec + 0.001; sec += tickInterval) {
      const x = timeToX(sec);
      if (x < pad.left + 10 || x > rightX - 30) {
        continue;
      }

      // Vertical tick line
      ctx.strokeStyle = fgDim;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, labelY);
      ctx.lineTo(x, labelY - 6);
      ctx.stroke();

      // Label
      const label = `-${sec === Math.floor(sec) ? sec.toFixed(0) : sec.toFixed(1)}s`;
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.fillText(label, x, labelY);
    }

    ctx.restore();
  }

  function drawCursor(
    ctx: CanvasRenderingContext2D,
    history: number[],
    rawVisible: number[],
    pad: { top: number; bottom: number; left: number; right: number },
    graphW: number, graphH: number,
    fg: string,
  ) {
    if (hoverX < 0 || history.length < 2) {
      return;
    }

    const rightX = pad.left + graphW;
    const step = graphW / (visibleSamples - 1) * downsample;
    const startX = rightX - (history.length - 1) * step;

    // Find the closest data point to hoverX
    const idx = Math.round((hoverX - startX) / step);
    if (idx < 0 || idx >= history.length) {
      return;
    }

    const snappedX = startX + idx * step;
    if (snappedX < pad.left || snappedX > rightX) {
      return;
    }

    const msValue = history[idx];

    // Compute toY to place the dot correctly on the line
    let dotY: number;
    if (showFPS) {
      const rawFps = rawVisible.map(ms => ms > 0 ? 1000 / ms : 0);
      const avgFps = visibleAvg(rawFps);
      const visMax = rawFps.length > 0 ? arrayMax(rawFps) : 60;
      const maxScale = Math.max(60, visMax) * 1.15 / yZoom;
      const off = computeYOffset(avgFps, maxScale);
      const fpsVal = msValue > 0 ? 1000 / msValue : 0;
      dotY = pad.top + graphH - ((fpsVal + off) / maxScale) * graphH;
    } else {
      const visMax = rawVisible.length > 0 ? arrayMax(rawVisible) : 33.3;
      const avg = visibleAvg(rawVisible);
      const maxScale = Math.max(33.3, visMax) * 1.15 / yZoom;
      const off = computeYOffset(avg, maxScale);
      dotY = pad.top + graphH - ((msValue + off) / maxScale) * graphH;
    }

    // Vertical cursor line
    ctx.save();
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(snappedX, pad.top);
    ctx.lineTo(snappedX, pad.top + graphH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot on the line
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#4ec9b0";
    ctx.beginPath();
    ctx.arc(snappedX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Value tooltip
    ctx.save();
    ctx.font = "10px monospace";
    ctx.globalAlpha = 0.9;

    let label: string;
    if (showFPS) {
      const fps = msValue > 0 ? 1000 / msValue : 0;
      label = `${fps.toFixed(1)} fps`;
    } else {
      label = `${msValue.toFixed(2)} ms`;
    }

    // Time offset label
    const framesFromRight = (history.length - 1 - idx) * downsample;
    const secAgo = framesFromRight / 60;
    const timeLabel = secAgo < 0.01 ? "now" : `-${secAgo.toFixed(1)}s`;
    const fullLabel = `${label}  ${timeLabel}`;

    const textW = ctx.measureText(fullLabel).width + 8;
    // Position tooltip: prefer right of cursor, flip if near right edge
    let tooltipX = snappedX + 6;
    if (tooltipX + textW > rightX) {
      tooltipX = snappedX - textW - 2;
    }

    const tooltipY = pad.top + 14;
    ctx.fillStyle = fg + "18";
    ctx.fillRect(tooltipX - 2, tooltipY - 11, textW, 14);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(fullLabel, tooltipX + 2, tooltipY - 10);
    ctx.restore();
  }

  // Reference lines — use detected screen Hz instead of fixed 120/240
  function getMsRefs() {
    const refs = [
      { ms: 0, label: "0ms", color: "#888888" },
      { ms: 16.6, label: "16.6ms (60fps)", color: "#4ec9b0" },
      { ms: 33.3, label: "33.3ms (30fps)", color: "#f44747" },
    ];
    if (detectedHz > 0 && detectedHz !== 60) {
      const ms = +(1000 / detectedHz).toFixed(1);
      refs.push({ ms, label: `${ms}ms (${detectedHz}Hz)`, color: "#dcdcaa" });
    }
    return refs;
  }

  function getFpsRefs() {
    const refs = [
      { fps: 0, label: "0fps", color: "#888888" },
      { fps: 30, label: "30fps", color: "#f44747" },
      { fps: 60, label: "60fps", color: "#4ec9b0" },
    ];
    if (detectedHz > 0 && detectedHz !== 60) {
      refs.push({ fps: detectedHz, label: `${detectedHz}Hz`, color: "#dcdcaa" });
    }
    return refs;
  }

  function drawRefLines(
    ctx: CanvasRenderingContext2D,
    refs: { value: number; label: string; color: string }[],
    toY: (v: number) => number,
    pad: { top: number; bottom: number; left: number; right: number },
    graphW: number, graphH: number,
  ) {
    ctx.font = "11px monospace";
    for (const ref of refs) {
      const y = toY(ref.value);
      if (y < pad.top - 1 || y > pad.top + graphH + 1) {
        continue;
      }
      ctx.strokeStyle = ref.color + "40";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + graphW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ref.color + "cc";
      ctx.textAlign = "left";
      ctx.fillText(ref.label, pad.left + 4, y - 3);
    }
  }

  function drawMsGraph(
    ctx: CanvasRenderingContext2D, history: number[],
    rawVisible: number[],
    w: number, h: number,
    pad: { top: number; bottom: number; left: number; right: number },
    graphW: number, graphH: number,
    fg: string, fgDim: string,
  ) {
    // Use raw (non-downsampled) values for scale so downsample doesn't affect Y range
    const visibleMax = rawVisible.length > 0 ? arrayMax(rawVisible) : 33.3;
    const avg = visibleAvg(rawVisible);
    const maxMs = Math.max(33.3, visibleMax) * 1.15 / yZoom;
    const off = computeYOffset(avg, maxMs);
    const toY = (ms: number) => pad.top + graphH - ((ms + off) / maxMs) * graphH;

    // Easter egg: use unzoomed scale so high zoom doesn't trigger it
    const baseMaxMs = Math.max(33.3, visibleMax) * 1.15; // no yZoom division
    const baseZeroY = pad.top + graphH - ((0 + off) / baseMaxMs) * graphH;
    if (baseZeroY > pad.top + graphH * 3) {
      const spaceAmount = Math.min(1, (baseZeroY - pad.top - graphH * 3) / (graphH));
      drawSpaceEasterEgg(ctx, w, h, pad, graphH, graphW, spaceAmount);
    }

    // Reference lines
    const refs = getMsRefs().map(r => ({ value: r.ms, label: r.label, color: r.color }));
    drawRefLines(ctx, refs, toY, pad, graphW, graphH);

    if (history.length < 2) {
      return;
    }

    // Avg line
    const avgY = toY(avg);
    if (avgY >= pad.top && avgY <= pad.top + graphH) {
      ctx.strokeStyle = fg + "50";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, avgY);
      ctx.lineTo(pad.left + graphW, avgY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = fg;
      ctx.textAlign = "left";
      ctx.fillText(`avg ${avg.toFixed(1)}ms`, pad.left + 4, avgY - 3);
    }

    // Line
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, graphW, graphH);
    ctx.clip();
    drawLine(ctx, history, pad, graphW, toY);
    ctx.restore();
  }

  function drawFPSGraph(
    ctx: CanvasRenderingContext2D, history: number[],
    rawVisible: number[],
    w: number, h: number,
    pad: { top: number; bottom: number; left: number; right: number },
    graphW: number, graphH: number,
    fg: string, fgDim: string,
  ) {
    const fpsHistory = history.map(ms => ms > 0 ? 1000 / ms : 0);
    // Use raw (non-downsampled) values for scale so downsample doesn't affect Y range
    const rawFps = rawVisible.map(ms => ms > 0 ? 1000 / ms : 0);
    const avgFps = visibleAvg(rawFps);

    const visibleMax = rawFps.length > 0 ? arrayMax(rawFps) : 60;
    const maxFpsScale = Math.max(60, visibleMax) * 1.15 / yZoom;
    const off = computeYOffset(avgFps, maxFpsScale);
    const toY = (fps: number) => pad.top + graphH - ((fps + off) / maxFpsScale) * graphH;

    // Easter egg: use unzoomed scale so high zoom doesn't trigger it
    const baseMaxFps = Math.max(60, visibleMax) * 1.15; // no yZoom division
    const baseZeroY = pad.top + graphH - ((0 + off) / baseMaxFps) * graphH;
    if (baseZeroY > pad.top + graphH * 3) {
      const spaceAmount = Math.min(1, (baseZeroY - pad.top - graphH * 3) / (graphH));
      drawSpaceEasterEgg(ctx, w, h, pad, graphH, graphW, spaceAmount);
    }

    // Reference lines
    const refs = getFpsRefs().map(r => ({ value: r.fps, label: r.label, color: r.color }));
    drawRefLines(ctx, refs, toY, pad, graphW, graphH);

    if (fpsHistory.length < 2) {
      return;
    }

    // Avg line
    const avgY = toY(avgFps);
    if (avgY >= pad.top && avgY <= pad.top + graphH) {
      ctx.strokeStyle = fg + "50";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, avgY);
      ctx.lineTo(pad.left + graphW, avgY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = fg;
      ctx.textAlign = "left";
      ctx.fillText(`avg ${avgFps.toFixed(0)}fps`, pad.left + 4, avgY - 3);
    }

    // Line
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, graphW, graphH);
    ctx.clip();
    drawLine(ctx, fpsHistory, pad, graphW, toY);
    ctx.restore();
  }

  function drawLine(
    ctx: CanvasRenderingContext2D, values: number[],
    pad: { top: number; left: number }, graphW: number,
    toY: (v: number) => number,
  ) {
    if (values.length < 2) {
      return;
    }
    // Each downsampled point represents `downsample` raw frames,
    // so space them `downsample` times wider than a single raw frame step.
    const step = graphW / (visibleSamples - 1) * downsample;
    const rightX = pad.left + graphW;
    const startX = rightX - (values.length - 1) * step;

    ctx.beginPath();
    ctx.lineWidth = 1.5;
    for (let i = 0; i < values.length; i++) {
      const x = startX + i * step;
      const y = toY(values[i]);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "#4ec9b0";
    ctx.stroke();
  }

  onMount(() => {
    detectScreenHz();
    if (renderingEngine) {
      performanceMonitor = new PerformanceMonitor(renderingEngine);
      performanceMonitor.setStateCallback((nextData) => {
        data = nextData;
      });
      if (active) {
        performanceMonitor.start();
      }
    }
  });

  $effect(() => {
    if (performanceMonitor) {
      if (active) {
        performanceMonitor.start();
      } else {
        performanceMonitor.stop();
      }
    }
  });

  onDestroy(() => {
    performanceMonitor?.dispose();
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.code === "Space" && data && data.frameTimeHistory.length > 0) {
      e.preventDefault();
      toggleGraphPause();
      adjustYOffsetForZoom();
    }
  }

  $effect(() => {
    const canvas = graphCanvas;
    const paused = graphPaused;
    const activeData = paused ? frozenData : data;
    if (!canvas) return;
    if (activeData?.frameTimeHistory) {
      drawGraph(canvas, activeData);
    }
  });
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} onkeydown={handleKeyDown} />

<div class="performance-panel">
  {#if data && data.frameTimeHistory.length > 0}
    <div class="toolbar">
      <div class="toolbar-group">
        <button
          class="toggle-btn"
          class:active={!showFPS}
          onclick={() => {
            showFPS = false; adjustYOffsetForZoom();
          }}
          title="Show frame time in milliseconds"
        >ms</button>
        <button
          class="toggle-btn"
          class:active={showFPS}
          onclick={() => {
            showFPS = true; adjustYOffsetForZoom();
          }}
          title="Show frames per second"
        >fps</button>
        <button
          class="toggle-btn pause-btn"
          class:active={graphPaused}
          onclick={() => {
            toggleGraphPause(); adjustYOffsetForZoom();
          }}
          title={graphPaused ? "Resume graph" : "Pause graph"}
        >{#if graphPaused}<i class="codicon codicon-play"></i>{:else}<i class="codicon codicon-debug-pause"></i>{/if}</button>
        <button
          class="toggle-btn"
          class:active={centered}
          onclick={() => {
            centered = !centered; if (centered) {
              yOffset = 0;
            } adjustYOffsetForZoom();
          }}
          title="Center line on visible average"
          aria-label="Center line on visible average"
        ><i class="codicon codicon-screen-normal"></i></button>
        <button
          class="toggle-btn"
          class:active={visibleSamples !== 180}
          onclick={() => {
            cycleHZoom(); adjustYOffsetForZoom();
          }}
          onwheel={handleHZoomWheel}
          title="Horizontal zoom (time window) — click to cycle, scroll to adjust"
        ><i class="codicon codicon-arrow-both"></i> {timeWindowLabel}</button>
        <button
          class="toggle-btn"
          class:active={yZoom > 1}
          onclick={cycleYZoomAndCenter}
          onwheel={handleYZoomWheel}
          title="Vertical zoom — click to cycle, scroll to adjust"
        ><i class="codicon codicon-arrow-both vertical"></i> {yZoom}x</button>
        {#if yOffset !== 0 || xOffset !== 0 || yZoom !== 1 || visibleSamples !== 180}
          <button class="toggle-btn" onclick={resetView} title="Reset pan and zoom" aria-label="Reset pan and zoom"><i class="codicon codicon-discard"></i></button>
        {/if}
      </div>
      <div class="toolbar-group">
        {#each DOWNSAMPLE_OPTIONS as d}
          <button
            class="toggle-btn"
            class:active={downsample === d}
            onclick={() => {
              downsample = d; adjustYOffsetForZoom();
            }}
            title="Downsample {downsampleLabel(d)}"
          >{downsampleLabel(d)}</button>
        {/each}
      </div>
    </div>
    <div class="graph-container" role="presentation" onwheel={handleWheel} onmousedown={handleMouseDown}
      onmousemove={handleGraphMouseMove} onmouseleave={handleGraphMouseLeave}>
      <canvas bind:this={graphCanvas} class="frame-graph" class:dragging></canvas>
    </div>
  {:else}
    <div class="no-data-msg">Waiting for data...</div>
  {/if}
</div>

<style>
  .performance-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    padding: 4px 6px;
    flex-shrink: 0;
    min-height: 0;
  }

  .toolbar-group {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .graph-container {
    flex: 1;
    min-height: 0;
    cursor: grab;
  }

  .frame-graph {
    width: 100%;
    height: 100%;
    display: block;
  }

  .frame-graph.dragging {
    cursor: grabbing;
  }

  .toggle-btn {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    padding: 1px 6px;
    height: 18px;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    border-radius: 2px;
    opacity: 0.6;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .toggle-btn .codicon {
    font-size: 12px;
    line-height: 1;
  }

  .toggle-btn .codicon.vertical {
    transform: rotate(90deg);
  }

  .toggle-btn.active {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    opacity: 1;
  }

  .pause-btn {
    min-width: 18px;
    width: 18px;
    height: 18px;
    justify-content: center;
    padding: 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  .no-data-msg {
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
    padding: 20px;
    text-align: center;
    font-size: 12px;
  }
</style>
