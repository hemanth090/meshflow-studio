/**
 * MeshFlow Studio - 30-controls.js
 *
 * `MF.ui` - presentational React primitives for the studio chrome. Nothing in this module owns
 * application state, touches the DOM directly or imports anything: `React`, `h` and the shared
 * `MF` namespace are provided by the bundle wrapper.
 *
 * Chrome colours are theme tokens only (`var(--dsw-alias-*)`). The stylesheet avoids literal
 * colours completely; artwork colours (swatch values, colour dots) always arrive through props
 * or CSS custom properties set from composition data.
 */

MF.ui = (function () {
  'use strict';

  var useRef = React.useRef;
  var useState = React.useState;
  var useEffect = React.useEffect;

  var idSeq = 0;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var part = arguments[i];
      if (part) out.push(part);
    }
    return out.join(' ');
  }

  /** Stable, unique DOM id without React state (safe during render). */
  function useControlId(prefix) {
    var ref = useRef(null);
    if (ref.current == null) {
      idSeq += 1;
      ref.current = 'mf-ctl-' + (prefix || 'x') + '-' + idSeq;
    }
    return ref.current;
  }

  /* ------------------------------------------------------------------ icons */

  /** Builds a circle from a single arc pair so icons stay one path per shape. */
  function circleD(cx0, cy0, r) {
    return (
      'M' + (cx0 - r) + ' ' + cy0 +
      'a' + r + ' ' + r + ' 0 1 0 ' + (2 * r) + ' 0' +
      'a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0'
    );
  }

  /**
   * Icon geometry: `name -> [path d, ...]` rendered with a round stroke. Kept as data so the
   * `Icon` component stays a single cheap `<svg>` and the set can be reused by other modules.
   */
  var ICON_PATHS = {
    dice: [
      'M6.5 3.5h11a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3z',
      circleD(8.6, 8.6, 1),
      circleD(15.4, 8.6, 1),
      circleD(12, 12, 1),
      circleD(8.6, 15.4, 1),
      circleD(15.4, 15.4, 1),
    ],
    undo: ['M3 3v6h6', 'M3.6 15a9 9 0 1 0 2.1-9.5L3.5 9'],
    redo: ['M21 3v6h-6', 'M20.4 15a9 9 0 1 1-2.1-9.5L20.5 9'],
    plus: ['M12 5v14', 'M5 12h14'],
    trash: [
      'M4 6h16',
      'M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6',
      'M18.5 6l-.8 13a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 6',
      'M10 11v6',
      'M14 11v6',
    ],
    download: [
      'M21 14.5V18a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18v-3.5',
      'M7 10l5 5 5-5',
      'M12 15V3',
    ],
    copy: [
      'M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z',
      'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    ],
    image: [
      'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
      circleD(8.5, 8.5, 1.4),
      'M21 15.5l-4.6-4.6L5.2 21',
    ],
    code: ['M16.5 18l6-6-6-6', 'M7.5 6l-6 6 6 6'],
    sliders: ['M4 7h16', 'M4 12h16', 'M4 17h16', 'M9 5v4', 'M15 10v4', 'M11 15v4'],
    layers: [
      'M12 2.6L21.4 7 12 11.4 2.6 7 12 2.6z',
      'M2.6 12l9.4 4.4 9.4-4.4',
      'M2.6 17l9.4 4.4 9.4-4.4',
    ],
    grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    check: ['M4.5 12.5l5 5L19.5 6.5'],
    chevron: ['M6 9.5l6 6 6-6'],
    sparkle: [
      'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
      'M18.4 15.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z',
    ],
    eye: [
      'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z',
      circleD(12, 12, 2.6),
    ],
    reset: [
      'M20.8 12a8.8 8.8 0 0 0-8.8-8.8 9.5 9.5 0 0 0-6.6 2.7L3 8.2',
      'M3 3.2v5h5',
      'M3.2 12a8.8 8.8 0 0 0 8.8 8.8 9.5 9.5 0 0 0 6.6-2.7l2.4-2.3',
      'M21 20.8v-5h-5',
    ],
    save: [
      'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z',
      'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7',
      'M8 3v5h7',
    ],
    search: [circleD(10.5, 10.5, 6), 'M15.2 15.2L21 21'],
  };

  function Icon(props) {
    var p = props || {};
    var name = p.name && ICON_PATHS[p.name] ? p.name : 'sparkle';
    var size = p.size == null ? 16 : p.size;
    var paths = ICON_PATHS[name];
    var kids = [];
    for (var i = 0; i < paths.length; i += 1) {
      kids.push(h('path', { key: i, d: paths[i] }));
    }
    return h(
      'svg',
      {
        className: cx('mf-ctl-icon', p.className),
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: p.strokeWidth == null ? 1.7 : p.strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': p.label ? undefined : 'true',
        role: p.label ? 'img' : undefined,
        'aria-label': p.label || undefined,
        style: p.style,
      },
      kids
    );
  }

  /* ----------------------------------------------------------------- buttons */

  function Button(props) {
    var p = props || {};
    var variant = p.variant || 'ghost';
    var kids = [];
    if (p.icon) kids.push(h(Icon, { key: 'icon', name: p.icon, size: p.iconSize || 15 }));
    if (p.children != null && p.children !== false) {
      kids.push(h('span', { key: 'label', className: 'mf-ctl-btn__label' }, p.children));
    }
    return h(
      'button',
      {
        type: p.type || 'button',
        className: cx(
          'mf-ctl-btn',
          'mf-ctl-btn--' + variant,
          p.fullWidth && 'mf-ctl-btn--full',
          p.className
        ),
        onClick: p.onClick,
        disabled: !!p.disabled,
        title: p.title || undefined,
        'aria-label': p['aria-label'] || undefined,
        'aria-busy': p.busy ? 'true' : undefined,
        style: p.style,
      },
      kids
    );
  }

  function IconButton(props) {
    var p = props || {};
    var size = p.size == null ? 30 : p.size;
    return h(
      'button',
      {
        type: 'button',
        className: cx('mf-ctl-iconbtn', p.active && 'is-active', p.className),
        'aria-label': p.label,
        'aria-pressed': typeof p.active === 'boolean' ? p.active : undefined,
        title: p.title || p.label,
        disabled: !!p.disabled,
        onClick: p.onClick,
        style: Object.assign(
          { width: size + 'px', height: size + 'px' },
          p.style || {}
        ),
      },
      h(Icon, { name: p.icon, size: p.iconSize || Math.max(12, Math.round(size * 0.52)) })
    );
  }

  /* ----------------------------------------------------------------- inputs */

  function Slider(props) {
    var p = props || {};
    var domId = useControlId('slider');
    var value = Number(p.value);
    if (!isFinite(value)) value = Number(p.min) || 0;
    var min = p.min == null ? 0 : p.min;
    var max = p.max == null ? 100 : p.max;
    var step = p.step == null ? 1 : p.step;
    var pct = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
    var display = typeof p.format === 'function' ? p.format(value) : String(value);
    var hintId = p.hint ? domId + '-hint' : undefined;

    return h(
      'div',
      { className: cx('mf-ctl-slider', p.disabled && 'is-disabled', p.className) },
      h(
        'div',
        { className: 'mf-ctl-slider__head' },
        h('label', { className: 'mf-ctl-label', htmlFor: domId }, p.label),
        h('span', { className: 'mf-ctl-slider__value', 'aria-hidden': 'true' }, display)
      ),
      h('input', {
        id: domId,
        type: 'range',
        className: 'mf-ctl-range',
        min: min,
        max: max,
        step: step,
        value: value,
        disabled: !!p.disabled,
        'aria-valuetext': String(display),
        'aria-describedby': hintId,
        style: { '--mf-ctl-fill': (pct * 100).toFixed(2) + '%' },
        onChange: function (event) {
          if (typeof p.onChange === 'function') p.onChange(Number(event.target.value), event);
        },
      }),
      p.hint ? h('span', { className: 'mf-ctl-hint', id: hintId }, p.hint) : null
    );
  }

  function Toggle(props) {
    var p = props || {};
    return h(
      'div',
      { className: cx('mf-ctl-togglewrap', p.disabled && 'is-disabled', p.className) },
      h(
        'button',
        {
          type: 'button',
          role: 'switch',
          className: cx('mf-ctl-toggle', p.checked && 'is-on'),
          'aria-checked': !!p.checked,
          'aria-label': p['aria-label'] || undefined,
          disabled: !!p.disabled,
          onClick: function (event) {
            if (typeof p.onChange === 'function') p.onChange(!p.checked, event);
          },
        },
        h('span', { className: 'mf-ctl-toggle__label' }, p.label),
        h(
          'span',
          { className: 'mf-ctl-switch', 'aria-hidden': 'true' },
          h('span', { className: 'mf-ctl-switch__dot' })
        )
      ),
      p.hint ? h('span', { className: 'mf-ctl-hint mf-ctl-toggle__hint' }, p.hint) : null
    );
  }

  function Segmented(props) {
    var p = props || {};
    var options = p.options || [];
    return h(
      'div',
      {
        className: cx('mf-ctl-seg', 'mf-ctl-seg--' + (p.size || 'sm'), p.className),
        role: 'group',
        'aria-label': p.label || undefined,
      },
      options.map(function (option, index) {
        var value = option && typeof option === 'object' ? option.value : option;
        var label = option && typeof option === 'object' ? option.label : option;
        var icon = option && typeof option === 'object' ? option.icon : undefined;
        var active = value === p.value;
        return h(
          'button',
          {
            key: String(value) + '-' + index,
            type: 'button',
            className: cx('mf-ctl-seg__btn', active && 'is-active'),
            'aria-pressed': active,
            disabled: !!p.disabled || !!(option && option.disabled),
            onClick: function () {
              if (!active && typeof p.onChange === 'function') p.onChange(value);
            },
          },
          icon ? h(Icon, { name: icon, size: 13 }) : null,
          label != null ? h('span', { className: 'mf-ctl-seg__label' }, label) : null
        );
      })
    );
  }

  function Select(props) {
    var p = props || {};
    var domId = useControlId('select');
    var options = p.options || [];
    return h(
      'div',
      { className: cx('mf-ctl-selectwrap', p.disabled && 'is-disabled', p.className) },
      p.label ? h('label', { className: 'mf-ctl-label', htmlFor: domId }, p.label) : null,
      h(
        'div',
        { className: 'mf-ctl-select' },
        h(
          'select',
          {
            id: domId,
            className: 'mf-ctl-select__input',
            value: p.value,
            disabled: !!p.disabled,
            onChange: function (event) {
              if (typeof p.onChange === 'function') p.onChange(event.target.value, event);
            },
          },
          options.map(function (option, index) {
            var value = option && typeof option === 'object' ? option.value : option;
            var label = option && typeof option === 'object' ? option.label : option;
            return h('option', { key: String(value) + '-' + index, value: value }, label);
          })
        ),
        h('span', { className: 'mf-ctl-select__chev', 'aria-hidden': 'true' })
      )
    );
  }

  /* ---------------------------------------------------------------- colour UI */

  var HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

  /** `#rgb` / `#rrggbb` (inline `#` optional) -> `#rrggbb`, otherwise null. */
  function normalizeHex(input) {
    if (typeof input !== 'string') return null;
    var match = input.replace(/\s+/g, '').match(HEX_RE);
    if (!match) return null;
    var body = match[1].toLowerCase();
    if (body.length === 3) {
      body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
    }
    return '#' + body;
  }

  function ColorField(props) {
    var p = props || {};
    var domId = useControlId('color');
    var safe = normalizeHex(p.value);
    var draftState = useState(safe || '');
    var draft = draftState[0];
    var setDraft = draftState[1];
    var invalidState = useState(false);
    var invalid = invalidState[0];
    var setInvalid = invalidState[1];
    var editing = useRef(false);

    useEffect(
      function () {
        if (editing.current) return;
        setDraft(safe || '');
        setInvalid(false);
      },
      [safe]
    );

    function commit(raw) {
      var next = normalizeHex(raw);
      if (!next) {
        setInvalid(true);
        return;
      }
      setInvalid(false);
      setDraft(next);
      if (next !== safe && typeof p.onChange === 'function') p.onChange(next);
    }

    return h(
      'div',
      {
        className: cx(
          'mf-ctl-color',
          invalid && 'is-invalid',
          p.disabled && 'is-disabled',
          p.className
        ),
      },
      p.label ? h('label', { className: 'mf-ctl-label', htmlFor: domId + '-text' }, p.label) : null,
      h(
        'div',
        { className: 'mf-ctl-color__row' },
        h(
          'span',
          {
            className: 'mf-ctl-color__swatch',
            style: safe ? { '--mf-ctl-color': safe } : undefined,
          },
          h('input', {
            type: 'color',
            className: 'mf-ctl-color__native',
            value: safe || '',
            disabled: !!p.disabled,
            'aria-label': p.label || undefined,
            onChange: function (event) {
              commit(event.target.value);
            },
          })
        ),
        h('input', {
          id: domId + '-text',
          type: 'text',
          className: 'mf-ctl-color__hex',
          value: draft,
          spellCheck: false,
          autoComplete: 'off',
          autoCapitalize: 'off',
          inputMode: 'text',
          maxLength: 7,
          disabled: !!p.disabled,
          'aria-label': p.label || undefined,
          'aria-invalid': invalid ? 'true' : undefined,
          onFocus: function () {
            editing.current = true;
          },
          onChange: function (event) {
            setDraft(event.target.value);
            if (invalid) setInvalid(false);
          },
          onBlur: function () {
            editing.current = false;
            commit(draft);
          },
          onKeyDown: function (event) {
            if (event.key === 'Enter') {
              event.preventDefault();
              editing.current = false;
              commit(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              editing.current = false;
              setDraft(safe || '');
              setInvalid(false);
              event.currentTarget.blur();
            }
          },
        })
      )
    );
  }

  function SwatchRow(props) {
    var p = props || {};
    var colors = p.colors || [];
    var current = normalizeHex(p.value) || p.value;
    return h(
      'div',
      {
        className: cx('mf-ctl-swatches', p.className),
        role: 'group',
        'aria-label': p.label || undefined,
      },
      colors.map(function (color, index) {
        var hex = normalizeHex(color) || color;
        var active =
          !!current &&
          !!hex &&
          String(current).toLowerCase() === String(hex).toLowerCase();
        return h(
          'button',
          {
            key: String(color) + '-' + index,
            type: 'button',
            className: cx('mf-ctl-swatch', active && 'is-active'),
            style: { '--mf-ctl-color': hex },
            title: String(color),
            'aria-label': String(color),
            'aria-pressed': active,
            onClick: function () {
              if (typeof p.onPick === 'function') p.onPick(color, index);
            },
          },
          active ? h(Icon, { name: 'check', size: 11, strokeWidth: 2.4 }) : null
        );
      })
    );
  }

  /* --------------------------------------------------------------- structure */

  function Section(props) {
    var p = props || {};
    var head =
      p.title != null || p.right
        ? h(
            'div',
            { className: 'mf-ctl-section__head' },
            p.title != null ? h('span', { className: 'mf-ctl-section__title' }, p.title) : null,
            p.right ? h('div', { className: 'mf-ctl-section__right' }, p.right) : null
          )
        : null;
    return h(
      'section',
      {
        className: cx('mf-ctl-section', p.dense && 'is-dense', p.className),
        role: 'group',
        'aria-label': p.title != null ? String(p.title) : undefined,
      },
      head,
      h('div', { className: 'mf-ctl-section__body' }, p.children)
    );
  }

  function Tabs(props) {
    var p = props || {};
    var tabs = p.tabs || [];
    var baseId = useControlId('tabs');
    var refs = useRef({});

    function moveFocus(event) {
      var count = tabs.length;
      if (!count) return;
      var index = -1;
      for (var i = 0; i < count; i += 1) {
        if (tabs[i].id === p.value) {
          index = i;
          break;
        }
      }
      if (index < 0) index = 0;
      var next = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = count - 1;
      if (next < 0) return;
      event.preventDefault();
      var target = tabs[next];
      if (typeof p.onChange === 'function') p.onChange(target.id);
      var node = refs.current[target.id];
      if (node && typeof node.focus === 'function') node.focus();
    }

    return h(
      'div',
      {
        className: cx('mf-ctl-tabs', p.className),
        role: 'tablist',
        'aria-label': p.label || undefined,
        onKeyDown: moveFocus,
      },
      tabs.map(function (tab) {
        var active = tab.id === p.value;
        return h(
          'button',
          {
            key: tab.id,
            id: baseId + '-tab-' + tab.id,
            type: 'button',
            role: 'tab',
            'aria-selected': !!active,
            'aria-controls': tab.panelId || undefined,
            tabIndex: active ? 0 : -1,
            className: cx('mf-ctl-tab', active && 'is-active'),
            ref: function (node) {
              refs.current[tab.id] = node;
            },
            onClick: function () {
              if (!active && typeof p.onChange === 'function') p.onChange(tab.id);
            },
          },
          tab.icon ? h(Icon, { name: tab.icon, size: 13 }) : null,
          h('span', { className: 'mf-ctl-tab__label' }, tab.label)
        );
      })
    );
  }

  function Row(props) {
    var p = props || {};
    return h(
      'div',
      { className: cx('mf-ctl-row', p.className) },
      h(
        'div',
        { className: 'mf-ctl-row__main' },
        p.label != null ? h('span', { className: 'mf-ctl-row__label' }, p.label) : null,
        p.hint ? h('span', { className: 'mf-ctl-hint' }, p.hint) : null
      ),
      h('div', { className: 'mf-ctl-row__ctrl' }, p.children)
    );
  }

  function Badge(props) {
    var p = props || {};
    return h(
      'span',
      { className: cx('mf-ctl-badge', 'mf-ctl-badge--' + (p.tone || 'neutral'), p.className) },
      p.children
    );
  }

  function Kbd(props) {
    var p = props || {};
    return h('kbd', { className: cx('mf-ctl-kbd', p.className) }, p.children);
  }

  /* ------------------------------------------------------------------- sheet */

  var CSS = `
/* MeshFlow Studio - control primitives. Chrome colours: --dsw-alias-* tokens only. */

.mf-ctl-icon {
  display: block;
  flex: none;
  pointer-events: none;
}

/* ---------------------------------------------------------------- type */

.mf-ctl-label {
  display: block;
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-secondary);
}

.mf-ctl-hint {
  display: block;
  font-size: 10.5px;
  font-weight: 400;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.85;
}

/* ---------------------------------------------------------------- buttons */

.mf-ctl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease,
    opacity 0.14s ease;
}

.mf-ctl-btn__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-ctl-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l2);
}

.mf-ctl-btn:active:not(:disabled) {
  opacity: 0.8;
}

.mf-ctl-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.mf-ctl-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.mf-ctl-btn--full {
  display: flex;
  width: 100%;
}

.mf-ctl-btn--primary {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}

.mf-ctl-btn--primary:hover:not(:disabled) {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  opacity: 0.88;
}

.mf-ctl-btn--quiet {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}

.mf-ctl-btn--quiet:hover:not(:disabled) {
  border-color: transparent;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-btn--danger {
  border-color: var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
}

.mf-ctl-btn--danger:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-state-error-primary);
}

@supports (background: color-mix(in srgb, currentColor 8%, transparent)) {
  .mf-ctl-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1));
  }
  .mf-ctl-btn--primary:hover:not(:disabled) {
    background: var(--dsw-alias-brand-primary);
  }
  .mf-ctl-btn--quiet:hover:not(:disabled),
  .mf-ctl-btn--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-base));
  }
}

.mf-ctl-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  box-sizing: border-box;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, opacity 0.14s ease;
}

.mf-ctl-iconbtn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-iconbtn.is-active {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-iconbtn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.mf-ctl-iconbtn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

@supports (background: color-mix(in srgb, currentColor 8%, transparent)) {
  .mf-ctl-iconbtn:hover:not(:disabled),
  .mf-ctl-iconbtn.is-active {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  }
}

/* ---------------------------------------------------------------- inputs */

.mf-ctl-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  transition: border-color 0.14s ease, background-color 0.14s ease;
  -webkit-appearance: none;
  appearance: none;
}

.mf-ctl-input::placeholder {
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
}

.mf-ctl-input:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}

.mf-ctl-input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
  border-color: var(--dsw-alias-border-l2);
}

.mf-ctl-input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mf-ctl-input::-webkit-search-cancel-button,
.mf-ctl-input::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}

/* --------------------------------------------------------------- sliders */

.mf-ctl-slider {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mf-ctl-slider.is-disabled {
  opacity: 0.45;
}

.mf-ctl-slider__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.mf-ctl-slider__value {
  flex: none;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  letter-spacing: 0.01em;
}

.mf-ctl-range {
  --mf-ctl-fill: 0%;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 18px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y;
  -webkit-appearance: none;
  appearance: none;
}

.mf-ctl-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background:
    linear-gradient(
      to right,
      var(--dsw-alias-brand-primary) 0 var(--mf-ctl-fill),
      var(--dsw-alias-border-l2) var(--mf-ctl-fill) 100%
    );
}

.mf-ctl-range::-webkit-slider-thumb {
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border: 1.5px solid var(--dsw-alias-brand-primary);
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
  cursor: grab;
  -webkit-appearance: none;
  appearance: none;
  transition: transform 0.12s ease;
}

.mf-ctl-range:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: scale(1.1);
}

.mf-ctl-range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
}

.mf-ctl-range::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
}

.mf-ctl-range::-moz-range-thumb {
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--dsw-alias-brand-primary);
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
  cursor: grab;
}

.mf-ctl-range:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 6px;
}

.mf-ctl-range:disabled {
  cursor: not-allowed;
}

/* --------------------------------------------------------------- toggles */

.mf-ctl-togglewrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mf-ctl-togglewrap.is-disabled {
  opacity: 0.45;
}

.mf-ctl-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.mf-ctl-toggle__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mf-ctl-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 6px;
}

.mf-ctl-toggle:disabled {
  cursor: not-allowed;
}

.mf-ctl-toggle__hint {
  padding-left: 0;
}

.mf-ctl-switch {
  position: relative;
  flex: none;
  box-sizing: border-box;
  width: 30px;
  height: 17px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-border-l2);
  transition: background-color 0.16s ease, border-color 0.16s ease;
}

.mf-ctl-toggle.is-on .mf-ctl-switch {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
}

.mf-ctl-switch__dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  transition: transform 0.16s ease, background-color 0.16s ease;
}

.mf-ctl-toggle.is-on .mf-ctl-switch__dot {
  background: var(--dsw-alias-bg-base);
  transform: translateX(13px);
}

/* ------------------------------------------------------------- segmented */

.mf-ctl-seg {
  display: inline-flex;
  gap: 2px;
  box-sizing: border-box;
  max-width: 100%;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
}

.mf-ctl-seg--block {
  display: flex;
  width: 100%;
}

.mf-ctl-seg__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.mf-ctl-seg--block .mf-ctl-seg__btn {
  flex: 1 1 0;
  padding: 0 5px;
}

.mf-ctl-seg__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-ctl-seg__btn:hover:not(:disabled):not(.is-active) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-seg__btn.is-active {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}

.mf-ctl-seg__btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.mf-ctl-seg__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mf-ctl-seg--lg .mf-ctl-seg__btn {
  height: 26px;
  font-size: 12px;
}

@supports (background: color-mix(in srgb, currentColor 8%, transparent)) {
  .mf-ctl-seg__btn:hover:not(:disabled):not(.is-active) {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1));
  }
}

/* ---------------------------------------------------------------- select */

.mf-ctl-selectwrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mf-ctl-selectwrap.is-disabled {
  opacity: 0.45;
}

.mf-ctl-select {
  position: relative;
  display: block;
  min-width: 0;
}

.mf-ctl-select__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 26px 0 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.mf-ctl-select__input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.mf-ctl-select__chev {
  position: absolute;
  top: 50%;
  right: 10px;
  width: 6px;
  height: 6px;
  margin-top: -4px;
  border-right: 1.5px solid var(--dsw-alias-label-secondary);
  border-bottom: 1.5px solid var(--dsw-alias-label-secondary);
  transform: rotate(45deg);
  pointer-events: none;
}

/* ----------------------------------------------------------- colour field */

.mf-ctl-color {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mf-ctl-color.is-disabled {
  opacity: 0.45;
}

.mf-ctl-color__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mf-ctl-color__swatch {
  position: relative;
  display: block;
  flex: none;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--mf-ctl-color, var(--dsw-alias-bg-layer-2));
  box-shadow: inset 0 0 0 1px var(--dsw-alias-bg-layer-1);
}

.mf-ctl-color__swatch:focus-within {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.mf-ctl-color__native {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
  cursor: pointer;
}

.mf-ctl-color__native::-webkit-color-swatch-wrapper {
  padding: 0;
}

.mf-ctl-color__native::-webkit-color-swatch {
  border: 0;
}

.mf-ctl-color__hex {
  box-sizing: border-box;
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  -webkit-appearance: none;
  appearance: none;
}

.mf-ctl-color__hex:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.mf-ctl-color.is-invalid .mf-ctl-color__hex {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

/* --------------------------------------------------------------- swatches */

.mf-ctl-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.mf-ctl-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: var(--mf-ctl-color, transparent);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.mf-ctl-swatch:hover {
  transform: translateY(-1px);
}

.mf-ctl-swatch.is-active {
  box-shadow:
    0 0 0 2px var(--dsw-alias-bg-base),
    0 0 0 4px var(--dsw-alias-label-primary);
}

.mf-ctl-swatch:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 3px;
}

/* ---------------------------------------------------------------- section */

.mf-ctl-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding-top: 11px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}

.mf-ctl-section:first-child {
  padding-top: 0;
  border-top: 0;
}

.mf-ctl-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
}

.mf-ctl-section__title {
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}

.mf-ctl-section__right {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: -3px -3px -3px 0;
}

.mf-ctl-section__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.mf-ctl-section.is-dense {
  padding-top: 8px;
}

.mf-ctl-section.is-dense .mf-ctl-section__body {
  gap: 6px;
}

/* ------------------------------------------------------------------ tabs */

.mf-ctl-tabs {
  display: flex;
  align-items: stretch;
  gap: 1px;
  box-sizing: border-box;
  min-width: 0;
  padding: 0 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  overflow: hidden;
}

.mf-ctl-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1 1 0;
  min-width: 0;
  height: 34px;
  padding: 0 3px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease, background-color 0.14s ease;
}

.mf-ctl-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-ctl-tab:hover:not(.is-active) {
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-tab.is-active {
  border-bottom-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-tab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -4px;
  border-radius: 6px;
}

/* ------------------------------------------------------------------- row */

.mf-ctl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.mf-ctl-row__main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.mf-ctl-row__label {
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--dsw-alias-label-primary);
}

.mf-ctl-row__ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  min-width: 0;
}

/* ----------------------------------------------------------- badge and kbd */

.mf-ctl-badge {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 18px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
}

.mf-ctl-badge--brand {
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  box-shadow: none;
}

.mf-ctl-badge--success {
  color: var(--dsw-alias-state-success-primary);
}

.mf-ctl-badge--warn {
  color: var(--dsw-alias-state-warn-primary);
}

.mf-ctl-badge--error {
  color: var(--dsw-alias-state-error-primary);
}

.mf-ctl-badge--idle {
  color: var(--dsw-alias-state-idle-primary);
}

.mf-ctl-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

/* ------------------------------------------------------------- reduced motion */

@media (prefers-reduced-motion: reduce) {
  .mf-ctl-btn,
  .mf-ctl-iconbtn,
  .mf-ctl-seg__btn,
  .mf-ctl-tab,
  .mf-ctl-switch,
  .mf-ctl-switch__dot,
  .mf-ctl-swatch,
  .mf-ctl-range::-webkit-slider-thumb,
  .mf-ctl-input,
  .mf-ctl-select__input {
    transition: none !important;
  }

  .mf-ctl-swatch:hover,
  .mf-ctl-range:active::-webkit-slider-thumb {
    transform: none !important;
  }
}
`;

  return {
    Icon: Icon,
    Button: Button,
    IconButton: IconButton,
    Slider: Slider,
    Toggle: Toggle,
    Segmented: Segmented,
    Select: Select,
    ColorField: ColorField,
    SwatchRow: SwatchRow,
    Section: Section,
    Tabs: Tabs,
    Row: Row,
    Badge: Badge,
    Kbd: Kbd,
    icons: ICON_PATHS,
    css: CSS,
  };
})();

