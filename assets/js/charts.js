/* =========================================================
   电库图鉴 / Curve renderer
   Lightweight SVG charts — no external dependencies.
   Points: [{ t: minutes, pct: 0–100, w: watts }]
   ========================================================= */

(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  function isNum(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeColor(value, fallback) {
    var color = typeof value === 'string' ? value.trim() : '';
    if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
    if (/^(rgb|hsl)a?\([0-9.,% ]+\)$/.test(color)) return color;
    return fallback || '#0067C0';
  }

  function normalizePoints(points) {
    if (!Array.isArray(points)) return [];
    var out = [];
    points.forEach(function (point) {
      if (!point) return;
      var t = Number(point.t);
      var pct = Number(point.pct);
      var w = point.w == null || point.w === '' ? null : Number(point.w);
      if (!Number.isFinite(t) || !Number.isFinite(pct)) return;
      if (w !== null && !Number.isFinite(w)) return;
      out.push({
        t: Math.max(0, t),
        pct: clamp(pct, 0, 100),
        w: w === null ? null : Math.max(0, w)
      });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits) {
    if (!isNum(value)) return '—';
    var maximum = typeof digits === 'number' ? digits : 0;
    return new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: maximum,
      minimumFractionDigits: 0
    }).format(value);
  }

  function niceTime(value) {
    if (!isNum(value) || value <= 0) return 60;
    var steps = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1080, 1440];
    for (var i = 0; i < steps.length; i += 1) {
      if (value <= steps[i]) return steps[i];
    }
    return Math.ceil(value / 60) * 60;
  }

  function nicePower(value) {
    if (!isNum(value) || value <= 0) return 100;
    var steps = [5, 10, 15, 20, 30, 45, 50, 65, 80, 100, 120, 140, 160, 200, 240, 300, 400];
    for (var i = 0; i < steps.length; i += 1) {
      if (value <= steps[i]) return steps[i];
    }
    var magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    return Math.ceil(value / magnitude) * magnitude;
  }

  function pathFromPoints(coords) {
    if (!coords.length) return '';
    if (coords.length === 1) {
      return 'M' + coords[0].x.toFixed(2) + ',' + coords[0].y.toFixed(2);
    }
    var d = 'M' + coords[0].x.toFixed(2) + ',' + coords[0].y.toFixed(2);
    for (var i = 0; i < coords.length - 1; i += 1) {
      var p0 = coords[i - 1] || coords[i];
      var p1 = coords[i];
      var p2 = coords[i + 1];
      var p3 = coords[i + 2] || p2;
      var tension = 0.72;
      var cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
      var cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
      var cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
      var cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;
      d += 'C' + cp1x.toFixed(2) + ',' + cp1y.toFixed(2) + ' ' +
        cp2x.toFixed(2) + ',' + cp2y.toFixed(2) + ' ' +
        p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
    }
    return d;
  }

  function interpolate(points, time) {
    if (!points.length) return null;
    if (time <= points[0].t) {
      return { t: points[0].t, pct: points[0].pct, w: points[0].w };
    }
    var last = points[points.length - 1];
    if (time >= last.t) return last;
    for (var i = 1; i < points.length; i += 1) {
      if (points[i].t >= time) {
        var a = points[i - 1];
        var b = points[i];
        var span = b.t - a.t || 1;
        var ratio = (time - a.t) / span;
        var power = a.w == null || b.w == null
          ? (a.w == null ? b.w : a.w)
          : a.w + (b.w - a.w) * ratio;
        return {
          t: time,
          pct: a.pct + (b.pct - a.pct) * ratio,
          w: power
        };
      }
    }
    return last;
  }

  function svgEl(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function axisLabel(parent, x, y, text, anchor, className) {
    var label = svgEl('text', {
      x: x,
      y: y,
      'text-anchor': anchor || 'start',
      class: className || 'chart-axis-label'
    });
    label.textContent = text;
    parent.appendChild(label);
    return label;
  }

  function svgText(x, y, text, anchor, className) {
    var node = document.createElementNS(NS, 'text');
    node.setAttribute('x', x);
    node.setAttribute('y', y);
    node.setAttribute('text-anchor', anchor || 'start');
    node.setAttribute('class', className || 'chart-axis-label');
    node.textContent = text;
    return node;
  }

  function chartEmpty(container, message) {
    container.innerHTML =
      '<div class="chart-empty-inline"><div><strong>' + escapeHTML(message || '暂无曲线数据') +
      '</strong><small>NO CURVE DATA</small></div></div>';
    container.classList.add('is-empty');
  }

  function renderCurveChart(container, series, options) {
    if (!container) return;
    var settings = options || {};
    var rawSeries = Array.isArray(series) ? series : [];
    var validSeries = rawSeries.map(function (item, index) {
      return {
        id: item.id || 'series-' + index,
        label: item.label || '曲线 ' + (index + 1),
        color: safeColor(item.color, index === 0 ? '#0067C0' : '#0086B3'),
        points: normalizePoints(item.points),
        showPct: item.showPct !== false
      };
    }).filter(function (item) { return item.points.length > 0; });

    if (!validSeries.length) {
      chartEmpty(container, settings.emptyMessage || '暂无曲线数据');
      return;
    }

    container.classList.remove('is-empty');
    container.innerHTML = '';
    container.style.position = 'relative';

    var width = Math.max(280, Math.round(container.clientWidth || 800));
    var height = Math.max(220, Math.round(container.clientHeight || 380));
    var compact = width < 520;
    var pad = {
      top: compact ? 24 : 28,
      right: compact ? 44 : 54,
      bottom: compact ? 46 : 44,
      left: compact ? 45 : 54
    };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var allPoints = [];
    validSeries.forEach(function (item) {
      item.points.forEach(function (point) { allPoints.push(point); });
    });
    var maxT = niceTime(allPoints.reduce(function (max, p) { return Math.max(max, p.t); }, 0));
    var hasPower = allPoints.some(function (point) { return point.w != null; });
    var maxW = hasPower
      ? nicePower(allPoints.reduce(function (max, p) { return Math.max(max, p.w == null ? 0 : p.w); }, 0))
      : 100;

    function xScale(t) {
      return pad.left + (clamp(t, 0, maxT) / maxT) * plotW;
    }

    function yPower(w) {
      return pad.top + (1 - clamp(w, 0, maxW) / maxW) * plotH;
    }

    function yPct(pct) {
      return pad.top + (1 - clamp(pct, 0, 100) / 100) * plotH;
    }

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      class: 'chart-svg',
      role: 'img',
      'aria-label': settings.ariaLabel || '充电曲线图'
    });

    var defs = svgEl('defs');
    var clipId = 'plot-clip-' + (++uid);
    var clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('rect', {
      x: pad.left,
      y: pad.top,
      width: plotW,
      height: plotH
    }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    var gridGroup = svgEl('g', { class: 'chart-grid' });
    var ticks = compact ? 4 : 5;

    for (var i = 0; i <= ticks; i += 1) {
      var ratio = i / ticks;
      var gx = pad.left + plotW * ratio;
      var gy = pad.top + plotH * ratio;

      if (i > 0 && i < ticks) {
        gridGroup.appendChild(svgEl('line', {
          x1: pad.left,
          y1: gy,
          x2: pad.left + plotW,
          y2: gy,
          class: 'chart-grid-line'
        }));
        gridGroup.appendChild(svgEl('line', {
          x1: gx,
          y1: pad.top,
          x2: gx,
          y2: pad.top + plotH,
          class: 'chart-grid-line'
        }));
      }

      axisLabel(
        gridGroup,
        pad.left - 8,
        gy + 3,
        formatNumber((hasPower ? maxW : 100) * (1 - ratio)),
        'end',
        'chart-axis-label chart-axis-y'
      );
      axisLabel(gridGroup, gx, height - 26, formatNumber(maxT * ratio), 'middle', 'chart-axis-label chart-axis-x');
      if (hasPower) {
        axisLabel(gridGroup, pad.left + plotW + 8, gy + 3, formatNumber(100 * (1 - ratio)), 'start', 'chart-axis-label chart-axis-pct');
      }
    }

    axisLabel(gridGroup, pad.left, height - 5, 'TIME / MIN', 'start', 'chart-axis-caption');
    axisLabel(gridGroup, pad.left, pad.top - 9, hasPower ? 'POWER / W' : 'BATTERY / %', 'start', 'chart-axis-caption');
    if (hasPower) {
      axisLabel(gridGroup, width - 4, pad.top - 9, 'BATTERY / %', 'end', 'chart-axis-caption');
    }
    svg.appendChild(gridGroup);

    var areaGroup = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' });
    var lineGroup = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' });

    validSeries.forEach(function (item, index) {
      var gradientId = 'curve-fill-' + (++uid);
      var gradient = svgEl('linearGradient', {
        id: gradientId,
        x1: '0',
        y1: '0',
        x2: '0',
        y2: '1'
      });
      gradient.appendChild(svgEl('stop', {
        offset: '0%',
        'stop-color': item.color,
        'stop-opacity': index === 0 ? '0.2' : '0.08'
      }));
      gradient.appendChild(svgEl('stop', {
        offset: '100%',
        'stop-color': item.color,
        'stop-opacity': '0'
      }));
      defs.appendChild(gradient);

      var seriesHasPower = item.points.some(function (point) { return point.w != null; });
      var showPct = item.showPct !== false;
      var powerCoords = item.points
        .filter(function (point) { return point.w != null; })
        .map(function (point) {
          return { x: xScale(point.t), y: yPower(point.w) };
        });
      var pctCoords = item.points.map(function (point) {
        return { x: xScale(point.t), y: yPct(point.pct) };
      });

      var powerPath = pathFromPoints(powerCoords);
      var pctPath = pathFromPoints(pctCoords);
      var areaCoords = seriesHasPower ? powerCoords : pctCoords;

      if (index === 0 && areaCoords.length > 1) {
        var areaPath = (seriesHasPower ? powerPath : pctPath) +
          'L' + areaCoords[areaCoords.length - 1].x.toFixed(2) + ',' + (pad.top + plotH).toFixed(2) +
          'L' + areaCoords[0].x.toFixed(2) + ',' + (pad.top + plotH).toFixed(2) + 'Z';
        areaGroup.appendChild(svgEl('path', {
          d: areaPath,
          fill: 'url(#' + gradientId + ')',
          stroke: 'none'
        }));
      }

      if (showPct) {
        lineGroup.appendChild(svgEl('path', {
          d: pctPath,
          fill: 'none',
          stroke: item.color,
          'stroke-width': index === 0 ? '2.1' : '1.7',
          'stroke-opacity': '0.95',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke'
        }));
      }

      if (seriesHasPower && powerCoords.length) {
        lineGroup.appendChild(svgEl('path', {
          d: powerPath,
          fill: 'none',
          stroke: item.color,
          'stroke-width': '1.7',
          'stroke-dasharray': '5 4',
          'stroke-opacity': '0.95',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke'
        }));
      }

      var last = areaCoords[areaCoords.length - 1];
      if (last) {
        lineGroup.appendChild(svgEl('circle', {
          cx: last.x,
          cy: last.y,
          r: 2.7,
          fill: item.color,
          stroke: 'var(--bg-soft)',
          'stroke-width': '1.4'
        }));
      }
    });

    svg.appendChild(areaGroup);
    svg.appendChild(lineGroup);

    var hoverGroup = svgEl('g', { class: 'chart-hover', opacity: '0' });
    var hoverLine = svgEl('line', {
      y1: pad.top,
      y2: pad.top + plotH,
      class: 'chart-hover-line'
    });
    hoverGroup.appendChild(hoverLine);
    var hoverDots = validSeries.map(function (item) {
      var dot = svgEl('circle', {
        r: 3.3,
        fill: item.color,
        stroke: 'var(--bg-soft)',
        'stroke-width': '1.4',
        class: 'chart-hover-dot'
      });
      hoverGroup.appendChild(dot);
      return dot;
    });
    svg.appendChild(hoverGroup);

    container.appendChild(svg);

    var tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('aria-hidden', 'true');
    container.appendChild(tooltip);

    function updateTooltip(clientX, clientY) {
      var rect = svg.getBoundingClientRect();
      var localX = clamp(clientX - rect.left, pad.left, pad.left + plotW);
      var localY = clamp(clientY - rect.top, pad.top, pad.top + plotH);
      var time = ((localX - pad.left) / plotW) * maxT;

      var px = xScale(time);
      hoverLine.setAttribute('x1', px);
      hoverLine.setAttribute('x2', px);
      hoverGroup.setAttribute('opacity', '1');

      var rows = '';
      var tooltipLimit = settings.tooltipLimit || 4;
      var shownSeries = 0;
      var multiSeries = validSeries.length > 1;
      validSeries.forEach(function (item, index) {
        var point = interpolate(item.points, time);
        if (!point) return;
        var seriesHasPower = item.points.some(function (p) { return p.w != null; });
        var dotY = seriesHasPower && point.w != null ? yPower(point.w) : yPct(point.pct);
        hoverDots[index].setAttribute('cx', px);
        hoverDots[index].setAttribute('cy', dotY);

        if (shownSeries >= tooltipLimit) return;
        shownSeries += 1;

        if (seriesHasPower) {
          rows +=
            '<div class="tt-row" style="--tt-color:' + safeColor(item.color) + '">' +
              '<i></i><span>' + (multiSeries ? escapeHTML(item.label) + ' · ' : '') + '功率</span>' +
              '<strong>' + (point.w == null ? '—' : formatNumber(point.w, 1) + ' W') + '</strong>' +
            '</div>';
        }
        if (item.showPct !== false) {
          rows +=
            '<div class="tt-row" style="--tt-color:' + safeColor(item.color) + '">' +
              '<i></i><span>' + (multiSeries ? escapeHTML(item.label) + ' · ' : '') + '电量</span>' +
              '<strong>' + formatNumber(point.pct, 0) + ' %</strong>' +
            '</div>';
        }
      });
      if (validSeries.length > tooltipLimit) {
        rows += '<div class="tt-more">还有 ' + (validSeries.length - tooltipLimit) + ' 条曲线</div>';
      }

      tooltip.innerHTML =
        '<div class="tt-time">' + formatNumber(time, 1) + ' MIN</div>' + rows;
      tooltip.classList.add('is-visible');

      var ttWidth = tooltip.offsetWidth || 150;
      var ttHeight = tooltip.offsetHeight || 90;
      var gap = 14;
      var left = localX + gap;
      if (left + ttWidth > width - 8) left = localX - ttWidth - gap;
      left = clamp(left, 8, Math.max(8, width - ttWidth - 8));
      var top = localY + gap;
      if (top + ttHeight > height - 8) top = localY - ttHeight - gap;
      top = clamp(top, 8, Math.max(8, height - ttHeight - 8));
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function hideTooltip() {
      hoverGroup.setAttribute('opacity', '0');
      tooltip.classList.remove('is-visible');
    }

    svg.addEventListener('pointermove', function (event) {
      updateTooltip(event.clientX, event.clientY);
    });
    svg.addEventListener('pointerdown', function (event) {
      updateTooltip(event.clientX, event.clientY);
    });
    svg.addEventListener('pointerleave', hideTooltip);
    svg.addEventListener('pointercancel', hideTooltip);
    svg.addEventListener('touchstart', function (event) {
      if (event.touches && event.touches[0]) {
        updateTooltip(event.touches[0].clientX, event.touches[0].clientY);
      }
    }, { passive: true });

    if (!container._atlasResizeBound) {
      container._atlasResizeBound = true;
      var timer = null;
      window.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (container._atlasLastSeries) {
            renderCurveChart(container, container._atlasLastSeries, container._atlasLastOptions);
          }
        }, 160);
      });
    }

    container._atlasLastSeries = validSeries;
    container._atlasLastOptions = settings;
  }

  function sparkline(points, color, options) {
    var settings = options || {};
    var normalized = normalizePoints(points);
    var safe = safeColor(color, '#0067C0');
    var width = settings.width || 300;
    var height = settings.height || 54;

    if (!normalized.length) {
      return '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M0 ' + (height - 12) + 'H' + width + '" stroke="' + safe + '" stroke-opacity=".2" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>' +
        '</svg>';
    }

    var maxT = normalized[normalized.length - 1].t || 1;
    var hasPower = normalized.some(function (point) { return point.w != null; });
    var maxValue = hasPower
      ? nicePower(normalized.reduce(function (max, p) { return Math.max(max, p.w == null ? 0 : p.w); }, 0))
      : 100;
    var coords = normalized.map(function (point) {
      var value = hasPower && point.w != null ? point.w : point.pct;
      return {
        x: (point.t / maxT) * width,
        y: height - 5 - (value / maxValue) * (height - 12)
      };
    });
    var path = pathFromPoints(coords);
    var id = 'spark-' + (++uid);
    var area = path + 'L' + width + ',' + height + 'L0,' + height + 'Z';

    return '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + safe + '" stop-opacity=".22"/>' +
      '<stop offset="100%" stop-color="' + safe + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + id + ')"/>' +
      '<path d="' + path + '" fill="none" stroke="' + safe + '" stroke-width="1.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '</svg>';
  }

  global.AtlasCharts = {
    renderCurveChart: renderCurveChart,
    sparkline: sparkline,
    formatNumber: formatNumber,
    normalizePoints: normalizePoints
  };
})(window);
