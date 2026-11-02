/**
 * MeshFlow Studio - 25-exporter.js
 *
 * `MF.exporter`: file downloads and clipboard helpers.
 *
 * Everything here is defensive on purpose. The studio may run in a browser with no clipboard
 * permission, no `Blob`, no `URL.createObjectURL` (or in a Node test VM with no DOM at all), and
 * the user can cancel a download at any moment. Therefore:
 *
 *   - no browser API is touched at module-evaluation time - only inside a call;
 *   - every public function swallows its own errors: they never throw and never reject;
 *   - failures are reported as `false` (copy/save) or `null` (download PNG);
 *   - temporary DOM nodes (anchor / textarea) are always removed before returning.
 *
 * Attaches exactly one member: `MF.exporter`.
 */
MF.exporter = (function () {
  'use strict';

  var PNG_MIME = 'image/png';
  var CSS_MIME = 'text/css;charset=utf-8';
  var JSON_MIME = 'application/json;charset=utf-8';
  var FALLBACK_FILE = 'meshflow-studio';

  /* ------------------------------------------------------------------ *
   * Environment guards - every optional global is resolved lazily.
   * ------------------------------------------------------------------ */

  /** Reads a global by name without ever throwing (works in browsers and vm sandboxes). */
  function getGlobal(name) {
    try {
      if (typeof globalThis !== 'undefined' && globalThis) {
        var fromThis = globalThis[name];
        if (fromThis != null) return fromThis;
      }
    } catch (error) {
      /* ignore */
    }
    try {
      if (typeof window !== 'undefined' && window) {
        var fromWindow = window[name];
        if (fromWindow != null) return fromWindow;
      }
    } catch (error) {
      /* ignore */
    }
    return null;
  }

  function getDocument() {
    try {
      if (typeof document !== 'undefined' && document) return document;
    } catch (error) {
      /* ignore */
    }
    return getGlobal('document') || null;
  }

  function getNavigator() {
    try {
      if (typeof navigator !== 'undefined' && navigator) return navigator;
    } catch (error) {
      /* ignore */
    }
    return getGlobal('navigator') || null;
  }

  /** The object-URL API, only when it can actually create URLs. */
  function getUrlApi() {
    var api = getGlobal('URL');
    if (api && typeof api.createObjectURL === 'function') return api;
    return null;
  }

  function getClipboard() {
    var nav = getNavigator();
    return nav && nav.clipboard ? nav.clipboard : null;
  }

  function getHostNode(doc) {
    if (!doc) return null;
    var host = doc.body || doc.documentElement || null;
    if (host && typeof host.appendChild === 'function') return host;
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Data sources - thin wrappers that degrade to empty values.
   * ------------------------------------------------------------------ */

  function model() {
    return MF.model || null;
  }

  function engine() {
    return MF.engine || null;
  }

  /** CSS for the composition, or '' when the model is unavailable / misbehaves. */
  function cssText(state) {
    try {
      var api = model();
      if (api && typeof api.toCSS === 'function') {
        var text = api.toCSS(state);
        if (typeof text === 'string' && text) return text;
      }
    } catch (error) {
      /* ignore */
    }
    return '';
  }

  /** Pretty JSON envelope for the composition, or '' on failure. */
  function jsonText(state) {
    try {
      var api = model();
      if (api && typeof api.toJSON === 'function') {
        var text = api.toJSON(state);
        if (typeof text === 'string' && text) return text;
      }
    } catch (error) {
      /* ignore */
    }
    return '';
  }

  /** PNG data URL for the composition, or '' on failure. */
  function pngDataURL(state, scale) {
    try {
      var api = engine();
      if (api && typeof api.toDataURL === 'function') {
        var url = api.toDataURL(state, scale);
        if (typeof url === 'string' && url) return url;
      }
    } catch (error) {
      /* ignore */
    }
    return '';
  }

  /* ------------------------------------------------------------------ *
   * File names
   * ------------------------------------------------------------------ */

  /** `'meshflow-<slug>-<w>x<h>.png'` derived from dimensions when the model is missing. */
  function fallbackFilename(state, scale) {
    var width = 1600;
    var height = 900;
    try {
      var api = model();
      if (api && typeof api.dimensionsOf === 'function') {
        var dimensions = api.dimensionsOf(state);
        if (dimensions && isFinite(dimensions.width) && isFinite(dimensions.height)) {
          width = Math.max(1, Number(dimensions.width));
          height = Math.max(1, Number(dimensions.height));
        }
      }
    } catch (error) {
      /* keep defaults */
    }
    var factor = Number(scale);
    if (!isFinite(factor) || factor <= 0) factor = 1;
    return 'meshflow-' + Math.round(width * factor) + 'x' + Math.round(height * factor) + '.png';
  }

  /** Public: the PNG file name for a state + export scale. Synchronous; delegates to model. */
  function filename(state, scale) {
    try {
      var api = model();
      if (api && typeof api.filename === 'function') {
        var name = api.filename(state, scale);
        if (typeof name === 'string' && name) return name;
      }
    } catch (error) {
      /* fall back below */
    }
    return fallbackFilename(state, scale);
  }

  /** `foo.png` → `foo.<ext>`, keeping any directory-free base name intact. */
  function withExtension(pngName, ext) {
    var name = typeof pngName === 'string' && pngName ? pngName : FALLBACK_FILE + '.png';
    var dot = name.lastIndexOf('.');
    var slash = name.lastIndexOf('/');
    if (dot > slash && dot > 0) name = name.slice(0, dot);
    return (name || FALLBACK_FILE) + '.' + ext;
  }

  /* ------------------------------------------------------------------ *
   * Download plumbing
   * ------------------------------------------------------------------ */

  /**
   * Clicks a temporary `<a download>` in the document and removes it synchronously.
   * The anchor never survives the call. Returns true when the click was dispatched.
   */
  function triggerDownload(href, name) {
    try {
      if (typeof href !== 'string' || !href) return false;
      var doc = getDocument();
      if (!doc || typeof doc.createElement !== 'function') return false;
      var host = getHostNode(doc);
      if (!host) return false;

      var link = doc.createElement('a');
      if (!link) return false;
      link.href = href;
      link.download = name || FALLBACK_FILE + '.png';
      link.rel = 'noopener noreferrer';
      if (link.style && typeof link.style === 'object') link.style.display = 'none';
      if (typeof link.setAttribute === 'function') {
        try {
          link.setAttribute('aria-hidden', 'true');
        } catch (error) {
          /* ignore */
        }
      }

      host.appendChild(link);
      try {
        if (typeof link.click === 'function') {
          link.click();
          return true;
        }
        var MouseEventCtor = getGlobal('MouseEvent');
        if (typeof MouseEventCtor === 'function' && typeof link.dispatchEvent === 'function') {
          link.dispatchEvent(new MouseEventCtor('click'));
          return true;
        }
        return false;
      } finally {
        if (link.parentNode && typeof link.parentNode.removeChild === 'function') {
          link.parentNode.removeChild(link);
        } else if (typeof link.remove === 'function') {
          link.remove();
        }
      }
    } catch (error) {
      return false;
    }
  }

  function makeBlob(text, mime) {
    var BlobCtor = getGlobal('Blob');
    if (typeof BlobCtor !== 'function') return null;
    try {
      return new BlobCtor([text], { type: mime });
    } catch (error) {
      return null;
    }
  }

  /** Saves text via a Blob + object URL; revokes the URL right after the click. */
  function downloadBlob(text, mime, name) {
    var blob = makeBlob(text, mime);
    if (!blob) return false;
    var urlApi = getUrlApi();
    if (!urlApi) return false;
    var href = '';
    try {
      href = urlApi.createObjectURL(blob);
    } catch (error) {
      href = '';
    }
    if (typeof href !== 'string' || !href) return false;
    var ok = triggerDownload(href, name);
    try {
      if (typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(href);
    } catch (error) {
      /* ignore */
    }
    return ok;
  }

  /* ------------------------------------------------------------------ *
   * Clipboard plumbing
   * ------------------------------------------------------------------ */

  /**
   * `document.execCommand('copy')` path. Creates a hidden textarea, selects the value,
   * copies and always removes the textarea again.
   */
  function legacyCopy(text) {
    try {
      var doc = getDocument();
      if (!doc || typeof doc.createElement !== 'function') return false;
      if (typeof doc.execCommand !== 'function') return false;
      var host = getHostNode(doc);
      if (!host) return false;

      var area = doc.createElement('textarea');
      if (!area) return false;
      area.value = text;
      if (typeof area.setAttribute === 'function') {
        area.setAttribute('readonly', '');
        area.setAttribute('aria-hidden', 'true');
      }
      if (area.style && typeof area.style === 'object') {
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.left = '-1000px';
        area.style.width = '1px';
        area.style.height = '1px';
        area.style.opacity = '0';
        area.style.pointerEvents = 'none';
      }

      host.appendChild(area);
      try {
        if (typeof area.focus === 'function') area.focus();
        if (typeof area.select === 'function') area.select();
        if (typeof area.setSelectionRange === 'function') {
          try {
            area.setSelectionRange(0, String(text).length);
          } catch (error) {
            /* some input types reject selection ranges */
          }
        }
        return doc.execCommand('copy') === true;
      } finally {
        if (area.parentNode && typeof area.parentNode.removeChild === 'function') {
          area.parentNode.removeChild(area);
        } else if (typeof area.remove === 'function') {
          area.remove();
        }
      }
    } catch (error) {
      return false;
    }
  }

  /** Resolves a canvas PNG blob; resolves null when `toBlob` is unavailable or fails. */
  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      var settled = false;
      function settle(blob) {
        if (settled) return;
        settled = true;
        resolve(blob && typeof blob === 'object' ? blob : null);
      }
      try {
        canvas.toBlob(settle, PNG_MIME);
      } catch (error) {
        settle(null);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  /** `Promise<boolean>` - copies plain text. Tries the async clipboard, then execCommand. */
  async function copyText(text) {
    var value = '';
    try {
      value = text == null ? '' : String(text);
    } catch (error) {
      value = '';
    }
    try {
      var clipboard = getClipboard();
      if (clipboard && typeof clipboard.writeText === 'function') {
        try {
          await clipboard.writeText(value);
          return true;
        } catch (error) {
          /* permission denied / not focused: fall through to the legacy path */
        }
      }
    } catch (error) {
      /* fall through */
    }
    return legacyCopy(value);
  }

  /** `Promise<boolean>` - copies the composition as a CSS block. */
  async function copyCSS(state) {
    try {
      var text = cssText(state);
      if (!text) return false;
      return await copyText(text);
    } catch (error) {
      return false;
    }
  }

  /** `Promise<boolean>` - copies the composition as the JSON envelope. */
  async function copyJSON(state) {
    try {
      var text = jsonText(state);
      if (!text) return false;
      return await copyText(text);
    } catch (error) {
      return false;
    }
  }

  /** `Promise<boolean>` - copies the composition as a PNG image, when the browser supports it. */
  async function copyPNG(state, scale) {
    try {
      var clipboard = getClipboard();
      if (!clipboard || typeof clipboard.write !== 'function') return false;
      var ClipboardItemCtor = getGlobal('ClipboardItem');
      if (typeof ClipboardItemCtor !== 'function') return false;
      var api = engine();
      if (!api || typeof api.exportCanvas !== 'function') return false;

      var canvas = api.exportCanvas(state, scale);
      if (!canvas || typeof canvas.toBlob !== 'function') return false;

      var blob = await canvasToBlob(canvas);
      if (!blob) return false;

      await clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** `Promise<string|null>` - renders a PNG and downloads it; resolves the file name. */
  async function downloadPNG(state, scale) {
    try {
      var name = filename(state, scale);
      var href = pngDataURL(state, scale);
      if (!href) return null;
      return triggerDownload(href, name) ? name : null;
    } catch (error) {
      return null;
    }
  }

  /** `Promise<boolean>` - downloads the composition as a `.css` file. */
  async function downloadCSS(state) {
    try {
      var text = cssText(state);
      if (!text) return false;
      var name = withExtension(filename(state, 1), 'css');
      return downloadBlob(text, CSS_MIME, name);
    } catch (error) {
      return false;
    }
  }

  /** `Promise<boolean>` - downloads the composition as a `.json` file. */
  async function downloadJSON(state) {
    try {
      var text = jsonText(state);
      if (!text) return false;
      var name = withExtension(filename(state, 1), 'json');
      return downloadBlob(text, JSON_MIME, name);
    } catch (error) {
      return false;
    }
  }

  return {
    filename: filename,
    downloadPNG: downloadPNG,
    copyText: copyText,
    copyCSS: copyCSS,
    copyJSON: copyJSON,
    copyPNG: copyPNG,
    downloadCSS: downloadCSS,
    downloadJSON: downloadJSON,
  };
})();
