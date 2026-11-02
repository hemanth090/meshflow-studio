/**
 * Registration fragment - the last module in the bundle.
 *
 * Registers the plugin's locale namespace and its three Client contributions:
 *  - `sidebar.panellist` icon whose id addresses the main panel,
 *  - the `main` panel entry keyed `meshflow-studio` (the studio itself),
 *  - a compact launcher in the conversation tool row for quick access.
 *
 * It ends with the Client plugin object the module loader mounts.
 */

var MESHFLOW_NS = 'meshflow-studio';

/** Strings owned by the registration layer (panel icon label and composer launcher). */
MF.strings.register = {
  en: {
    'panel.title': 'MeshFlow Studio',
    'launcher.label': 'MeshFlow',
    'launcher.title': 'Open MeshFlow Studio',
  },
  zh: {
    'panel.title': 'MeshFlow Studio',
    'launcher.label': 'MeshFlow',
    'launcher.title': '打开 MeshFlow Studio',
  },
};

/** Merge every module's dictionary for one locale; first definition wins. */
function mfMergeDictionaries(localeId) {
  var merged = {};
  var groups = MF.strings || {};
  Object.keys(groups).forEach(function (group) {
    var dict = groups[group] && groups[group][localeId];
    if (!dict || typeof dict !== 'object') return;
    Object.keys(dict).forEach(function (key) {
      if (merged[key] === undefined) merged[key] = dict[key];
    });
  });
  return merged;
}

/** Translate helper with a hard fallback so a missing key can never render "undefined". */
function mfTranslate(locale) {
  var bind = locale.bind(MESHFLOW_NS);
  return function t(key) {
    try {
      var value = bind(key);
      if (typeof value === 'string' && value) return value;
    } catch (error) {
      /* fall through */
    }
    return key;
  };
}

/**
 * Sidebar panel icon (owner props: `{ size, active }`).
 * Artwork uses its own colours; the active ring uses the host accent token.
 */
function MfPanelIcon(props) {
  var size = typeof props.size === 'number' && props.size > 0 ? props.size : 24;
  var active = !!props.active;
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      role: 'img',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block', overflow: 'visible' },
    },
    h(
      'defs',
      null,
      h(
        'linearGradient',
        { id: 'mf-nav-base', x1: '0', y1: '0', x2: '1', y2: '1' },
        h('stop', { offset: '0', stopColor: '#111a2e' }),
        h('stop', { offset: '1', stopColor: '#05060c' })
      ),
      h(
        'filter',
        { id: 'mf-nav-soften', x: '-60%', y: '-60%', width: '220%', height: '220%' },
        h('feGaussianBlur', { stdDeviation: '1.7' })
      ),
      h(
        'clipPath',
        { id: 'mf-nav-clip' },
        h('rect', { x: '0', y: '0', width: '24', height: '24', rx: '6' })
      )
    ),
    h(
      'g',
      { clipPath: 'url(#mf-nav-clip)' },
      h('rect', { width: '24', height: '24', fill: 'url(#mf-nav-base)' }),
      h(
        'g',
        { filter: 'url(#mf-nav-soften)' },
        h('circle', { cx: '6.5', cy: '7', r: '7.5', fill: '#5eead4', opacity: '0.9' }),
        h('circle', { cx: '17.5', cy: '6', r: '6.5', fill: '#a78bfa', opacity: '0.9' }),
        h('circle', { cx: '15', cy: '18', r: '8', fill: '#fb7185', opacity: '0.8' }),
        h('circle', { cx: '5', cy: '19', r: '5.5', fill: '#38bdf8', opacity: '0.7' })
      ),
      h('path', {
        d: 'M17.6 7.2l0.66 1.84L20 9.7l-1.74 0.66-0.66 1.84-0.66-1.84L15.2 9.7l1.74-0.66z',
        fill: '#ffffff',
        opacity: '0.9',
      })
    ),
    h('rect', {
      x: '0.5',
      y: '0.5',
      width: '23',
      height: '23',
      rx: '5.5',
      fill: 'none',
      stroke: '#ffffff',
      strokeOpacity: active ? '0.5' : '0.16',
      strokeWidth: active ? '1.4' : '1',
    })
  );
}

