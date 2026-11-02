/**
 * 50-studio.js - `MF.Studio`: the MeshFlow Studio main-panel page.
 *
 * Owns the composition state, the undo/redo history, localStorage persistence, the
 * canvas render loop, node dragging, keyboard shortcuts, the toast line and the wiring
 * of `MF.panels` + `MF.exporter`.
 *
 * Plain script fragment: `React` and `h` are injected by the bundle wrapper. No JSX,
 * no imports, no direct DOM outside effects, no mutation of the composition state.
 */

MF.strings = MF.strings || {};
MF.strings.studio = {
  en: {
    'studio.title': 'MeshFlow Studio',
    'studio.subtitle': 'Mesh gradients, blur, grain & glass',
    'studio.undo': 'Undo',
    'studio.redo': 'Redo',
    'studio.randomize': 'Randomize',
    'studio.copyCss': 'Copy CSS',
    'studio.exportPng': 'Export PNG',
    'studio.artboard': 'Artboard',
    'studio.canvasAria': 'Composition preview',
    'studio.guides': 'Guides',
    'studio.stageNodes': '{n} nodes',
    'studio.hint': 'Double-click to add a node · drag to sculpt',
    'studio.hintKeys': 'R randomize · ⌘Z undo · ⌫ remove · arrows nudge',
    'studio.status': '{dim} · {nodes} nodes · blur {blur} · grain {grain} · {saved}',
    'studio.statusDim': '{w} × {h}',
    'studio.statusSaved': 'Autosaved',
    'studio.statusSaving': 'Saving…',
    'studio.off': 'off',
    'studio.toastCopiedCSS': 'CSS copied to clipboard',
    'studio.toastCopiedJSON': 'JSON copied to clipboard',
    'studio.toastCopiedPNG': 'PNG copied to clipboard',
    'studio.toastDownloadedPNG': 'PNG exported',
    'studio.toastDownloadedCSS': 'CSS file downloaded',
    'studio.toastDownloadedJSON': 'JSON file downloaded',
    'studio.toastFailed': 'Not available in this browser',
    'studio.toastPresetSaved': 'Preset saved',
    'studio.toastPresetDeleted': 'Preset deleted',
    'studio.toastMaxNodes': 'All node slots are in use',
  },
  zh: {
    'studio.title': 'MeshFlow Studio',
    'studio.subtitle': '网格渐变、模糊、颗粒与玻璃质感',
    'studio.undo': '撤销',
    'studio.redo': '重做',
    'studio.randomize': '随机生成',
    'studio.copyCss': '复制 CSS',
    'studio.exportPng': '导出 PNG',
    'studio.artboard': '画板',
    'studio.canvasAria': '作品预览',
    'studio.guides': '参考线',
    'studio.stageNodes': '{n} 个节点',
    'studio.hint': '双击添加节点 · 拖动塑造网格',
    'studio.hintKeys': 'R 随机 · ⌘Z 撤销 · ⌫ 删除 · 方向键微调',
    'studio.status': '{dim} · {nodes} 个节点 · 模糊 {blur} · 颗粒 {grain} · {saved}',
    'studio.statusDim': '{w} × {h}',
    'studio.statusSaved': '已自动保存',
    'studio.statusSaving': '正在保存…',
    'studio.off': '关',
    'studio.toastCopiedCSS': 'CSS 已复制到剪贴板',
    'studio.toastCopiedJSON': 'JSON 已复制到剪贴板',
    'studio.toastCopiedPNG': 'PNG 已复制到剪贴板',
    'studio.toastDownloadedPNG': 'PNG 已导出',
    'studio.toastDownloadedCSS': 'CSS 文件已下载',
    'studio.toastDownloadedJSON': 'JSON 文件已下载',
    'studio.toastFailed': '当前浏览器不支持该操作',
    'studio.toastPresetSaved': '预设已保存',
    'studio.toastPresetDeleted': '预设已删除',
    'studio.toastMaxNodes': '节点数量已达上限',
  },
};

