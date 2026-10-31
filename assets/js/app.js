/* =========================================================
   电库图鉴 / POWERBANK ATLAS
   Data-driven interactions: filters, curves, compare, detail.
   ========================================================= */

(function () {
  'use strict';

  var DATA_URL = 'data/powerbanks.json?v=17';
  var MAX_COMPARE = 3;
  var COMPARE_KEY = 'atlas-compare';
  var FALLBACK_BRANDS = [
    {
      id: 'cuktech',
      name: '酷态科',
      nameEn: 'CUKTECH',
      accent: '#0067C0',
      website: 'https://cuktech.com.cn',
      description: '酷态科（CUKTECH）产品档案，关注高功率充放电、多协议兼容与真实曲线表现。'
    },
    {
      id: 'anker',
      name: '安克',
      nameEn: 'ANKER',
      accent: '#0086B3',
      website: 'https://www.anker.com.cn',
      description: null
    }
  ];
  var SERIES_COLORS = ['#0067C0', '#0086B3', '#8764B8', '#CA5010', '#C239B3'];
  var CURVE_PALETTE = ['#0067C0', '#0086B3', '#8764B8', '#CA5010', '#C239B3', '#0F7B0F', '#9D5D00', '#C42B1C', '#4CC2FF', '#00B294', '#7A7574', '#E3008C'];
  var numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
  var decimalFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

  var state = {
    data: { meta: {}, brands: FALLBACK_BRANDS.slice(), devices: [] },
    loaded: false,
    loadError: null,
    filter: 'all',
    query: '',
    sort: 'default',
    libraryView: 'cards',
    curveKind: 'all',
    curveSort: 'default',
    compare: [],
    chartMode: 'charge',
    labDeviceId: null,
    detailId: null,
    lastFocus: null
  };

  var els = {};
  var labPlaceholder = '';
  var labLegendDefault = '';
  var curvePlaceholder = '';
  var schemaRaw = '';
  var copyButtonDefault = '';
  var toastTimer = null;

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
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
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : (fallback || '#0067C0');
  }

  function safeAssetUrl(value) {
    var url = typeof value === 'string' ? value.trim() : '';
    if (!url || /^(javascript|data|vbscript):/i.test(url)) return '';
    if (/^(assets\/|\.\/|\.\.\/)/.test(url)) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  function safeLink(value) {
    var url = typeof value === 'string' ? value.trim() : '';
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  function asNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function asString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function arrayOfStrings(value) {
    return Array.isArray(value)
      ? value.filter(function (item) { return typeof item === 'string' && item.trim(); }).map(function (item) { return item.trim(); })
      : [];
  }

  function fmt(value, digits) {
    var number = asNumber(value);
    if (number === null) return '—';
    return digits === 1 ? decimalFormatter.format(number) : numberFormatter.format(number);
  }

  function padCount(value) {
    var number = Number(value) || 0;
    return number < 10 ? '0' + number : String(number);
  }

  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getBrand(brandId) {
    var found = state.data.brands.filter(function (brand) { return brand.id === brandId; })[0];
    if (found) return found;
    return {
      id: brandId || 'unknown',
      name: brandId || '未知品牌',
      nameEn: '',
      accent: '#0067C0',
      website: null,
      description: null
    };
  }

  function getDevice(id) {
    return state.data.devices.filter(function (device) { return device.id === id; })[0] || null;
  }

  function readCompare() {
    try {
      var stored = JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]');
      return Array.isArray(stored) ? stored.filter(function (id) { return typeof id === 'string'; }).slice(0, MAX_COMPARE) : [];
    } catch (error) {
      return [];
    }
  }

  function saveCompare() {
    try {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(state.compare));
    } catch (error) {}
  }

  function getCurves(device, kind) {
    if (!device) return [];
    return device.curves.filter(function (curve) {
      return !kind || curve.kind === kind;
    });
  }

  function curveColor(device, index) {
    var brand = getBrand(device.brandId);
    if (index === 0) return safeColor(brand.accent);
    return SERIES_COLORS[index % SERIES_COLORS.length];
  }

  function valueAt(points, time) {
    if (!points || !points.length) return null;
    if (time <= points[0].t) return points[0].pct;
    var last = points[points.length - 1];
    if (time >= last.t) return last.pct;
    for (var i = 1; i < points.length; i += 1) {
      if (points[i].t >= time) {
        var a = points[i - 1];
        var b = points[i];
        var span = b.t - a.t || 1;
        return a.pct + (b.pct - a.pct) * ((time - a.t) / span);
      }
    }
    return last.pct;
  }

  function primaryCurve(device, kind) {
    var curves = getCurves(device, kind);
    return curves.length ? curves[0] : null;
  }

  function deviceCurveCount(device) {
    return device.curves.filter(function (curve) { return curve.points.length > 0; }).length;
  }

  function totalCurveCount() {
    return state.data.devices.reduce(function (total, device) {
      return total + deviceCurveCount(device);
    }, 0);
  }

  function normalizeBrand(raw) {
    var id = slugify(raw && raw.id) || 'brand';
    return {
      id: id,
      name: asString(raw && raw.name, id),
      nameEn: asString(raw && raw.nameEn, id.toUpperCase()),
      accent: safeColor(raw && raw.accent, '#0067C0'),
      website: safeLink(raw && raw.website) || null,
      description: asString(raw && raw.description, '') || null
    };
  }

  function normalizeDevice(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var model = asString(raw.model);
    if (!model) return null;
    var id = slugify(raw.id) || ('device-' + (index + 1));
    var specs = raw.specs && typeof raw.specs === 'object' ? raw.specs : {};
    var dimensions = specs.dimensionsMm && typeof specs.dimensionsMm === 'object' ? specs.dimensionsMm : {};
    var curves = Array.isArray(raw.curves) ? raw.curves.map(function (curve, curveIndex) {
      if (!curve || typeof curve !== 'object') return null;
      var points = window.AtlasCharts.normalizePoints(curve.points);
      if (!points.length) return null;
      var conditions = curve.conditions && typeof curve.conditions === 'object' ? curve.conditions : {};
      var summary = curve.summary && typeof curve.summary === 'object' ? curve.summary : {};
      return {
        id: asString(curve.id, 'curve-' + (curveIndex + 1)),
        kind: curve.kind === 'discharge' ? 'discharge' : 'charge',
        label: asString(curve.label, curve.kind === 'discharge' ? '放电曲线' : '充电曲线'),
        conditions: {
          ambientC: asNumber(conditions.ambientC),
          startPct: asNumber(conditions.startPct),
          endPct: asNumber(conditions.endPct),
          charger: asString(conditions.charger, '') || null,
          cable: asString(conditions.cable, '') || null,
          note: asString(conditions.note, '') || null
        },
        points: points,
        summary: {
          peakW: asNumber(summary.peakW),
          averageW: asNumber(summary.averageW)
        },
        showPct: curve.showPct !== false
      };
    }).filter(Boolean) : [];

    return {
      id: id,
      brandId: asString(raw.brandId, 'unknown'),
      model: model,
      aliases: arrayOfStrings(raw.aliases),
      releaseYear: asNumber(raw.releaseYear),
      status: raw.status === 'draft' ? 'draft' : 'published',
      tags: arrayOfStrings(raw.tags),
      images: arrayOfStrings(raw.images).map(safeAssetUrl).filter(Boolean),
      specs: {
        capacityMah: asNumber(specs.capacityMah),
        ratedCapacityMah: asNumber(specs.ratedCapacityMah),
        energyWh: asNumber(specs.energyWh),
        inputMaxW: asNumber(specs.inputMaxW),
        outputMaxW: asNumber(specs.outputMaxW),
        ports: Array.isArray(specs.ports) ? specs.ports.filter(function (port) {
          return port && typeof port === 'object';
        }).map(function (port) {
          return {
            type: asString(port.type, '接口'),
            count: asNumber(port.count),
            maxW: asNumber(port.maxW)
          };
        }) : [],
        protocols: arrayOfStrings(specs.protocols),
        weightG: asNumber(specs.weightG),
        dimensionsMm: {
          length: asNumber(dimensions.length),
          width: asNumber(dimensions.width),
          height: asNumber(dimensions.height)
        },
        priceCny: asNumber(specs.priceCny),
        cellType: asString(specs.cellType, '') || null
      },
      curves: curves,
      dischargeTests: Array.isArray(raw.dischargeTests) ? raw.dischargeTests.filter(function (test) {
        return test && typeof test === 'object';
      }).map(function (test) {
        return {
          powerW: asNumber(test.powerW),
          voltageV: asNumber(test.voltageV),
          currentA: asNumber(test.currentA),
          durationMin: asNumber(test.durationMin),
          capacityMah: asNumber(test.capacityMah),
          energyWh: asNumber(test.energyWh),
          efficiencyPct: asNumber(test.efficiencyPct)
        };
      }) : [],
      dischargeTestNote: asString(raw.dischargeTestNote, '') || null,
      notes: asString(raw.notes, '') || null,
      sources: Array.isArray(raw.sources) ? raw.sources.filter(function (source) {
        return source && typeof source === 'object' && asString(source.label);
      }).map(function (source) {
        return {
          label: asString(source.label),
          url: safeLink(source.url) || null,
          date: asString(source.date, '') || null
        };
      }) : [],
      updatedAt: asString(raw.updatedAt, '') || null
    };
  }

  function normalizeData(raw) {
    var brands = Array.isArray(raw && raw.brands)
      ? raw.brands.map(normalizeBrand)
      : FALLBACK_BRANDS.slice();
    if (!brands.length) brands = FALLBACK_BRANDS.slice();
    var devices = Array.isArray(raw && raw.devices)
      ? raw.devices.map(normalizeDevice).filter(Boolean)
      : [];
    return {
      meta: raw && raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
      brands: brands,
      devices: devices
    };
  }

  async function loadData() {
    try {
      var response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var raw = await response.json();
      state.data = normalizeData(raw);
      state.loaded = true;
      state.loadError = null;
    } catch (error) {
      state.loaded = false;
      state.loadError = error;
      state.data = normalizeData({ brands: FALLBACK_BRANDS, devices: [] });
      console.warn('[Atlas] 无法读取数据文件：', error);
    }
  }

  /* ---------- Theme ---------- */

  function updateThemeUI() {
    var isDark = document.documentElement.dataset.theme !== 'light';
    var label = isDark ? '切换到浅色主题' : '切换到深色主题';
    if (els.themeToggle) {
      els.themeToggle.setAttribute('aria-label', label);
      els.themeToggle.setAttribute('title', label);
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#202020' : '#f3f3f3');
  }

  function setupTheme() {
    updateThemeUI();
    if (!els.themeToggle) return;
    els.themeToggle.addEventListener('click', function () {
      var next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('atlas-theme', next);
      } catch (error) {}
      updateThemeUI();
      showToast(next === 'light' ? '已切换到浅色主题' : '已切换到深色主题');
    });
  }

  /* ---------- Mobile menu / navigation ---------- */

  function closeMobileMenu() {
    if (!els.mobileMenu || !els.menuToggle) return;
    els.mobileMenu.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
    els.menuToggle.setAttribute('aria-label', '打开菜单');
  }

  function setupMobileMenu() {
    if (!els.menuToggle || !els.mobileMenu) return;
    els.menuToggle.addEventListener('click', function () {
      var willOpen = els.mobileMenu.hidden;
      els.mobileMenu.hidden = !willOpen;
      els.menuToggle.setAttribute('aria-expanded', String(willOpen));
      els.menuToggle.setAttribute('aria-label', willOpen ? '关闭菜单' : '打开菜单');
    });
    $$('a', els.mobileMenu).forEach(function (link) {
      link.addEventListener('click', closeMobileMenu);
    });
    document.addEventListener('click', function (event) {
      if (els.mobileMenu.hidden) return;
      if (!event.target.closest('#mobileMenu') && !event.target.closest('#menuToggle')) {
        closeMobileMenu();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1000) closeMobileMenu();
    });
  }

  function setupHeaderAutoHide() {
    var header = document.querySelector('.site-header');
    if (!header) return;
    var lastY = window.pageYOffset || 0;
    var ticking = false;

    function showHeader() {
      header.classList.remove('is-hidden');
    }

    function update() {
      var y = window.pageYOffset || 0;
      var menuOpen = els.mobileMenu && !els.mobileMenu.hidden;
      if (menuOpen) showHeader();
      else if (y <= 40) showHeader();
      else if (y > lastY + 6) header.classList.add('is-hidden');
      else if (y < lastY - 6) showHeader();
      lastY = y;
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });

    if (els.menuToggle) els.menuToggle.addEventListener('click', showHeader);
    header.addEventListener('focusin', showHeader);
  }

  function setupNavSpy() {
    if (!('IntersectionObserver' in window)) return;
    var sections = ['library', 'curves', 'compare', 'schema']
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    if (!sections.length) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        $$('[data-nav]').forEach(function (link) {
          var active = link.getAttribute('href') === '#' + entry.target.id;
          link.classList.toggle('is-active', active);
          if (active) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-32% 0px -58% 0px', threshold: 0 });
    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ---------- Rendering: overview ---------- */

  function renderOverview() {
    var deviceCount = state.data.devices.length;
    var curveCount = totalCurveCount();
    var brandCount = state.data.brands.length;

    $$('[data-stat="devices"]').forEach(function (node) { node.textContent = padCount(deviceCount); });
    $$('[data-stat="curves"]').forEach(function (node) { node.textContent = padCount(curveCount); });
    $$('[data-stat="brands"]').forEach(function (node) { node.textContent = padCount(brandCount); });
    $$('[data-library-count]').forEach(function (node) { node.textContent = padCount(deviceCount); });
    $$('[data-view-count="cards"]').forEach(function (node) { node.textContent = padCount(deviceCount); });
    $$('[data-view-count="curves"]').forEach(function (node) { node.textContent = padCount(curveCount); });

    if (els.headerStatusText) {
      els.headerStatusText.textContent = state.loadError
        ? '数据读取失败'
        : (deviceCount ? padCount(deviceCount) + ' 份档案' : '档案就绪');
    }

    $$('[data-filter-count="all"]').forEach(function (node) { node.textContent = deviceCount; });
    state.data.brands.forEach(function (brand) {
      var count = state.data.devices.filter(function (device) { return device.brandId === brand.id; }).length;
      $$('[data-filter-count="' + brand.id + '"]').forEach(function (node) { node.textContent = count; });
      $$('[data-brand-count="' + brand.id + '"]').forEach(function (node) { node.textContent = padCount(count); });
      $$('[data-brand-copy="' + brand.id + '"]').forEach(function (node) {
        node.textContent = brand.description || '品牌故事待补充。这里为品牌介绍、代表技术与档案索引预留位置。';
      });
    });

  }

  function syncFilterPills() {
    $$('[data-filter]').forEach(function (button) {
      var active = button.getAttribute('data-filter') === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyUrlState() {
    var params = new URLSearchParams(window.location.search);
    var brand = params.get('brand');
    if (brand && state.data.brands.some(function (item) { return item.id === brand; })) {
      state.filter = brand;
    }
    var query = params.get('q');
    if (query) state.query = query;
    if (params.get('view') === 'curves') state.libraryView = 'curves';
    syncFilterPills();
    if (els.searchInput && state.query) els.searchInput.value = state.query;
  }

  /* ---------- Rendering: library ---------- */

  function visibleDevices() {
    var list = state.data.devices.slice();
    if (state.filter !== 'all') {
      list = list.filter(function (device) { return device.brandId === state.filter; });
    }
    var query = state.query.trim().toLowerCase();
    if (query) {
      list = list.filter(function (device) {
        var brand = getBrand(device.brandId);
        var haystack = [
          device.model,
          brand.name,
          brand.nameEn,
          device.aliases.join(' '),
          device.tags.join(' '),
          device.specs.protocols.join(' '),
          device.specs.cellType || ''
        ].join(' ').toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    if (state.sort === 'capacity-desc') {
      list.sort(function (a, b) { return (b.specs.capacityMah || 0) - (a.specs.capacityMah || 0); });
    } else if (state.sort === 'energy-desc') {
      list.sort(function (a, b) { return (b.specs.energyWh || 0) - (a.specs.energyWh || 0); });
    } else if (state.sort === 'updated-desc') {
      list.sort(function (a, b) {
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
    }
    return list;
  }

  function deviceCardHTML(device) {
    var brand = getBrand(device.brandId);
    var color = safeColor(brand.accent);
    var image = device.images[0] ? safeAssetUrl(device.images[0]) : '';
    var charge = primaryCurve(device, 'charge') || primaryCurve(device);
    var points = charge ? charge.points : [];
    var selected = state.compare.indexOf(device.id) !== -1;

    return '' +
      '<article class="device-card' + (selected ? ' is-selected' : '') + '" data-device-id="' + escapeHTML(device.id) + '" style="--brand-color:' + color + '">' +
        '<div class="device-card-top">' +
          '<span class="device-brand"><i aria-hidden="true"></i>' + escapeHTML(brand.nameEn || brand.name) + '</span>' +
          '<button class="compare-toggle" type="button" data-compare-toggle="' + escapeHTML(device.id) + '" aria-pressed="' + String(selected) + '">' +
            (selected ? '已选对比' : '加入对比') +
          '</button>' +
        '</div>' +
        (image ? '<div class="device-media"><img src="' + escapeHTML(image) + '" alt="' + escapeHTML(brand.name + ' ' + device.model) + ' 产品图" data-device-image></div>' : '') +
        '<h3>' + escapeHTML(device.model) + '</h3>' +
        '<p class="device-aliases">' + escapeHTML(device.aliases.length ? device.aliases.join(' · ') : '型号档案') + '</p>' +
        '<div class="device-metrics">' +
          '<div class="device-metric"><span>标称容量</span><strong>' + fmt(device.specs.capacityMah) + '<small>mAh</small></strong></div>' +
          '<div class="device-metric"><span>输出峰值</span><strong>' + fmt(device.specs.outputMaxW) + '<small>W</small></strong></div>' +
        '</div>' +
        '<div class="device-spark" aria-hidden="true">' + window.AtlasCharts.sparkline(points, color) + '</div>' +
        '<div class="device-card-foot">' +
          '<span>' + padCount(deviceCurveCount(device)) + ' 条曲线</span>' +
          '<a class="device-open" href="device.html?id=' + encodeURIComponent(device.id) + '">查看档案 <span aria-hidden="true">→</span></a>' +
        '</div>' +
      '</article>';
  }

  function setEmptyCopy(title, copy, filtered) {
    setText(els.emptyTitle, title);
    setText(els.emptyCopy, copy);
    if (els.libraryEmpty) els.libraryEmpty.classList.toggle('is-filtered', Boolean(filtered));
  }

  function curvePeak(curve) {
    if (curve.summary.peakW != null) return curve.summary.peakW;
    var values = curve.points.map(function (point) { return point.w; }).filter(function (value) { return value != null; });
    return values.length ? Math.max.apply(null, values) : null;
  }

  function curvePctAt(curve, minutes) {
    if (!curve.points.length) return null;
    var last = curve.points[curve.points.length - 1];
    if (last.t < minutes) return null;
    return valueAt(curve.points, minutes);
  }

  function curveFullTime(curve) {
    if (!curve.points.length) return null;
    var last = curve.points[curve.points.length - 1];
    return last.pct >= 99 ? last.t : null;
  }

  function libraryViewEntries(devices) {
    var entries = [];
    devices.forEach(function (device) {
      getCurves(device).forEach(function (curve) {
        if (state.curveKind !== 'all' && curve.kind !== state.curveKind) return;
        entries.push({
          device: device,
          curve: curve,
          peak: curvePeak(curve),
          thirty: curvePctAt(curve, 30),
          fullTime: curveFullTime(curve),
          showPct: curve.showPct !== false
        });
      });
    });

    if (state.curveSort === 'peak-desc') {
      entries.sort(function (a, b) { return (b.peak == null ? -1 : b.peak) - (a.peak == null ? -1 : a.peak); });
    } else if (state.curveSort === 'speed-desc') {
      entries.sort(function (a, b) { return (b.thirty == null ? -1 : b.thirty) - (a.thirty == null ? -1 : a.thirty); });
    } else if (state.curveSort === 'time-asc') {
      entries.sort(function (a, b) { return (a.fullTime == null ? 99999 : a.fullTime) - (b.fullTime == null ? 99999 : b.fullTime); });
    } else {
      entries.sort(function (a, b) {
        return a.device.model.localeCompare(b.device.model, 'zh-CN') || a.curve.label.localeCompare(b.curve.label, 'zh-CN');
      });
    }

    entries.forEach(function (entry, index) {
      entry.color = CURVE_PALETTE[index % CURVE_PALETTE.length];
    });
    return entries;
  }

  function curveRowsHTML(entries) {
    if (!entries.length) return '';
    return entries.map(function (entry) {
      var device = entry.device;
      return '<a class="curve-index-row" href="device.html?id=' + encodeURIComponent(device.id) + '">' +
        '<i class="curve-index-swatch" style="--curve-color:' + safeColor(entry.color) + '"></i>' +
        '<span class="curve-index-main">' +
          '<strong>' + escapeHTML(device.model) + '</strong>' +
          '<small>' + escapeHTML(entry.curve.label) + '</small>' +
        '</span>' +
        '<span class="curve-index-stat"><b>' + (entry.peak == null ? '—' : fmt(entry.peak, 1)) + '</b><small>PEAK W</small></span>' +
        (entry.showPct
          ? '<span class="curve-index-stat"><b>' + (entry.thirty == null ? '—' : fmt(entry.thirty, 0)) + '</b><small>30 MIN %</small></span>'
          : '<span class="curve-index-stat"><b>' + (entry.fullTime == null ? '—' : fmt(entry.fullTime, 0)) + '</b><small>FULL MIN</small></span>') +
      '</a>';
    }).join('');
  }

  function renderCurveExplorer(devices) {
    if (!els.allCurveChart) return;
    var entries = libraryViewEntries(devices);
    var hasPower = entries.some(function (entry) {
      return entry.curve.points.some(function (point) { return point.w != null; });
    });

    $$('[data-curve-count]').forEach(function (node) { node.textContent = padCount(entries.length); });
    $$('[data-curve-models]').forEach(function (node) {
      var unique = {};
      entries.forEach(function (entry) { unique[entry.device.id] = true; });
      node.textContent = padCount(Object.keys(unique).length);
    });
    $$('[data-curve-count-label]').forEach(function (node) { node.textContent = padCount(entries.length) + ' 条'; });
    $$('[data-curve-note]').forEach(function (node) {
      var topPeak = entries.reduce(function (max, entry) { return Math.max(max, entry.peak == null ? 0 : entry.peak); }, 0);
      node.textContent = entries.length
        ? (topPeak ? '最高峰值 ' + fmt(topPeak, 1) + ' W' : '仅电量曲线')
        : '等待曲线数据';
    });

    if (!entries.length) {
      els.allCurveChart.innerHTML = curvePlaceholder;
      if (els.allCurveLegend) els.allCurveLegend.innerHTML = '';
      if (els.curveList) els.curveList.innerHTML = '';
      if (els.curveEmpty) els.curveEmpty.hidden = false;
      return;
    }

    var series = entries.map(function (entry) {
      return {
        id: entry.device.id + ':' + entry.curve.id,
        label: entry.device.model + ' · ' + entry.curve.label,
        color: entry.color,
        points: entry.curve.points,
        showPct: entry.curve.showPct !== false
      };
    });

    window.AtlasCharts.renderCurveChart(els.allCurveChart, series, {
      ariaLabel: '全部充电宝曲线叠加图',
      tooltipLimit: 6
    });

    if (els.allCurveLegend) {
      els.allCurveLegend.innerHTML =
        (hasPower ? '<span class="legend-item"><i class="legend-line dashed"></i>功率</span>' : '') +
        '<span class="legend-item"><i class="legend-line solid"></i>电量</span>' +
        '<span class="legend-brand"><i style="--legend-color:#0067C0"></i>' + entries.length + ' 条曲线叠加</span>';
    }
    if (els.curveList) els.curveList.innerHTML = curveRowsHTML(entries);
    if (els.curveEmpty) els.curveEmpty.hidden = true;
  }

  function syncLibraryView() {
    var isCurves = state.libraryView === 'curves';
    if (els.cardView) els.cardView.hidden = isCurves;
    if (els.curveView) els.curveView.hidden = !isCurves;
    if (els.sortField) els.sortField.hidden = isCurves;
    $$('[data-library-view]').forEach(function (button) {
      var active = button.getAttribute('data-library-view') === state.libraryView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (els.curveKindFilter) els.curveKindFilter.value = state.curveKind;
    if (els.curveSort) els.curveSort.value = state.curveSort;
  }

  function renderLibrary() {
    var list = visibleDevices();
    var hasDevices = state.data.devices.length > 0;
    var hasFilter = state.filter !== 'all' || Boolean(state.query.trim());
    var brand = state.filter !== 'all' ? getBrand(state.filter) : null;

    syncLibraryView();
    if (state.libraryView === 'curves') {
      renderCurveExplorer(list);
      return;
    }

    if (els.deviceGrid) {
      els.deviceGrid.innerHTML = list.map(deviceCardHTML).join('');
      els.deviceGrid.hidden = list.length === 0;
    }

    if (els.libraryEmpty) els.libraryEmpty.hidden = list.length > 0;
    if (els.clearFilters) els.clearFilters.hidden = !hasFilter;

    if (!list.length) {
      if (hasFilter) {
        var title = state.query.trim() ? '没有找到匹配的档案。' : (brand ? brand.name + '的档案位，已经留好。' : '没有匹配的档案。');
        var copy = state.query.trim()
          ? '试试型号的简称、品牌名或关键词，也可以清除筛选，回到全部档案。'
          : '这个品牌还没有收录型号。';
        setEmptyCopy(title, copy, true);
      } else {
        setEmptyCopy('还没有收录型号。', '数据更新后会显示在这里。', false);
      }
    }
    // Keep "show all" semantics when a brand with no entries is selected.
    if (hasDevices && list.length === 0 && !hasFilter) {
      setEmptyCopy('还没有收录型号。', '数据更新后会显示在这里。', false);
    }
  }

  function setFilter(filter, options) {
    state.filter = filter;
    if (options && options.clearQuery) {
      state.query = '';
      if (els.searchInput) els.searchInput.value = '';
    }
    syncFilterPills();
    renderOverview();
    renderLibrary();
    if (options && options.scroll) {
      var target = document.getElementById('library');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function clearAllFilters() {
    state.query = '';
    if (els.searchInput) els.searchInput.value = '';
    if (els.sortSelect) els.sortSelect.value = 'default';
    state.sort = 'default';
    setFilter('all');
    showToast('已清除筛选');
  }

  function setLibraryView(view, options) {
    state.libraryView = view === 'curves' ? 'curves' : 'cards';
    try {
      var url = new URL(window.location.href);
      if (state.libraryView === 'curves') url.searchParams.set('view', 'curves');
      else url.searchParams.delete('view');
      window.history.replaceState(null, '', url);
    } catch (error) {}
    renderLibrary();
    if (options && options.scroll) {
      var target = document.getElementById('library');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function setupLibraryControls() {
    $$('[data-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        setFilter(button.getAttribute('data-filter'));
      });
    });

    $$('[data-library-view]').forEach(function (button) {
      button.addEventListener('click', function () {
        setLibraryView(button.getAttribute('data-library-view'));
      });
    });

    if (els.searchInput) {
      els.searchInput.addEventListener('input', function () {
        state.query = els.searchInput.value;
        renderLibrary();
      });
    }

    if (els.sortSelect) {
      els.sortSelect.addEventListener('change', function () {
        state.sort = els.sortSelect.value;
        renderLibrary();
      });
    }

    if (els.curveKindFilter) {
      els.curveKindFilter.addEventListener('change', function () {
        state.curveKind = els.curveKindFilter.value;
        renderLibrary();
      });
    }

    if (els.curveSort) {
      els.curveSort.addEventListener('change', function () {
        state.curveSort = els.curveSort.value;
        renderLibrary();
      });
    }

    if (els.clearFilters) els.clearFilters.addEventListener('click', clearAllFilters);
    if (els.curveClearFilters) els.curveClearFilters.addEventListener('click', clearAllFilters);
  }

  /* ---------- Curve lab ---------- */

  function setMetric(index, value, unit) {
    if (!els.metricRows || !els.metricRows[index]) return;
    var dd = els.metricRows[index].querySelector('dd');
    if (!dd) return;
    dd.innerHTML = escapeHTML(value) + '<small>' + escapeHTML(unit) + '</small>';
  }

  function resetLabMetrics() {
    setMetric(0, '—', 'W');
    setMetric(1, '—', '%');
    setMetric(2, '—', 'min');
    setMetric(3, '—', 'W');
  }

  function renderLabLegend(device, series, hasPower) {
    if (!els.labLegend) return;
    if (!device || !series.length) {
      els.labLegend.innerHTML = labLegendDefault;
      return;
    }
    var html = '<span class="legend-item"><i class="legend-line solid"></i>电量</span>';
    if (hasPower) {
      html += '<span class="legend-item"><i class="legend-line dashed"></i>功率</span>';
    }
    series.forEach(function (item) {
      html += '<span class="legend-brand"><i style="--legend-color:' + safeColor(item.color) + '"></i>' + escapeHTML(item.label) + '</span>';
    });
    els.labLegend.innerHTML = html;
  }

  function updateLabSelect(devices) {
    if (!els.labModelWrap || !els.labModelSelect) return;
    if (!devices.length) {
      els.labModelWrap.hidden = true;
      els.labModelSelect.innerHTML = '';
      return;
    }
    els.labModelWrap.hidden = false;
    els.labModelSelect.innerHTML = devices.map(function (device) {
      var brand = getBrand(device.brandId);
      return '<option value="' + escapeHTML(device.id) + '">' + escapeHTML(brand.name + ' · ' + device.model) + '</option>';
    }).join('');
    if (state.labDeviceId) els.labModelSelect.value = state.labDeviceId;
  }

  function updateChartModeButtons() {
    $$('[data-chart-mode]').forEach(function (button) {
      var mode = button.getAttribute('data-chart-mode');
      var available = state.data.devices.some(function (device) {
        return getCurves(device, mode).length > 0;
      });
      button.disabled = !available;
      button.classList.toggle('is-active', state.chartMode === mode);
      button.setAttribute('aria-pressed', String(state.chartMode === mode));
      button.title = available ? '' : '暂无' + (mode === 'charge' ? '充电' : '放电') + '曲线';
    });
  }

  function renderLab() {
    if (!els.labChart) return;
    updateChartModeButtons();

    var candidates = state.data.devices.filter(function (device) {
      return getCurves(device, state.chartMode).length > 0;
    });

    if (!candidates.length) {
      state.labDeviceId = null;
      els.labChart.innerHTML = labPlaceholder;
      updateLabSelect([]);
      setText(els.labChartTitle, state.chartMode === 'charge' ? '充电曲线' : '放电曲线');
      resetLabMetrics();
      renderLabLegend(null, [], false);
      if (els.labConditions) els.labConditions.hidden = true;
      if (els.readoutLive) {
        els.readoutLive.innerHTML = '<i aria-hidden="true"></i>WAITING';
        els.readoutLive.classList.remove('is-live');
      }
      return;
    }

    var device = candidates.filter(function (item) { return item.id === state.labDeviceId; })[0];
    if (!device) {
      device = candidates[0];
      state.labDeviceId = device.id;
    }

    updateLabSelect(candidates);
    var curves = getCurves(device, state.chartMode);
    var series = curves.map(function (curve, index) {
      return {
        id: curve.id,
        label: curve.label,
        color: curveColor(device, index),
        points: curve.points,
        showPct: curve.showPct !== false
      };
    });
    var hasPower = series.some(function (item) {
      return item.points.some(function (point) { return point.w != null; });
    });

    setText(els.labChartTitle, device.model + ' · ' + (state.chartMode === 'charge' ? '充电曲线' : '放电曲线'));
    renderLabLegend(device, series, hasPower);
    window.AtlasCharts.renderCurveChart(els.labChart, series, {
      ariaLabel: device.model + ' ' + (state.chartMode === 'charge' ? '充电' : '放电') + '曲线'
    });

    var curve = curves[0];
    var peak = curve.summary.peakW;
    if (peak == null) {
      var measured = curve.points.map(function (point) { return point.w; }).filter(function (value) { return value != null; });
      peak = measured.length ? Math.max.apply(null, measured) : null;
    }
    var average = curve.summary.averageW;
    if (average == null) {
      var values = curve.points.map(function (point) { return point.w; }).filter(function (value) { return value != null; });
      average = values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
    }
    var last = curve.points[curve.points.length - 1];
    var thirty = last.t >= 30 ? valueAt(curve.points, 30) : null;
    var fullTime = last.pct >= 99 ? last.t : null;

    setMetric(0, peak == null ? '—' : fmt(peak, 1), 'W');
    setMetric(1, thirty == null ? '—' : fmt(thirty, 0), '%');
    setMetric(2, fullTime == null ? '—' : fmt(fullTime, 0), 'min');
    setMetric(3, average == null ? '—' : fmt(average, 1), 'W');

    if (els.labConditions && els.labConditionList) {
      els.labConditions.hidden = false;
      els.labConditionList.innerHTML = conditionsHTML(curve);
    }

    if (els.readoutLive) {
      els.readoutLive.innerHTML = '<i aria-hidden="true"></i>READY';
      els.readoutLive.classList.add('is-live');
    }
  }

  function setupCurveLab() {
    $$('[data-chart-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled) return;
        state.chartMode = button.getAttribute('data-chart-mode');
        $$('[data-chart-mode]').forEach(function (item) {
          var active = item.getAttribute('data-chart-mode') === state.chartMode;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        renderLab();
      });
    });
    if (els.labModelSelect) {
      els.labModelSelect.addEventListener('change', function () {
        state.labDeviceId = els.labModelSelect.value;
        renderLab();
      });
    }
  }

  /* ---------- Compare ---------- */

  function compareValue(device, getter) {
    return getter(device);
  }

  function bestId(devices, getter) {
    if (devices.length < 2) return null;
    var values = devices.map(function (device) {
      var value = getter(device);
      return asNumber(value);
    });
    var max = Math.max.apply(null, values.filter(function (value) { return value != null; }).concat([0]));
    if (!max) return null;
    var winners = devices.filter(function (device, index) { return values[index] === max; });
    return winners.length === 1 ? winners[0].id : null;
  }

  function deviceChargeAt(device, minutes) {
    var curve = primaryCurve(device, 'charge');
    if (!curve || !curve.points.length) return null;
    var last = curve.points[curve.points.length - 1];
    if (last.t < minutes) return null;
    return valueAt(curve.points, minutes);
  }

  function deviceFullTime(device) {
    var curve = primaryCurve(device, 'charge');
    if (!curve || !curve.points.length) return null;
    var last = curve.points[curve.points.length - 1];
    return last.pct >= 99 ? last.t : null;
  }

  function portsLabel(device) {
    if (!device.specs.ports.length) return '—';
    return device.specs.ports.map(function (port) {
      return port.type + (port.maxW != null ? ' ' + fmt(port.maxW) + 'W' : '');
    }).join(' / ');
  }

  function compareTableHTML(devices) {
    devices = devices || [];
    var bestCapacity = bestId(devices, function (device) { return device.specs.capacityMah; });
    var bestEnergy = bestId(devices, function (device) { return device.specs.energyWh; });
    var bestInput = bestId(devices, function (device) { return device.specs.inputMaxW; });
    var bestOutput = bestId(devices, function (device) { return device.specs.outputMaxW; });
    var bestThirty = bestId(devices, function (device) { return deviceChargeAt(device, 30); });

    var head = '<tr><th scope="col">指标</th>';
    for (var i = 0; i < MAX_COMPARE; i += 1) {
      var device = devices[i];
      head += '<th scope="col"><span>型号 ' + String.fromCharCode(65 + i) + '</span><strong>' +
        (device ? escapeHTML(device.model) : '—') + '</strong></th>';
    }
    head += '</tr>';

    var rows = [
      {
        label: '品牌',
        value: function (device) { return escapeHTML(getBrand(device.brandId).name); }
      },
      {
        label: '标称容量',
        unit: 'mAh',
        value: function (device) { return fmt(device.specs.capacityMah); },
        best: bestCapacity
      },
      {
        label: '额定容量',
        unit: 'mAh',
        value: function (device) { return fmt(device.specs.ratedCapacityMah); }
      },
      {
        label: '能量',
        unit: 'Wh',
        value: function (device) { return fmt(device.specs.energyWh, 1); },
        best: bestEnergy
      },
      {
        label: '输入峰值',
        unit: 'W',
        value: function (device) { return fmt(device.specs.inputMaxW); },
        best: bestInput
      },
      {
        label: '输出峰值',
        unit: 'W',
        value: function (device) { return fmt(device.specs.outputMaxW); },
        best: bestOutput
      },
      {
        label: '接口',
        value: function (device) { return escapeHTML(portsLabel(device)); }
      },
      {
        label: '重量',
        unit: 'g',
        value: function (device) { return fmt(device.specs.weightG); }
      },
      {
        label: '30 分钟充入',
        unit: '%',
        value: function (device) {
          var value = deviceChargeAt(device, 30);
          return value == null ? '—' : fmt(value);
        },
        best: bestThirty
      },
      {
        label: '完整充电用时',
        unit: 'min',
        value: function (device) {
          var value = deviceFullTime(device);
          return value == null ? '—' : fmt(value);
        }
      }
    ];

    var body = rows.map(function (row) {
      var html = '<tr><th scope="row">' + escapeHTML(row.label) +
        (row.unit ? ' <small>' + escapeHTML(row.unit) + '</small>' : '') + '</th>';
      for (var index = 0; index < MAX_COMPARE; index += 1) {
        var item = devices[index];
        var isBest = item && row.best && row.best === item.id;
        html += '<td' + (isBest ? ' class="is-best"' : '') + '>' +
          (item ? row.value(item) : '—') + '</td>';
      }
      html += '</tr>';
      return html;
    }).join('');

    return '<table class="compare-table"><caption class="sr-only">充电宝型号对比表</caption>' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function compareSlotsHTML(devices) {
    var html = '';
    for (var i = 0; i < MAX_COMPARE; i += 1) {
      var device = devices[i];
      if (device) {
        html += '<div class="compare-slot is-filled">' +
          '<span class="compare-slot-plus">' + padCount(i + 1) + '</span>' +
          '<span><strong>' + escapeHTML(device.model) + '</strong><small>' + escapeHTML(getBrand(device.brandId).name) + '</small></span>' +
          '<button class="compare-slot-remove" type="button" data-compare-remove="' + escapeHTML(device.id) + '" aria-label="从对比中移除 ' + escapeHTML(device.model) + '">✕</button>' +
          '</div>';
      } else {
        html += '<button class="compare-slot is-empty" type="button" data-compare-add>' +
          '<span class="compare-slot-plus" aria-hidden="true">+</span>' +
          '<span><strong>型号 ' + String.fromCharCode(65 + i) + '</strong><small>从型号库添加</small></span>' +
          '</button>';
      }
    }
    return html;
  }

  function selectedDevices() {
    return state.compare.map(getDevice).filter(Boolean);
  }

  function renderCompare() {
    var devices = selectedDevices();
    if (els.compareSlots) els.compareSlots.innerHTML = compareSlotsHTML(devices);
    if (els.compareTableWrap) {
      els.compareTableWrap.innerHTML = devices.length
        ? compareTableHTML(devices)
        : '<div class="compare-empty">' +
            '<p>选两款型号，容量、能量、接口和曲线读数会在这里并排展开。</p>' +
            '<span class="compare-empty-hint">↑ 从上方空位或型号卡片加入对比</span>' +
          '</div>';
    }
    if (els.compareHint) {
      setText(els.compareHint, devices.length === 0
        ? '对比席空闲中。先从型号库选择 2–3 款。'
        : (devices.length === 1 ? '已选 1 款，再选 1 款就可以开始对表。' : '已选 ' + devices.length + ' 款，数据已并排显示。'));
    }
    if (els.compareClear) els.compareClear.disabled = devices.length === 0;
    renderCompareDock(devices);
  }

  function renderCompareDock(devices) {
    if (!els.compareDock) return;
    if (!devices.length) {
      els.compareDock.hidden = true;
      return;
    }
    els.compareDock.hidden = false;
    setText(els.compareCount, String(devices.length));
    if (els.compareChips) {
      els.compareChips.innerHTML = devices.map(function (device) {
        return '<span class="compare-chip"><span>' + escapeHTML(device.model) + '</span>' +
          '<button type="button" data-dock-remove="' + escapeHTML(device.id) + '" aria-label="移除 ' + escapeHTML(device.model) + '">✕</button></span>';
      }).join('');
    }
  }

  function syncDossierCompare() {
    if (!els.dossierCompare) return;
    var id = els.dossierCompare.getAttribute('data-device-id');
    var selected = id && state.compare.indexOf(id) !== -1;
    els.dossierCompare.textContent = selected ? '已加入对比 ✓' : '加入对比';
    els.dossierCompare.setAttribute('aria-pressed', String(Boolean(selected)));
    els.dossierCompare.classList.toggle('is-active', Boolean(selected));
  }

  function toggleCompare(id) {
    var index = state.compare.indexOf(id);
    if (index !== -1) {
      state.compare.splice(index, 1);
    } else {
      if (state.compare.length >= MAX_COMPARE) {
        showToast('最多同时对比 ' + MAX_COMPARE + ' 款');
        return;
      }
      state.compare.push(id);
    }
    saveCompare();
    renderLibrary();
    renderCompare();
    renderOverview();
    syncDossierCompare();
  }

  function setupCompare() {
    if (els.compareSlots) {
      els.compareSlots.addEventListener('click', function (event) {
        var remove = event.target.closest('[data-compare-remove]');
        if (remove) {
          toggleCompare(remove.getAttribute('data-compare-remove'));
          return;
        }
        var add = event.target.closest('[data-compare-add]');
        if (add) window.location.href = 'index.html?view=cards';
      });
    }

    if (els.dossierCompare) {
      els.dossierCompare.addEventListener('click', function () {
        var id = els.dossierCompare.getAttribute('data-device-id');
        if (id) toggleCompare(id);
      });
    }

    if (els.compareClear) {
      els.compareClear.addEventListener('click', function () {
        if (!state.compare.length) return;
        state.compare = [];
        saveCompare();
        renderLibrary();
        renderCompare();
        showToast('已清空对比');
      });
    }

    if (els.compareDock) {
      els.compareDock.addEventListener('click', function (event) {
        var remove = event.target.closest('[data-dock-remove]');
        if (remove) {
          toggleCompare(remove.getAttribute('data-dock-remove'));
          return;
        }
        if (event.target.closest('#compareDockClear')) {
          state.compare = [];
          saveCompare();
          renderLibrary();
          renderCompare();
          return;
        }
      });
    }
  }

  /* ---------- Device detail modal ---------- */

  function specRows(device) {
    var specs = device.specs;
    var dimensions = specs.dimensionsMm;
    var dimensionText = [dimensions.length, dimensions.width, dimensions.height].some(function (value) { return value != null; })
      ? [dimensions.length, dimensions.width, dimensions.height].map(function (value) { return value == null ? '—' : fmt(value, 1); }).join(' × ') + ' mm'
      : '—';

    return [
      ['额定容量', specs.ratedCapacityMah == null ? '—' : fmt(specs.ratedCapacityMah) + ' mAh'],
      ['能量', specs.energyWh == null ? '—' : fmt(specs.energyWh, 1) + ' Wh'],
      ['输入峰值', specs.inputMaxW == null ? '—' : fmt(specs.inputMaxW) + ' W'],
      ['输出峰值', specs.outputMaxW == null ? '—' : fmt(specs.outputMaxW) + ' W'],
      ['接口', portsLabel(device)],
      ['协议', specs.protocols.length ? specs.protocols.join(' · ') : '—'],
      ['重量', specs.weightG == null ? '—' : fmt(specs.weightG) + ' g'],
      ['尺寸', dimensionText],
      ['电芯', specs.cellType || '—'],
      ['价格', specs.priceCny == null ? '—' : '¥ ' + fmt(specs.priceCny)]
    ];
  }

  function fmtFixed(value, digits) {
    var number = asNumber(value);
    if (number === null) return '—';
    return number.toFixed(digits);
  }

  function durationLabel(minutes) {
    var total = asNumber(minutes);
    if (total === null) return '—';
    total = Math.round(total);
    var hours = Math.floor(total / 60);
    var mins = total % 60;
    return hours ? hours + ' 小时 ' + (mins < 10 ? '0' + mins : mins) + ' 分' : total + ' 分';
  }

  function dischargeTestsHTML(device) {
    var tests = device.dischargeTests || [];
    if (!tests.length) return '';
    return '<section class="modal-tests">' +
      '<div class="modal-tests-head">' +
        '<div><h3>恒流放电</h3></div>' +
        (device.dischargeTestNote ? '<p>' + escapeHTML(device.dischargeTestNote) + '</p>' : '') +
      '</div>' +
      '<div class="test-table-wrap"><table class="test-table">' +
        '<thead><tr><th scope="col">放电功率</th><th scope="col">放电时长</th><th scope="col">放电容量</th><th scope="col">放电能量</th><th scope="col">转换效率</th></tr></thead>' +
        '<tbody>' + tests.map(function (test) {
          return '<tr>' +
            '<td><strong>' + (test.powerW == null ? '—' : fmt(test.powerW) + ' W') + '</strong>' +
              (test.voltageV != null && test.currentA != null ? '<small>' + fmt(test.voltageV) + 'V / ' + fmt(test.currentA) + 'A</small>' : '') + '</td>' +
            '<td>' + durationLabel(test.durationMin) + '</td>' +
            '<td>' + (test.capacityMah == null ? '—' : fmt(test.capacityMah) + ' mAh') + '</td>' +
            '<td>' + (test.energyWh == null ? '—' : fmtFixed(test.energyWh, 2) + ' Wh') + '</td>' +
            '<td>' + (test.efficiencyPct == null ? '—' : fmtFixed(test.efficiencyPct, 2) + ' %') + '</td>' +
          '</tr>';
        }).join('') + '</tbody>' +
      '</table></div>' +
    '</section>';
  }

  function conditionsHTML(curve) {
    if (!curve) return '<li><span>测试条件</span><span>—</span></li>';
    var conditions = curve.conditions;
    var rows = [
      ['充电器', conditions.charger || '—'],
      ['线材', conditions.cable || '—'],
      ['环境温度', conditions.ambientC == null ? '—' : fmt(conditions.ambientC, 1) + ' °C'],
      ['起止电量', conditions.startPct == null && conditions.endPct == null
        ? '—'
        : (conditions.startPct == null ? '—' : fmt(conditions.startPct)) + ' → ' + (conditions.endPct == null ? '—' : fmt(conditions.endPct)) + '%']
    ];
    if (conditions.note) rows.push(['备注', conditions.note]);
    return rows.map(function (row) {
      return '<li><span>' + escapeHTML(row[0]) + '</span><span>' + escapeHTML(row[1]) + '</span></li>';
    }).join('');
  }

  function tagsHTML(device) {
    var tags = [];
    if (device.status === 'draft') tags.push('<span class="modal-tag is-status">草稿</span>');
    if (device.releaseYear) tags.push('<span class="modal-tag">' + escapeHTML(String(device.releaseYear)) + '</span>');
    device.tags.forEach(function (tag) {
      tags.push('<span class="modal-tag">' + escapeHTML(tag) + '</span>');
    });
    return tags.join('');
  }

  function renderDetail(device, target) {
    var container = target || els.modalBody;
    if (!container) return;
    var brand = getBrand(device.brandId);
    var color = safeColor(brand.accent);
    var image = device.images[0] ? safeAssetUrl(device.images[0]) : '';
    var chargeCurves = getCurves(device, 'charge');
    var curves = chargeCurves.length ? chargeCurves : getCurves(device, 'discharge');
    var curve = curves[0] || null;
    var series = curves.map(function (item, index) {
      return {
        id: item.id,
        label: item.label,
        color: curveColor(device, index),
        points: item.points,
        showPct: item.showPct !== false
      };
    });
    var hasPower = series.some(function (item) {
      return item.points.some(function (point) { return point.w != null; });
    });
    var chartKind = chargeCurves.length ? '充电' : '放电';
    var sources = device.sources.length
      ? device.sources.map(function (source) {
        var url = safeLink(source.url);
        var label = escapeHTML(source.label) + (source.date ? ' · ' + escapeHTML(source.date) : '');
        return '<li>' + (url ? '<a href="' + escapeHTML(url) + '" target="_blank" rel="noopener">' + label + ' ↗</a>' : '<span>' + label + '</span>') + '</li>';
      }).join('')
      : '<li><span>来源待补充</span></li>';

    container.innerHTML = '' +
      '<header class="modal-hero" style="--brand-color:' + color + '">' +
        '<div class="modal-hero-grid">' +
          '<div>' +
            '<span class="modal-brand"><i aria-hidden="true"></i>' + escapeHTML(brand.nameEn ? brand.name + ' / ' + brand.nameEn : brand.name) + '</span>' +
            '<h2 id="modalTitle">' + escapeHTML(device.model) + '</h2>' +
            (device.aliases.length ? '<p class="modal-aliases">' + escapeHTML(device.aliases.join(' · ')) + '</p>' : '') +
            '<div class="modal-tags">' + tagsHTML(device) + '</div>' +
          '</div>' +
          (image ? '<div class="modal-hero-media"><img src="' + escapeHTML(image) + '" alt="' + escapeHTML(device.model) + ' 产品图" data-device-image></div>' : '') +
        '</div>' +
      '</header>' +
      '<div class="modal-content">' +
        '<div class="modal-metrics">' +
          '<div class="modal-metric"><span>标称容量</span><strong>' + fmt(device.specs.capacityMah) + '<small>mAh</small></strong></div>' +
          '<div class="modal-metric"><span>能量</span><strong>' + fmt(device.specs.energyWh, 1) + '<small>Wh</small></strong></div>' +
          '<div class="modal-metric"><span>输入峰值</span><strong>' + fmt(device.specs.inputMaxW) + '<small>W</small></strong></div>' +
          '<div class="modal-metric"><span>输出峰值</span><strong>' + fmt(device.specs.outputMaxW) + '<small>W</small></strong></div>' +
        '</div>' +
        '<div class="modal-chart-box">' +
          '<div class="modal-chart-head">' +
            '<div><h3>' + escapeHTML(curve ? curve.label : '曲线待补充') + '</h3></div>' +
          '</div>' +
          (series.length > 1 ? '<div class="modal-chart-legend">' + series.map(function (item) {
            return '<span><i style="--legend-color:' + safeColor(item.color) + '"></i>' + escapeHTML(item.label) + '</span>';
          }).join('') + '</div>' : '') +
          (series.length
            ? '<div class="modal-chart-stage" id="modalChartStage"></div>' +
              (!hasPower ? '<p class="chart-condition modal-chart-note">当前曲线只记录电量节点；峰值与平均功率来自测试摘要，功率曲线待补充。</p>' : '')
            : '<div class="modal-empty-chart">这款型号还没有录入曲线</div>') +
        '</div>' +
        '<div class="modal-columns">' +
          '<section>' +
            '<h3 class="modal-section-title">规格</h3>' +
            '<table class="spec-table"><tbody>' +
              specRows(device).map(function (row) {
                return '<tr><th scope="row">' + escapeHTML(row[0]) + '</th><td>' + escapeHTML(row[1]) + '</td></tr>';
              }).join('') +
            '</tbody></table>' +
          '</section>' +
          '<section>' +
            '<h3 class="modal-section-title">测试条件</h3>' +
            '<ul class="condition-list">' + conditionsHTML(curve) + '</ul>' +
            '<h3 class="modal-section-title modal-source-title">来源</h3>' +
            '<ul class="source-list">' + sources + '</ul>' +
          '</section>' +
        '</div>' +
        dischargeTestsHTML(device) +
        (device.notes ? '<div class="modal-note">' + escapeHTML(device.notes) + '</div>' : '') +
      '</div>';

    if (series.length) {
      requestAnimationFrame(function () {
        var stage = container.querySelector('.modal-chart-stage');
        if (!stage) return;
        window.AtlasCharts.renderCurveChart(stage, series, {
          ariaLabel: device.model + ' ' + chartKind + '曲线',
          emptyMessage: '曲线数据待补充'
        });
      });
    }
  }

  function openDevice(id) {
    if (!getDevice(id)) return;
    window.location.href = 'device.html?id=' + encodeURIComponent(id);
  }

  function renderDevicePage() {
    var container = document.getElementById('deviceDetail');
    if (!container) return;
    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    var device = getDevice(id) || state.data.devices[0] || null;

    if (!device) {
      container.className = '';
      container.innerHTML = '<div class="device-missing">' +
        '<h1>还没有可显示的档案。</h1>' +
        '<p>返回型号库查看现有内容。</p>' +
        '<a href="index.html">返回型号库 →</a>' +
        '</div>';
      return;
    }

    if (!id) {
      try { history.replaceState(null, '', 'device.html?id=' + encodeURIComponent(device.id)); } catch (error) {}
    }
    document.title = device.model + ' · 电库图鉴';
    var description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', getBrand(device.brandId).name + ' ' + device.model + ' 的规格、测试条件与充电曲线。');
    if (els.dossierCurvesLink) {
      els.dossierCurvesLink.href = 'index.html?view=curves&q=' + encodeURIComponent(device.model);
    }
    if (els.dossierCompare) {
      els.dossierCompare.setAttribute('data-device-id', device.id);
      syncDossierCompare();
    }
    renderDetail(device, container);
  }

  function closeModal() {
    if (!els.modal || els.modal.hidden) return;
    els.modal.hidden = true;
    document.body.classList.remove('is-locked');
    state.detailId = null;
    if (els.modalBody) els.modalBody.innerHTML = '';
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
      state.lastFocus.focus();
    }
    state.lastFocus = null;
  }

  function setupModal() {
    if (!els.modal) return;
    els.modal.addEventListener('click', function (event) {
      if (event.target.closest('[data-modal-close]')) closeModal();
    });
    if (els.modalClose) {
      els.modalClose.addEventListener('click', closeModal);
    }
    document.addEventListener('keydown', function (event) {
      if (els.modal.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = $$('button, a[href], input, select, [tabindex]:not([tabindex="-1"])', els.modal)
        .filter(function (node) { return !node.disabled && node.offsetParent !== null; });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- Schema ---------- */

  function highlightJSON(text) {
    var result = '';
    var lastIndex = 0;
    var pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      result += escapeHTML(text.slice(lastIndex, match.index));
      if (match[1]) {
        var key = Boolean(match[2]);
        result += '<span class="' + (key ? 'tok-key' : 'tok-string') + '">' + escapeHTML(match[1]) + '</span>' +
          (match[2] ? escapeHTML(match[2]) : '');
      } else if (match[3]) {
        result += '<span class="tok-number">' + escapeHTML(match[3]) + '</span>';
      } else {
        result += '<span class="' + (match[4] === 'null' ? 'tok-null' : 'tok-bool') + '">' + escapeHTML(match[4]) + '</span>';
      }
      lastIndex = pattern.lastIndex;
    }
    result += escapeHTML(text.slice(lastIndex));
    return result;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (error) {
        reject(error);
      } finally {
        document.body.removeChild(textarea);
      }
    });
  }

  function setupSchema() {
    if (els.schemaCode) {
      schemaRaw = els.schemaCode.textContent.trim();
      els.schemaCode.innerHTML = highlightJSON(schemaRaw);
    }
    if (els.copySchema) {
      copyButtonDefault = els.copySchema.innerHTML;
      els.copySchema.addEventListener('click', function () {
        copyText(schemaRaw).then(function () {
          els.copySchema.textContent = '已复制';
          showToast('数据结构已复制到剪贴板');
          window.setTimeout(function () {
            els.copySchema.innerHTML = copyButtonDefault;
          }, 1600);
        }).catch(function () {
          showToast('复制失败，请手动选择代码');
        });
      });
    }
  }

  /* ---------- Global interactions ---------- */

  function setupGlobalInteractions() {
    document.addEventListener('click', function (event) {
      var toggle = event.target.closest('[data-compare-toggle]');
      if (toggle) {
        event.stopPropagation();
        toggleCompare(toggle.getAttribute('data-compare-toggle'));
        return;
      }
      var open = event.target.closest('[data-open-device]');
      if (open) {
        openDevice(open.getAttribute('data-open-device'));
        return;
      }
      var card = event.target.closest('.device-card');
      if (card && !event.target.closest('button, a')) {
        openDevice(card.getAttribute('data-device-id'));
      }
    });

    document.addEventListener('keydown', function (event) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      var typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (document.activeElement && document.activeElement.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (els.searchInput) {
          els.searchInput.focus();
          els.searchInput.select();
        }
        return;
      }
      if (event.key === 'Escape') {
        if (els.modal && !els.modal.hidden) return;
        if (els.mobileMenu && !els.mobileMenu.hidden) {
          closeMobileMenu();
          return;
        }
        if (document.activeElement === els.searchInput && els.searchInput.value) {
          els.searchInput.value = '';
          state.query = '';
          renderLibrary();
          els.searchInput.blur();
        }
      }
    });

    document.addEventListener('error', function (event) {
      if (!event.target || !event.target.matches || !event.target.matches('img[data-device-image]')) return;
      event.target.style.display = 'none';
      var holder = event.target.closest('.device-media, .modal-hero-media');
      if (holder) holder.classList.add('is-missing');
    }, true);
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2400);
  }

  function setupReveal() {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var groups = [
      ['.section-heading'],
      ['.brand-card'],
      ['.library-empty'],
      ['.chart-card', '.readout-card'],
      ['.guide-card'],
      ['.compare-shell'],
      ['.schema-copy', '.code-card'],
      ['.steps li'],
      ['.footer-top']
    ];
    var nodes = [];
    groups.forEach(function (selectors) {
      var found = [];
      selectors.forEach(function (selector) {
        found = found.concat($$(selector));
      });
      found.forEach(function (node, index) {
        if (node.classList.contains('reveal')) return;
        node.classList.add('reveal');
        node.style.transitionDelay = String(Math.min(index * 55, 165)) + 'ms';
        nodes.push(node);
      });
    });
    if (!nodes.length) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    nodes.forEach(function (node) { observer.observe(node); });
  }

  function cacheElements() {
    els.themeToggle = document.getElementById('themeToggle');
    els.menuToggle = document.getElementById('menuToggle');
    els.mobileMenu = document.getElementById('mobileMenu');
    els.headerStatusText = $('[data-header-status]');
    els.searchInput = document.getElementById('searchInput');
    els.sortSelect = document.getElementById('sortSelect');
    els.sortField = document.getElementById('sortField');
    els.cardView = document.getElementById('cardView');
    els.curveView = document.getElementById('curveView');
    els.deviceGrid = document.getElementById('deviceGrid');
    els.libraryEmpty = document.getElementById('libraryEmpty');
    els.emptyTitle = document.getElementById('emptyTitle');
    els.emptyCopy = document.getElementById('emptyCopy');
    els.clearFilters = document.getElementById('clearFilters');
    els.dossierCurvesLink = document.getElementById('dossierCurvesLink');
    els.dossierCompare = document.getElementById('dossierCompare');
    els.curveKindFilter = document.getElementById('curveKindFilter');
    els.curveSort = document.getElementById('curveSort');
    els.curveClearFilters = document.getElementById('curveClearFilters');
    els.allCurveChart = document.getElementById('allCurveChart');
    els.allCurveLegend = document.getElementById('allCurveLegend');
    els.curveList = document.getElementById('curveList');
    els.curveEmpty = document.getElementById('curveEmpty');
    els.labChart = document.getElementById('labChart');
    els.labChartTitle = document.getElementById('labChartTitle');
    els.labLegend = document.getElementById('labLegend');
    els.labModelWrap = document.getElementById('labModelWrap');
    els.labModelSelect = document.getElementById('labModelSelect');
    els.metricRows = $$('.metric-row');
    els.readoutLive = $('.readout-live');
    els.labConditions = document.getElementById('labConditions');
    els.labConditionList = document.getElementById('labConditionList');
    els.compareSlots = document.getElementById('compareSlots');
    els.compareTableWrap = $('.compare-table-wrap');
    els.compareHint = document.getElementById('compareHint');
    els.compareClear = document.getElementById('compareClear');
    els.compareDock = document.getElementById('compareDock');
    els.compareCount = document.getElementById('compareCount');
    els.compareChips = document.getElementById('compareChips');
    els.modal = document.getElementById('deviceModal');
    els.modalBody = document.getElementById('modalBody');
    els.modalClose = document.getElementById('modalClose');
    els.schemaCode = document.getElementById('schemaCode');
    els.copySchema = document.getElementById('copySchema');
    els.toast = document.getElementById('toast');
    labPlaceholder = els.labChart ? els.labChart.innerHTML : '';
    labLegendDefault = els.labLegend ? els.labLegend.innerHTML : '';
    curvePlaceholder = els.allCurveChart ? els.allCurveChart.innerHTML : '';
  }

  function renderAll() {
    renderOverview();
    renderLibrary();
    renderCompare();
    renderLab();
  }

  async function init() {
    cacheElements();
    setText(document.getElementById('year'), String(new Date().getFullYear()));
    setupTheme();
    setupMobileMenu();
    setupHeaderAutoHide();
    setupNavSpy();
    setupLibraryControls();
    setupCurveLab();
    setupCompare();
    setupModal();
    setupSchema();
    setupGlobalInteractions();
    setupReveal();

    state.compare = readCompare();
    await loadData();

    // Drop selections that no longer exist after a data update.
    state.compare = state.compare.filter(function (id) { return Boolean(getDevice(id)); });
    saveCompare();
    if (state.labDeviceId && !getDevice(state.labDeviceId)) state.labDeviceId = null;

    applyUrlState();
    renderAll();
    if (document.body.dataset.page === 'device') renderDevicePage();

    if (state.loadError) {
      showToast('未能读取数据文件，请通过本地服务器或 GitHub Pages 打开');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