/** Compact launcher in the composer tool row: opens the studio panel. */function mfCreateLauncher(layout, t) {
  return function MfStudioLauncher() {
    var hovered = React.useState(false);
    var focused = React.useState(false);
    var isHover = hovered[0];
    var setHover = hovered[1];
    var isFocus = focused[0];
    var setFocus = focused[1];

    var base = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '28px',
      padding: '0 10px 0 8px',
      border: '1px solid ' + (isHover ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-border-l1)'),
      borderRadius: '999px',
      background: isHover ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-1)',
      color: isHover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
      fontFamily: 'inherit',
      fontSize: '11px',
      lineHeight: 1,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      outline: 'none',
      transition: 'color 120ms ease, background-color 120ms ease, border-color 120ms ease',
    };
    if (isFocus) {
      base.outline = '2px solid var(--dsw-alias-brand-primary)';
      base.outlineOffset = '1px';
    }

    return h(
      'button',
      {
        type: 'button',
        title: t('launcher.title'),
        'aria-label': t('launcher.title'),
        style: base,
        onClick: function () {
          if (layout && typeof layout.selectPanel === 'function') {
            layout.selectPanel(MESHFLOW_NS);
          }
        },
        onMouseEnter: function () {
          setHover(true);
        },
        onMouseLeave: function () {
          setHover(false);
        },
        onFocus: function () {
          setFocus(true);
        },
        onBlur: function () {
          setFocus(false);
        },
      },
      h('span', {
        'aria-hidden': true,
        style: {
          width: '10px',
          height: '10px',
          borderRadius: '3px',
          background: 'linear-gradient(135deg, #5eead4 0%, #a78bfa 52%, #fb7185 100%)',
          flexShrink: 0,
        },
      }),
      t('launcher.label')
    );
  };
}

/**
 * Wraps the studio page so it always receives a locale-bound `t` and re-renders when the
 * host locale service publishes a revision (language switch in Settings).
 */
function mfCreateStudioPanel(locale, Studio) {
  return function MfStudioPanel() {
    try {
      if (
        locale &&
        typeof locale.subscribe === 'function' &&
        typeof locale.getSnapshot === 'function' &&
        typeof React.useSyncExternalStore === 'function'
      ) {
        React.useSyncExternalStore(
          function (notify) {
            return locale.subscribe(notify);
          },
          function () {
            return locale.getSnapshot().revision;
          },
          function () {
            return locale.getSnapshot().revision;
          }
        );
      }
    } catch (error) {
      /* a locale subscription must never take the page down */
    }
    return h(Studio, { t: mfTranslate(locale) });
  };
}

/** Install every registration through one effect, isolating each step. */
function mfRegister(ctx, locale) {
  var disposers = [];
  var t = mfTranslate(locale);

  function attempt(step) {
    try {
      var dispose = step();
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      console.error('[meshflow-studio] registration skipped', error);
    }
  }

  attempt(function () {
    return locale.register(MESHFLOW_NS, 'en', mfMergeDictionaries('en'));
  });
  attempt(function () {
    return locale.register(MESHFLOW_NS, 'zh', mfMergeDictionaries('zh'));
  });

  var Studio = MF.Studio;
  var StudioPanel = typeof Studio === 'function' ? mfCreateStudioPanel(locale, Studio) : null;

  attempt(function () {
    return ctx.slots.inject('sidebar.panellist', function () {
      return ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: MESHFLOW_NS,
          order: 20,
          label: function () {
            return mfTranslate(locale)('panel.title');
          },
        },
        MfPanelIcon
      );
    });
  });

  if (StudioPanel) {
    attempt(function () {
      return ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: MESHFLOW_NS }, StudioPanel);
      });
    });
  } else {
    console.error('[meshflow-studio] studio component missing; main panel not registered');
  }

  var layout = typeof ctx.get === 'function' ? ctx.get('layout') : ctx.layout;
  if (layout && typeof layout.selectPanel === 'function') {
    var Launcher = mfCreateLauncher(layout, t);
    attempt(function () {
      return ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: MESHFLOW_NS + '-launcher',
            order: 30,
            label: function () {
              return mfTranslate(locale)('launcher.label');
            },
          },
          Launcher
        );
      });
    });
  }

  return function disposeAll() {
    for (var i = disposers.length - 1; i >= 0; i -= 1) {
      try {
        disposers[i]();
      } catch (error) {
        /* already disposed */
      }
    }
  };
}

MF.clientPlugin = {
  inject: ['slots', 'locale'],
  apply: function apply(ctx) {
    var locale = ctx.locale;
    if (!locale || typeof locale.bind !== 'function') {
      console.error('[meshflow-studio] locale service unavailable; plugin not mounted');
      return;
    }

    var install = function () {
      return mfRegister(ctx, locale);
    };

    if (typeof ctx.effect === 'function') {
      ctx.effect(install, MESHFLOW_NS);
    } else {
      install();
    }
  },
};