/** Page chrome for the main panel. Every colour is a theme token (artwork colours aside). */
MF.studioCss = `
.mf-st-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 520px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.45;
}

.mf-st-root *,
.mf-st-root *::before,
.mf-st-root *::after {
  box-sizing: border-box;
}

/* ---------- header ---------- */

.mf-st-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}

.mf-st-mark {
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  overflow: hidden;
  background: radial-gradient(120% 130% at 16% 12%, #6ee7ff 0%, #7d8bff 38%, #b47bff 66%, #ff8fc9 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24);
}

.mf-st-mark::after {
  content: '';
  position: absolute;
  inset: -30% 40% 40% -30%;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0) 68%);
}

.mf-st-titles {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.mf-st-title {
  font-size: 14.5px;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}

.mf-st-subtitle {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-st-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}

/* ---------- body: rail · stage · inspector ---------- */

.mf-st-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr) 296px;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.mf-st-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}

.mf-st-col > * {
  flex: 1 1 auto;
  min-height: 0;
}

/* ---------- stage ---------- */

.mf-st-stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 8px 10px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}

.mf-st-stage-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.mf-st-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.mf-st-stage-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mf-st-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-st-stage-wrap {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
}

.mf-st-art {
  position: relative;
  flex: 0 0 auto;
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2), 0 22px 52px -26px rgba(0, 0, 0, 0.8);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  outline: none;
}

.mf-st-art.is-interacting {
  cursor: grabbing;
}

.mf-st-canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-bg-base);
}

.mf-st-guides {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0.16;
  background-image:
    linear-gradient(to right, var(--dsw-alias-label-primary) 0 1px, transparent 1px),
    linear-gradient(to bottom, var(--dsw-alias-label-primary) 0 1px, transparent 1px);
  background-size: 33.3333% 33.3333%;
}

.mf-st-handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.mf-st-node {
  position: absolute;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  -webkit-appearance: none;
  appearance: none;
}

.mf-st-node:active {
  cursor: grabbing;
}

.mf-st-node::before {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--mf-dot, var(--dsw-alias-brand-primary));
  /* token-only fallback first, then the token-derived soft shadow */
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base), 0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  transition: transform 0.12s ease;
}

.mf-st-node::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  transition: border-color 0.12s ease, transform 0.12s ease;
}

.mf-st-node:hover::after {
  border-color: var(--dsw-alias-border-l2);
}

.mf-st-node.is-selected::after {
  border-color: var(--dsw-alias-brand-primary);
  transform: scale(1.03);
}

.mf-st-node.is-selected::before {
  transform: scale(1.12);
}

.mf-st-node:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.mf-st-node:focus-visible::after {
  border-color: var(--dsw-alias-brand-primary);
}

/* ---------- status bar ---------- */

.mf-st-status {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 7px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.mf-st-status-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-st-status-hint {
  margin-left: auto;
  white-space: nowrap;
  opacity: 0.85;
}

/* ---------- toast ---------- */

.mf-st-toast {
  position: absolute;
  right: 18px;
  bottom: 44px;
  z-index: 5;
  max-width: 320px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.16s ease, transform 0.16s ease;
  pointer-events: none;
}

.mf-st-toast.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.mf-st-toast.is-error {
  border-color: var(--dsw-alias-state-error-primary);
}

/* ---------- fallback buttons (only used when MF.ui is unavailable) ---------- */

.mf-st-fallback-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.mf-st-fallback-btn:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l2);
}

.mf-st-fallback-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.mf-st-fallback-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

/* ---------- responsive: stack the three regions below 1080px ---------- */

@media (max-width: 1080px) {
  .mf-st-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .mf-st-col-rail {
    flex: 0 0 auto;
    max-height: 214px;
  }

  .mf-st-col-insp {
    flex: 0 0 auto;
    min-height: 340px;
  }

  .mf-st-stage {
    flex: 0 0 auto;
    height: 46vh;
    min-height: 320px;
    max-height: 520px;
  }

  .mf-st-head {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .mf-st-subtitle {
    display: none;
  }

  .mf-st-actions {
    width: 100%;
    margin-left: 0;
    justify-content: flex-start;
  }

  .mf-st-hint {
    display: none;
  }
}

@media (max-width: 720px) {
  .mf-st-mark {
    width: 30px;
    height: 30px;
  }

  .mf-st-title {
    font-size: 13.5px;
  }

  .mf-st-status-hint {
    display: none;
  }

  .mf-st-toast {
    right: 12px;
    left: 12px;
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mf-st-node::before,
  .mf-st-node::after,
  .mf-st-toast {
    transition: none;
  }
}
`;