MF.strings = MF.strings || {};
MF.strings.ui = {
  en: {
    'ui.undo': 'Undo',
    'ui.redo': 'Redo',
    'ui.add': 'Add',
    'ui.remove': 'Remove',
    'ui.close': 'Close',
    'ui.reset': 'Reset',
    'ui.randomize': 'Randomize',
    'ui.copy': 'Copy',
    'ui.download': 'Download',
    'ui.save': 'Save',
    'ui.delete': 'Delete',
    'ui.search': 'Search',
    'ui.apply': 'Apply',
    'ui.check': 'Confirm',
    'ui.clear': 'Clear',
    'ui.more': 'More options',
    'ui.preview': 'Preview',
    'ui.expand': 'Expand',
    'ui.collapse': 'Collapse',
    'ui.select': 'Select',
    'ui.drag': 'Drag to move',
  },
  zh: {
    'ui.undo': '撤销',
    'ui.redo': '重做',
    'ui.add': '添加',
    'ui.remove': '移除',
    'ui.close': '关闭',
    'ui.reset': '重置',
    'ui.randomize': '随机',
    'ui.copy': '复制',
    'ui.download': '下载',
    'ui.save': '保存',
    'ui.delete': '删除',
    'ui.search': '搜索',
    'ui.apply': '应用',
    'ui.check': '确认',
    'ui.clear': '清除',
    'ui.more': '更多选项',
    'ui.preview': '预览',
    'ui.expand': '展开',
    'ui.collapse': '收起',
    'ui.select': '选择',
    'ui.drag': '拖动移动',
  },
};