MF.Studio = (function () {
  'use strict';

  var STATE_KEY = 'meshflow-studio.state.v2';
  var PRESET_KEY = 'meshflow-studio.presets.v1';
  var HISTORY_MAX = 80;
  var COALESCE_MS = 600;
  var SAVE_MS = 500;
  var TOAST_MS = 2200;
  var PRESET_MAX = 24;
  var PRESET_NAME_MAX = 32;
  var NUDGE_STEP = 0.005;

  var fallbackT = null;

  /* ------------------------------------------------------------------ locale */

  function makeFallbackT() {
    var lang = 'en';
    try {
      if (typeof navigator !== 'undefined' && navigator.language && /^zh/i.test(navigator.language)) {
        lang = 'zh';
      }
    } catch (error) {
      lang = 'en';
    }
    var merged = {};
    var groups = MF.strings || {};
    [lang, 'en'].forEach(function (localeId) {
      Object.keys(groups).forEach(function (group) {
        var dict = groups[group] && groups[group][localeId];
        if (!dict || typeof dict !== 'object') return;
        Object.keys(dict).forEach(function (key) {
          if (merged[key] === undefined) merged[key] = dict[key];
        });
      });
    });
    return function fallbackTranslate(key) {
      var value = merged[key];
      return typeof value === 'string' && value ? value : key;
    };
  }

  /**
   * The Lead's slot registration may render `MF.Studio` with a `t` prop bound to the
   * locale service. When it does not, fall back to the merged module dictionaries.
   */
  function resolveT(props) {
    if (props && typeof props.t === 'function') return props.t;
    if (!fallbackT) fallbackT = makeFallbackT();
    return fallbackT;
  }

  /** Tiny `{placeholder}` template helper - copy stays in the dictionary. */
  function fmt(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (match, key) {
      if (values && values[key] !== undefined && values[key] !== null) return String(values[key]);
      return match;
    });
  }

  /* --------------------------------------------------------- model utilities */

  function safeNormalize(candidate) {
    try {
      return MF.model.normalize(candidate);
    } catch (error) {
      return null;
    }
  }

  function pointsOf(state) {
    return state && Array.isArray(state.points) ? state.points : [];
  }

  function safePatch(state, id, patch) {
    try {
      return MF.model.patchPoint(state, id, patch);
    } catch (error) {
      return null;
    }
  }

  function aspectInfo(state) {
    try {
      var aspect = MF.model.aspectOf(state);
      if (aspect && aspect.w > 0 && aspect.h > 0) return aspect;
    } catch (error) {
      /* fall through to the default ratio */
    }
    return { id: '16:9', w: 16, h: 9 };
  }

  function dimensionsOf(state) {
    try {
      var dims = MF.model.dimensionsOf(state);
      if (dims && dims.width > 0 && dims.height > 0) return dims;
    } catch (error) {
      /* fall through to the default size */
    }
    var aspect = aspectInfo(state);
    return { width: Math.round(aspect.w * 100), height: Math.round(aspect.h * 100) };
  }

  /** Largest `aspect`-correct box that fits inside `size` (0×0 until measured). */
  function fitArt(size, aspect) {
    var ratio = aspect && aspect.w > 0 && aspect.h > 0 ? aspect.w / aspect.h : 16 / 9;
    var availWidth = size && size.width > 0 ? size.width : 0;
    var availHeight = size && size.height > 0 ? size.height : 0;
    if (!availWidth || !availHeight) return { width: 0, height: 0 };
    var width = availWidth;
    var height = width / ratio;
    if (height > availHeight) {
      height = availHeight;
      width = height * ratio;
    }
    return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
  }

  function nodeLimit() {
    var limits = MF.model && MF.model.LIMITS;
    var range = limits && limits.points;
    if (range && range.length === 2 && isFinite(range[1])) return range[1];
    return 12;
  }

  /* --------------------------------------------------------------- history */

  function createDoc(state) {
    return {
      state: state,
      past: [],
      future: [],
      selectedId: null,
      gesture: null,
      lastPushAt: 0,
    };
  }

  function pushPast(past, snapshot) {
    var next = past.concat([snapshot]);
    if (next.length > HISTORY_MAX) next = next.slice(next.length - HISTORY_MAX);
    return next;
  }

  function selectionFor(id, state) {
    if (!id || !state || !state.points) return null;
    for (var i = 0; i < state.points.length; i += 1) {
      if (state.points[i] && state.points[i].id === id) return id;
    }
    return null;
  }

  /** Append `nextState` to the history and make it current. */
  function commitPush(doc, nextState, at) {
    if (!nextState) return doc;
    return Object.assign({}, doc, {
      state: nextState,
      past: pushPast(doc.past, doc.state),
      future: [],
      gesture: null,
      lastPushAt: at || 0,
      selectedId: selectionFor(doc.selectedId, nextState),
    });
  }

  function reduce(doc, action) {
    if (!doc || !action) return doc;
    var nextState;
    switch (action.type) {
      case 'set': {
        nextState = safeNormalize(action.state);
        if (!nextState) return doc;
        var coalesce = action.coalesce === true && !doc.gesture;
        var sincePush = doc.lastPushAt ? action.at - doc.lastPushAt : Infinity;
        if (coalesce && sincePush <= COALESCE_MS) {
          return Object.assign({}, doc, {
            state: nextState,
            future: [],
            selectedId: selectionFor(doc.selectedId, nextState),
          });
        }
        return commitPush(doc, nextState, action.at);
      }

      case 'select':
        return doc.selectedId === action.id ? doc : Object.assign({}, doc, { selectedId: action.id });

      case 'beginGesture':
        return Object.assign({}, doc, {
          gesture: { snapshot: doc.state, pushed: false, id: action.id },
          lastPushAt: action.at || 0,
        });

      case 'gestureMove': {
        var moved = safePatch(doc.state, action.id, { x: action.x, y: action.y });
        if (!moved) return doc;
        if (!doc.gesture || doc.gesture.id !== action.id) {
          return Object.assign({}, doc, { state: moved });
        }
        if (!doc.gesture.pushed) {
          return Object.assign({}, doc, {
            state: moved,
            past: pushPast(doc.past, doc.gesture.snapshot),
            future: [],
            gesture: { snapshot: doc.gesture.snapshot, pushed: true, id: doc.gesture.id },
          });
        }
        return Object.assign({}, doc, { state: moved });
      }

      case 'endGesture':
        return doc.gesture ? Object.assign({}, doc, { gesture: null, lastPushAt: action.at || 0 }) : doc;

      case 'undo': {
        if (!doc.past.length) return doc;
        var previous = doc.past[doc.past.length - 1];
        return Object.assign({}, doc, {
          state: previous,
          past: doc.past.slice(0, doc.past.length - 1),
          future: [doc.state].concat(doc.future).slice(0, HISTORY_MAX),
          selectedId: selectionFor(doc.selectedId, previous),
          gesture: null,
          lastPushAt: 0,
        });
      }

      case 'redo': {
        if (!doc.future.length) return doc;
        var forward = doc.future[0];
        return Object.assign({}, doc, {
          state: forward,
          past: pushPast(doc.past, doc.state),
          future: doc.future.slice(1),
          selectedId: selectionFor(doc.selectedId, forward),
          gesture: null,
          lastPushAt: 0,
        });
      }

      case 'randomize':
        return commitPush(doc, safeNormalize(MF.model.randomize(doc.state, { seed: action.at || 1 })), action.at);

      case 'randomizePoints': {
        var rng = MF.util.mulberry32(action.at || 1);
        var points = pointsOf(doc.state).map(function (point) {
          return Object.assign({}, point, {
            x: MF.util.round(0.06 + rng() * 0.88, 3),
            y: MF.util.round(0.06 + rng() * 0.88, 3),
          });
        });
        return commitPush(doc, safeNormalize(Object.assign({}, doc.state, { points: points })), action.at);
      }

      case 'addPoint': {
        var currentPoints = pointsOf(doc.state);
        if (currentPoints.length >= nodeLimit()) return doc;
        var grown = safeNormalize(MF.model.addPoint(doc.state, { x: action.x, y: action.y }));
        if (!grown || pointsOf(grown).length <= currentPoints.length) return doc;
        var known = {};
        currentPoints.forEach(function (point) {
          known[point.id] = true;
        });
        var addedId = null;
        grown.points.forEach(function (point) {
          if (!known[point.id]) addedId = point.id;
        });
        var addedDoc = commitPush(doc, grown, action.at || 0);
        return addedId ? Object.assign({}, addedDoc, { selectedId: addedId }) : addedDoc;
      }

      case 'removeSelected': {
        if (!doc.selectedId) return doc;
        var trimmed = safeNormalize(MF.model.removePoint(doc.state, doc.selectedId));
        if (!trimmed || pointsOf(trimmed).length >= pointsOf(doc.state).length) return doc;
        return Object.assign(commitPush(doc, trimmed, 0), { selectedId: null });
      }

      case 'nudge': {
        if (!doc.selectedId) return doc;
        var target = null;
        pointsOf(doc.state).forEach(function (point) {
          if (point.id === doc.selectedId) target = point;
        });
        if (!target) return doc;
        var nudged = safePatch(doc.state, doc.selectedId, {
          x: MF.util.clamp(target.x + action.dx, 0, 1),
          y: MF.util.clamp(target.y + action.dy, 0, 1),
        });
        if (!nudged) return doc;
        return reduce(doc, { type: 'set', state: nudged, coalesce: true, at: action.at });
      }

      case 'applyPreset':
        return commitPush(doc, safeNormalize(action.state), action.at || 0);

      case 'recolor':
        return commitPush(doc, safeNormalize(MF.model.recolor(doc.state, action.paletteId)), action.at || 0);

      default:
        return doc;
    }
  }

  /* ------------------------------------------------------------ persistence */

  function loadInitialState() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        var raw = window.localStorage.getItem(STATE_KEY);
        if (raw) {
          var restored = MF.model.deserialize(raw);
          if (restored) return safeNormalize(restored);
        }
      }
    } catch (error) {
      /* corrupt or unavailable storage: fall back to a fresh composition */
    }
    var created = null;
    try {
      created = safeNormalize(MF.model.createState());
    } catch (error) {
      created = null;
    }
    if (created) return created;
    try {
      return MF.model.createState();
    } catch (error) {
      return null;
    }
  }

  function loadUserPresets() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return [];
      var raw = window.localStorage.getItem(PRESET_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(function (preset) {
          return preset && typeof preset.id === 'string' && typeof preset.name === 'string' && preset.state;
        })
        .map(function (preset) {
          return {
            id: preset.id,
            name: String(preset.name).slice(0, PRESET_NAME_MAX),
            state: safeNormalize(preset.state) || preset.state,
            createdAt: Number(preset.createdAt) || 0,
          };
        })
        .slice(0, PRESET_MAX);
    } catch (error) {
      return [];
    }
  }

  /* ---------------------------------------------------------------- component */

  function Studio(props) {
    var t = resolveT(props);

    var wrapRef = React.useRef(null);
    var artRef = React.useRef(null);
    var canvasRef = React.useRef(null);
    var busyRef = React.useRef(null);
    var dragRef = React.useRef(null);
    var firstSaveRef = React.useRef(true);

    var docPair = React.useReducer(reduce, null, function () {
      return createDoc(loadInitialState());
    });
    var doc = docPair[0];
    var dispatch = docPair[1];

    var docRef = React.useRef(doc);

    var stagePair = React.useState({ width: 0, height: 0 });
    var stageSize = stagePair[0];
    var setStageSize = stagePair[1];

    var interactPair = React.useState(false);
    var interacting = interactPair[0];
    var setInteracting = interactPair[1];

    var guidePair = React.useState(false);
    var guides = guidePair[0];
    var setGuides = guidePair[1];

    var scalePair = React.useState(2);
    var exportScale = scalePair[0];
    var setExportScale = scalePair[1];

    var busyPair = React.useState(null);
    var busy = busyPair[0];
    var setBusy = busyPair[1];

    var toastPair = React.useState(null);
    var toast = toastPair[0];
    var setToast = toastPair[1];

    var savedPair = React.useState(true);
    var saved = savedPair[0];
    var setSaved = savedPair[1];

    var presetsPair = React.useState(loadUserPresets);
    var userPresets = presetsPair[0];
    var setUserPresets = presetsPair[1];

    var cssText = React.useMemo(function () {
      try {
        if (typeof MF.cssAll === 'function') return MF.cssAll();
      } catch (error) {
        /* fall through to the manual concatenation */
      }
      return [MF.ui && MF.ui.css, MF.panels && MF.panels.css, MF.studioCss].filter(Boolean).join('\n');
    }, []);

    /* ------------------------------------------------------------- effects */

    // Keep a ref copy of the latest document for the window-level keyboard handler.
    React.useEffect(function () {
      docRef.current = doc;
    });

    // Debounced persistence of the composition.
    React.useEffect(function () {
      var firstRun = firstSaveRef.current;
      firstSaveRef.current = false;
      if (!firstRun) setSaved(false);
      var timer = window.setTimeout(function () {
        try {
          window.localStorage.setItem(STATE_KEY, MF.model.serialize(doc.state));
        } catch (error) {
          /* storage unavailable - the studio keeps working in memory */
        }
        setSaved(true);
      }, SAVE_MS);
      return function () {
        window.clearTimeout(timer);
      };
    }, [doc.state]);

    // Custom presets are small; write them straight through.
    React.useEffect(function () {
      try {
        window.localStorage.setItem(PRESET_KEY, JSON.stringify(userPresets));
      } catch (error) {
        /* ignore quota / privacy-mode failures */
      }
    }, [userPresets]);

    // Canvas rendering: always through requestAnimationFrame, never during render.
    React.useEffect(function () {
      var canvas = canvasRef.current;
      if (!canvas || !MF.engine || typeof MF.engine.render !== 'function') return undefined;
      var size = fitArt(stageSize, aspectInfo(doc.state));
      if (!size.width || !size.height) return undefined;
      var ratio = interacting ? 1 : Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      var draft = interacting === true;
      var frame = window.requestAnimationFrame(function () {
        try {
          MF.engine.render(canvas, doc.state, {
            width: size.width,
            height: size.height,
            pixelRatio: ratio,
            draft: draft,
          });
        } catch (error) {
          /* keep the previous frame visible */
        }
      });
      return function () {
        window.cancelAnimationFrame(frame);
      };
    }, [doc.state, stageSize, interacting]);

    // Measure the stage wrapper (before paint, so the artboard never jumps).
    React.useLayoutEffect(function () {
      var node = wrapRef.current;
      if (!node) return undefined;
      function measure() {
        var rect = node.getBoundingClientRect();
        var width = Math.max(0, Math.round(rect.width));
        var height = Math.max(0, Math.round(rect.height));
        setStageSize(function (previous) {
          if (previous && previous.width === width && previous.height === height) return previous;
          return { width: width, height: height };
        });
      }
      measure();
      var observer = null;
      if (typeof window.ResizeObserver === 'function') {
        observer = new window.ResizeObserver(measure);
        observer.observe(node);
      } else {
        window.addEventListener('resize', measure);
      }
      return function () {
        if (observer) observer.disconnect();
        else window.removeEventListener('resize', measure);
      };
    }, []);

    // Toast auto-dismiss.
    React.useEffect(function () {
      if (!toast) return undefined;
      var timer = window.setTimeout(function () {
        setToast(null);
      }, TOAST_MS);
      return function () {
        window.clearTimeout(timer);
      };
    }, [toast]);

    // Keyboard shortcuts - only the documented keys, only outside form controls.
    React.useEffect(function () {
      function isTypingTarget(target) {
        if (!target || !target.tagName) return false;
        if (target.isContentEditable === true) return true;
        var tag = String(target.tagName).toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      }

      function onKeyDown(event) {
        if (!event || event.defaultPrevented) return;
        if (isTypingTarget(event.target)) return;
        var key = event.key;
        var modifier = event.metaKey || event.ctrlKey;

        if (modifier && !event.altKey && (key === 'z' || key === 'Z')) {
          event.preventDefault();
          dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
          return;
        }
        if (modifier && !event.altKey && (key === 'y' || key === 'Y')) {
          event.preventDefault();
          dispatch({ type: 'redo' });
          return;
        }
        if (modifier || event.altKey) return;

        if (key === 'r' || key === 'R') {
          event.preventDefault();
          dispatch({ type: 'randomize', at: Date.now() });
          return;
        }
        if (key === 'Delete' || key === 'Backspace') {
          if (!docRef.current || !docRef.current.selectedId) return;
          event.preventDefault();
          dispatch({ type: 'removeSelected' });
          return;
        }
        if (key === 'Escape') {
          dispatch({ type: 'select', id: null });
          return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
          if (!docRef.current || !docRef.current.selectedId) return;
          var step = event.shiftKey ? NUDGE_STEP * 4 : NUDGE_STEP;
          var dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
          var dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
          event.preventDefault();
          dispatch({ type: 'nudge', dx: dx, dy: dy, at: Date.now() });
        }
      }

      window.addEventListener('keydown', onKeyDown);
      return function () {
        window.removeEventListener('keydown', onKeyDown);
      };
    }, [dispatch]);

    /* ------------------------------------------------------------ handlers */

    function handleChange(nextState, coalesce) {
      dispatch({ type: 'set', state: nextState, coalesce: coalesce === true, at: Date.now() });
    }

    function handleSelectPoint(id) {
      dispatch({ type: 'select', id: id == null ? null : String(id) });
    }

    function handleUndo() {
      dispatch({ type: 'undo' });
    }

    function handleRedo() {
      dispatch({ type: 'redo' });
    }

    function handleRandomize() {
      dispatch({ type: 'randomize', at: Date.now() });
    }

    function handleRandomizePoints() {
      dispatch({ type: 'randomizePoints', at: Date.now() });
    }

    function handleToggleGuides() {
      setGuides(function (previous) {
        return !previous;
      });
    }

    function handleExportScale(value) {
      var numeric = Number(value);
      setExportScale(isFinite(numeric) && numeric > 0 ? numeric : 2);
    }

    function handleApplyPreset(presetState) {
      var value = presetState && presetState.state ? presetState.state : presetState;
      dispatch({ type: 'applyPreset', state: value, at: Date.now() });
    }

    function handleRecolor(paletteId) {
      dispatch({ type: 'recolor', paletteId: paletteId, at: Date.now() });
    }

    function handleSavePreset(name) {
      var clean = String(name == null ? '' : name).trim().slice(0, PRESET_NAME_MAX);
      if (!clean) return;
      var preset = {
        id: MF.util.uid('preset'),
        name: clean,
        state: MF.model.clone(doc.state),
        createdAt: Date.now(),
      };
      setUserPresets(function (previous) {
        return [preset].concat(previous).slice(0, PRESET_MAX);
      });
      setToast({ text: t('studio.toastPresetSaved'), tone: 'ok' });
    }

    function handleDeletePreset(id) {
      setUserPresets(function (previous) {
        return previous.filter(function (preset) {
          return preset.id !== id;
        });
      });
      setToast({ text: t('studio.toastPresetDeleted'), tone: 'ok' });
    }

    /* ------------------------------------------------------------- exports */

    function exportScaleValue(scale) {
      var numeric = Number(scale);
      if (!isFinite(numeric) || numeric <= 0) numeric = exportScale;
      return Math.max(1, Math.min(4, Math.round(numeric)));
    }

    /** Single export path: call MF.exporter, toast the result, track `busy`. */
    function runExport(actionName, successKey, args) {
      if (busyRef.current) return;
      var exporter = MF.exporter;
      var method = exporter && typeof exporter[actionName] === 'function' ? exporter[actionName] : null;
      if (!method) {
        setToast({ text: t('studio.toastFailed'), tone: 'error' });
        return;
      }
      busyRef.current = actionName;
      setBusy(actionName);
      var result;
      try {
        result = method.apply(exporter, args || []);
      } catch (error) {
        result = Promise.reject(error);
      }
      Promise.resolve(result)
        .then(function (value) {
          var ok = value !== false && value !== null && value !== undefined;
          setToast({ text: t(ok ? successKey : 'studio.toastFailed'), tone: ok ? 'ok' : 'error' });
        })
        .catch(function () {
          setToast({ text: t('studio.toastFailed'), tone: 'error' });
        })
        .then(function () {
          busyRef.current = null;
          setBusy(null);
        });
    }

    function handleDownloadPng(scale) {
      runExport('downloadPNG', 'studio.toastDownloadedPNG', [doc.state, exportScaleValue(scale)]);
    }

    function handleCopyPng(scale) {
      runExport('copyPNG', 'studio.toastCopiedPNG', [doc.state, exportScaleValue(scale)]);
    }

    function handleCopyCss() {
      runExport('copyCSS', 'studio.toastCopiedCSS', [doc.state]);
    }

    function handleCopyJson() {
      runExport('copyJSON', 'studio.toastCopiedJSON', [doc.state]);
    }

    function handleDownloadCss() {
      runExport('downloadCSS', 'studio.toastDownloadedCSS', [doc.state]);
    }

    function handleDownloadJson() {
      runExport('downloadJSON', 'studio.toastDownloadedJSON', [doc.state]);
    }

    var exportWiring = {
      downloadPNG: handleDownloadPng,
      copyPNG: handleCopyPng,
      copyCSS: handleCopyCss,
      copyJSON: handleCopyJson,
      downloadCSS: handleDownloadCss,
      downloadJSON: handleDownloadJson,
    };

    /* ---------------------------------------------------------- artboard IO */

    function handleArtPointerDown(event) {
      if (!event) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      var target = event.target;
      if (target !== canvasRef.current && target !== event.currentTarget) return;
      if (dragRef.current) return;
      dispatch({ type: 'select', id: null });
    }

    function handleArtDoubleClick(event) {
      if (!event) return;
      event.preventDefault();
      if (pointsOf(doc.state).length >= nodeLimit()) {
        setToast({ text: t('studio.toastMaxNodes'), tone: 'error' });
        return;
      }
      var rect = artRef.current ? artRef.current.getBoundingClientRect() : null;
      if (!rect || !rect.width || !rect.height) return;
      var x = MF.util.clamp((event.clientX - rect.left) / rect.width, 0, 1);
      var y = MF.util.clamp((event.clientY - rect.top) / rect.height, 0, 1);
      dispatch({ type: 'addPoint', x: MF.util.round(x, 4), y: MF.util.round(y, 4), at: Date.now() });
    }

    function handleNodePointerDown(event, point) {
      if (!event) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.stopPropagation();
      var rect = artRef.current ? artRef.current.getBoundingClientRect() : null;
      dragRef.current = {
        id: point.id,
        pointerId: event.pointerId,
        rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      };
      try {
        if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        /* pointer capture is an optimisation; dragging still works without it */
      }
      dispatch({ type: 'beginGesture', id: point.id, at: Date.now() });
      dispatch({ type: 'select', id: point.id });
      setInteracting(true);
    }

    function handleNodePointerMove(event) {
      var drag = dragRef.current;
      if (!drag || !event || drag.pointerId !== event.pointerId) return;
      var rect = drag.rect;
      if (!rect || !rect.width || !rect.height) return;
      var x = MF.util.clamp((event.clientX - rect.left) / rect.width, 0, 1);
      var y = MF.util.clamp((event.clientY - rect.top) / rect.height, 0, 1);
      dispatch({ type: 'gestureMove', id: drag.id, x: MF.util.round(x, 4), y: MF.util.round(y, 4) });
    }

    function handleNodePointerEnd(event) {
      var drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      try {
        if (event && event.currentTarget && event.currentTarget.releasePointerCapture) {
          event.currentTarget.releasePointerCapture(drag.pointerId);
        }
      } catch (error) {
        /* capture already released */
      }
      setInteracting(false);
      dispatch({ type: 'endGesture', at: Date.now() });
    }

    /* --------------------------------------------------------------- render */

    function renderIconButton(config) {
      if (MF.ui && MF.ui.IconButton) return h(MF.ui.IconButton, config);
      return h(
        'button',
        {
          type: 'button',
          className: 'mf-st-fallback-btn',
          title: config.label,
          'aria-label': config.label,
          'aria-pressed': typeof config.active === 'boolean' ? config.active : undefined,
          disabled: config.disabled,
          onClick: config.onClick,
        },
        config.label
      );
    }

    function renderButton(config, label) {
      if (MF.ui && MF.ui.Button) return h(MF.ui.Button, config, label);
      return h(
        'button',
        {
          type: 'button',
          className: 'mf-st-fallback-btn',
          disabled: config.disabled,
          onClick: config.onClick,
        },
        label
      );
    }

    var state = doc.state || {};
    var aspect = aspectInfo(state);
    var dimensions = dimensionsOf(state);
    var art = fitArt(stageSize, aspect);
    var points = Array.isArray(state.points) ? state.points : [];
    var canUndo = doc.past.length > 0;
    var canRedo = doc.future.length > 0;
    var busyNow = busy !== null && busy !== undefined;
    var dimLabel = fmt(t('studio.statusDim'), { w: dimensions.width, h: dimensions.height });
    var grainValue = state.grain && state.grain.enabled ? state.grain.amount : t('studio.off');
    var statusText = fmt(t('studio.status'), {
      dim: dimLabel,
      nodes: points.length,
      blur: state.blur == null ? 0 : state.blur,
      grain: grainValue,
      saved: saved ? t('studio.statusSaved') : t('studio.statusSaving'),
    });
    var toastClass =
      'mf-st-toast' + (toast ? ' is-visible' : '') + (toast && toast.tone === 'error' ? ' is-error' : '');

    return h(
      'div',
      { className: 'mf-st-root' },

      // One style element for the whole plugin page (MF.ui.css + MF.panels.css + MF.studioCss).
      h('style', { dangerouslySetInnerHTML: { __html: cssText } }),

      h(
        'header',
        { className: 'mf-st-head' },
        h('div', { className: 'mf-st-mark', 'aria-hidden': 'true' }),
        h(
          'div',
          { className: 'mf-st-titles' },
          h('div', { className: 'mf-st-title' }, t('studio.title')),
          h('div', { className: 'mf-st-subtitle' }, t('studio.subtitle'))
        ),
        h(
          'div',
          { className: 'mf-st-actions' },
          renderIconButton({
            icon: 'undo',
            label: t('studio.undo'),
            onClick: handleUndo,
            disabled: !canUndo,
          }),
          renderIconButton({
            icon: 'redo',
            label: t('studio.redo'),
            onClick: handleRedo,
            disabled: !canRedo,
          }),
          renderButton({ icon: 'dice', onClick: handleRandomize }, t('studio.randomize')),
          renderButton(
            { icon: 'code', onClick: handleCopyCss, disabled: busyNow, busy: busyNow },
            t('studio.copyCss')
          ),
          renderButton(
            {
              variant: 'primary',
              icon: 'download',
              onClick: function () { handleDownloadPng(null); },
              disabled: busyNow,
              busy: busyNow,
            },
            t('studio.exportPng')
          )
        )
      ),

      h(
        'div',
        { className: 'mf-st-body' },

        h(
          'div',
          { className: 'mf-st-col mf-st-col-rail' },
          MF.panels && MF.panels.PresetRail
            ? h(MF.panels.PresetRail, {
                t: t,
                state: state,
                userPresets: userPresets,
                onApply: handleApplyPreset,
                onRandomize: handleRandomize,
                onSavePreset: handleSavePreset,
                onDeletePreset: handleDeletePreset,
                onRecolor: handleRecolor,
              })
            : null
        ),

        h(
          'section',
          { className: 'mf-st-stage', 'aria-label': t('studio.artboard') },
          h(
            'div',
            { className: 'mf-st-stage-bar' },
            h('span', { className: 'mf-st-chip' }, t('aspect.' + aspect.id)),
            h('span', { className: 'mf-st-chip' }, fmt(t('studio.stageNodes'), { n: points.length })),
            h('span', { className: 'mf-st-chip' }, dimLabel),
            h(
              'div',
              { className: 'mf-st-stage-right' },
              h('span', { className: 'mf-st-hint' }, t('studio.hint')),
              renderIconButton({
                icon: 'grid',
                label: t('studio.guides'),
                active: guides,
                size: 26,
                onClick: handleToggleGuides,
              })
            )
          ),
          h(
            'div',
            { className: 'mf-st-stage-wrap', ref: wrapRef },
            h(
              'div',
              {
                className: 'mf-st-art' + (interacting ? ' is-interacting' : ''),
                ref: artRef,
                style: {
                  aspectRatio: aspect.w + ' / ' + aspect.h,
                  width: art.width ? art.width + 'px' : undefined,
                  height: art.height ? art.height + 'px' : undefined,
                },
                onPointerDown: handleArtPointerDown,
                onDoubleClick: handleArtDoubleClick,
              },
              h('canvas', {
                ref: canvasRef,
                className: 'mf-st-canvas',
                role: 'img',
                'aria-label': t('studio.canvasAria'),
              }),
              guides ? h('div', { className: 'mf-st-guides', 'aria-hidden': 'true' }) : null,
              h(
                'div',
                { className: 'mf-st-handles' },
                points.map(function (point, index) {
                  var label = t('mesh.node') + ' ' + (index + 1);
                  var selected = doc.selectedId === point.id;
                  return h('button', {
                    key: point.id,
                    type: 'button',
                    className: 'mf-st-node' + (selected ? ' is-selected' : ''),
                    style: {
                      left: MF.util.round(point.x * 100, 3) + '%',
                      top: MF.util.round(point.y * 100, 3) + '%',
                      '--mf-dot': point.color,
                    },
                    title: label,
                    'aria-label': label,
                    'aria-pressed': selected,
                    onClick: function () {
                      dispatch({ type: 'select', id: point.id });
                    },
                    onPointerDown: function (event) {
                      handleNodePointerDown(event, point);
                    },
                    onPointerMove: handleNodePointerMove,
                    onPointerUp: handleNodePointerEnd,
                    onPointerCancel: handleNodePointerEnd,
                    onLostPointerCapture: handleNodePointerEnd,
                    onDoubleClick: function (event) {
                      event.stopPropagation();
                    },
                  });
                })
              )
            )
          )
        ),

        h(
          'div',
          { className: 'mf-st-col mf-st-col-insp' },
          MF.panels && MF.panels.Inspector
            ? h(MF.panels.Inspector, {
                t: t,
                state: state,
                selectedId: doc.selectedId,
                onChange: handleChange,
                onSelectPoint: handleSelectPoint,
                onRandomizePoints: handleRandomizePoints,
                onExport: exportWiring,
                busy: busy,
                exportScale: exportScale,
                onExportScale: handleExportScale,
              })
            : null
        )
      ),

      h(
        'footer',
        { className: 'mf-st-status' },
        h('span', { className: 'mf-st-status-text' }, statusText),
        h('span', { className: 'mf-st-status-hint' }, t('studio.hintKeys'))
      ),

      h('div', { className: toastClass, role: 'status', 'aria-live': 'polite' }, toast ? toast.text : '')
    );
  }

  return Studio;
})();
