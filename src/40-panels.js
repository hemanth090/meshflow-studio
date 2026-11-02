/**
 * MeshFlow Studio - 40-panels.js
 *
 * `MF.panels` - the studio's side panels: preset rail (thumbnails, palettes, user presets),
 * layer list and the four-tab inspector (mesh / effects / glass / export).
 *
 * Panels are deliberately dumb: they receive `state`, `t` and callbacks and never mutate state.
 * Every state change is built with object spreads (or `MF.model` helpers) and handed back through
 * `onChange(nextState, coalesce)`. The exporter is never touched here - `onExport` is wired by
 * `MF.Studio`. The only DOM/canvas work happens inside `PresetThumb`'s effect.
 */

MF.panels = (function () {
  'use strict';

  var UI = MF.ui;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

  /* ------------------------------------------------------------------ utils */

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i]) out.push(arguments[i]);
    }
    return out.join(' ');
  }

  /** Always returns a callable translator, even if a host forgets to pass one. */
  function tr(t) {
    if (typeof t === 'function') return t;
    return function (key) {
      return key;
    };
  }

  /** First key that the dictionary resolves (used for keys owned by other modules). */
  function tFirst(t, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var value = t(keys[i]);
      if (value != null && value !== '' && value !== keys[i]) return value;
    }
    return t(keys[keys.length - 1]);
  }

  function fmtPct(value) {
    var pct = Number(value) * 100;
    if (!isFinite(pct)) return '0%';
    var rounded = Math.round(pct * 10) / 10;
    var text = Math.abs(rounded - Math.round(rounded)) < 0.01 ? String(Math.round(rounded)) : rounded.toFixed(1);
    return text + '%';
  }

  function fmtInt(value) {
    return String(Math.round(Number(value)));
  }

  function modelLimits() {
    return (MF.model && MF.model.LIMITS) || {};
  }

  function limitOf(key, fallback) {
    var pair = modelLimits()[key];
    return pair && pair.length === 2 ? pair : fallback;
  }

  function dimensionText(state, scale) {
    try {
      if (MF.model && typeof MF.model.formatDimensions === 'function') {
        var text = MF.model.formatDimensions(state, scale);
        if (text) return text;
      }
      if (MF.model && typeof MF.model.dimensionsOf === 'function') {
        var dims = MF.model.dimensionsOf(state);
        return Math.round(dims.width * scale) + ' × ' + Math.round(dims.height * scale);
      }
    } catch (err) {
      /* preview only - never break the panel */
    }
    return '';
  }

  function stateSignature(state) {
    try {
      return JSON.stringify(state);
    } catch (err) {
      return '';
    }
  }

  /* ------------------------------------------------------------ preset thumb */

  /**
   * Miniature composition preview. Drawing happens in an effect (never during render), the pixel
   * ratio is capped at 1 for cheap thumbnails and the scheduled frame is cancelled on unmount.
   */
  function PresetThumb(props) {
    var p = props || {};
    var width = p.width == null ? 112 : Math.max(24, Math.round(p.width));
    var boxHeight;

    if (p.height != null) {
      boxHeight = Math.max(1, Math.round(p.height));
    } else {
      var ratio = 9 / 16;
      try {
        var aspect = MF.model && typeof MF.model.aspectOf === 'function' ? MF.model.aspectOf(p.state) : null;
        if (aspect && aspect.w > 0 && aspect.h > 0) ratio = aspect.h / aspect.w;
      } catch (err) {
        ratio = 9 / 16;
      }
      boxHeight = Math.max(1, Math.round(width * ratio));
    }

    var canvasRef = useRef(null);

    useEffect(
      function () {
        var canvas = canvasRef.current;
        if (!canvas || typeof window === 'undefined') return undefined;
        var engine = MF.engine;
        if (!engine || typeof engine.render !== 'function') return undefined;

        var raf = window.requestAnimationFrame(function () {
          try {
            engine.render(canvas, p.state, {
              width: width,
              height: boxHeight,
              pixelRatio: 1,
              draft: true,
            });
          } catch (err) {
            /* a broken preview must never take the rail down */
          }
        });

        return function () {
          window.cancelAnimationFrame(raf);
        };
      },
      [p.state, width, boxHeight]
    );

    return h(
      'div',
      {
        className: cx('mf-pnl-thumb', p.className),
        style: {
          '--mf-pnl-thumb-width': width + 'px',
          aspectRatio: width + ' / ' + boxHeight,
          height: 'auto',
        },
        'aria-hidden': 'true',
      },
      h('canvas', {
        ref: canvasRef,
        className: 'mf-pnl-thumb__canvas',
        width: Math.max(1, width),
        height: Math.max(1, boxHeight),
      })
    );
  }

  /* ---------------------------------------------------------------- palettes */

  function PaletteGrid(props) {
    var t = tr(props.t);
    var palettes = (MF.model && MF.model.PALETTES) || [];
    return h(
      'div',
      {
        className: cx('mf-pnl-palettes', props.className),
        role: 'group',
        'aria-label': props.label || undefined,
      },
      palettes.map(function (palette) {
        var name = t(palette.nameKey);
        var active = palette.id === props.value;
        return h(
          'button',
          {
            key: palette.id,
            type: 'button',
            className: cx('mf-pnl-palette', active && 'is-active'),
            'aria-pressed': active,
            'aria-label': name,
            title: name,
            onClick: function () {
              if (typeof props.onPick === 'function') props.onPick(palette.id);
            },
          },
          h(
            'span',
            { className: 'mf-pnl-palette__dots', 'aria-hidden': 'true' },
            (palette.colors || []).slice(0, 5).map(function (color, index) {
              return h('span', {
                key: index,
                className: 'mf-pnl-palette__dot',
                style: { '--mf-pnl-dot': color },
              });
            })
          ),
          h('span', { className: 'mf-pnl-palette__name' }, name)
        );
      })
    );
  }

  /* ------------------------------------------------------------ preset cards */

  function PresetCardBase(props) {
    var p = props;
    return h(
      'button',
      {
        type: 'button',
        className: cx('mf-pnl-preset', p.selected && 'is-selected'),
        'aria-current': p.selected ? 'true' : undefined,
        title: p.name,
        onClick: function () {
          if (typeof p.onApply === 'function' && p.state) p.onApply(p.state);
        },
      },
      h(PresetThumb, { state: p.state, width: 112, height: 63 }),
      h(
        'span',
        { className: 'mf-pnl-preset__meta' },
        h('span', { className: 'mf-pnl-preset__name' }, p.name),
        p.tag ? h('span', { className: 'mf-pnl-preset__tag' }, p.tag) : null
      )
    );
  }

  var PresetCard = React.memo(PresetCardBase);

  /* ------------------------------------------------------------- preset rail */

  function PresetRail(props) {
    var t = tr(props.t);
    var state = props.state || {};
    var presets = (MF.model && MF.model.PRESETS) || [];
    var userPresets = props.userPresets || [];

    var queryState = useState('');
    var query = queryState[0];
    var setQuery = queryState[1];
    var nameState = useState('');
    var nameDraft = nameState[0];
    var setNameDraft = nameState[1];

    var presetSigs = useMemo(
      function () {
        var map = {};
        for (var i = 0; i < presets.length; i += 1) {
          map[presets[i].id] = stateSignature(presets[i].state);
        }
        return map;
      },
      [presets]
    );

    var userSigs = useMemo(
      function () {
        var map = {};
        for (var i = 0; i < userPresets.length; i += 1) {
          map[userPresets[i].id] = stateSignature(userPresets[i].state);
        }
        return map;
      },
      [userPresets]
    );

    var currentSig = stateSignature(state);
    var needle = String(query || '').trim().toLowerCase();

    var visiblePresets = useMemo(
      function () {
        if (!needle) return presets;
        return presets.filter(function (preset) {
          var text = (t(preset.nameKey) + ' ' + t(preset.tagKey)).toLowerCase();
          return text.indexOf(needle) !== -1;
        });
      },
      [presets, needle, t]
    );

    var visibleUser = useMemo(
      function () {
        if (!needle) return userPresets;
        return userPresets.filter(function (preset) {
          return String(preset.name || '').toLowerCase().indexOf(needle) !== -1;
        });
      },
      [userPresets, needle]
    );

    function commitSave() {
      var name = String(nameDraft || '').trim().slice(0, 32);
      if (!name) return;
      if (typeof props.onSavePreset === 'function') props.onSavePreset(name);
      setNameDraft('');
    }

    var presetCards = visiblePresets.map(function (preset) {
      return h(PresetCard, {
        key: preset.id,
        state: preset.state,
        name: t(preset.nameKey),
        tag: t(preset.tagKey),
        selected: !!currentSig && presetSigs[preset.id] === currentSig,
        onApply: props.onApply,
      });
    });

    var userCards = visibleUser.map(function (preset) {
      return h(
        'div',
        { key: preset.id, className: 'mf-pnl-userpreset' },
        h(PresetCard, {
          state: preset.state,
          name: String(preset.name || ''),
          tag: null,
          selected: !!currentSig && userSigs[preset.id] === currentSig,
          onApply: props.onApply,
        }),
        h(UI.IconButton, {
          className: 'mf-pnl-userpreset__del',
          icon: 'trash',
          label: t('ui.delete'),
          title: t('ui.delete'),
          size: 22,
          onClick: function () {
            if (typeof props.onDeletePreset === 'function') props.onDeletePreset(preset.id);
          },
        })
      );
    });

    var searchInput = h('input', {
      className: 'mf-ctl-input mf-pnl-search__input',
      type: 'search',
      value: query,
      placeholder: t('panels.searchPh'),
      'aria-label': t('panels.searchPh'),
      spellCheck: false,
      onChange: function (event) {
        setQuery(event.target.value);
      },
    });

    return h(
      'div',
      { className: 'mf-pnl-presets' },
      h(
        'div',
        { className: 'mf-pnl-presets__head' },
        h('h2', { className: 'mf-pnl-presets__title' }, t('panels.presets')),
        h(UI.IconButton, {
          icon: 'dice',
          label: t('ui.randomize'),
          title: t('ui.randomize'),
          size: 26,
          onClick: props.onRandomize,
        })
      ),
      h(
        'div',
        { className: 'mf-pnl-presets__search' },
        h(
          'span',
          { className: 'mf-pnl-search__icon', 'aria-hidden': 'true' },
          h(UI.Icon, { name: 'search', size: 13 })
        ),
        searchInput
      ),
      h(
        'div',
        { className: 'mf-pnl-presets__actions' },
        h(
          UI.Button,
          {
            variant: 'primary',
            icon: 'sparkle',
            fullWidth: true,
            onClick: props.onRandomize,
          },
          t('panels.surprise')
        )
      ),
      h(
        'div',
        { className: 'mf-pnl-presets__palettes' },
        h(
          UI.Section,
          { title: t('panels.palettes') },
          h(PaletteGrid, {
            t: t,
            value: state.palette,
            onPick: props.onRecolor,
            label: t('panels.palettes'),
          })
        )
      ),
      h(
        'div',
        { className: 'mf-pnl-presets__body' },
        h(
          UI.Section,
          { title: t('panels.templates') },
          visiblePresets.length
            ? h('div', { className: 'mf-pnl-presets__grid' }, presetCards)
            : h(
                'div',
                { className: 'mf-pnl-empty' },
                h(UI.Icon, { name: 'search', size: 16 }),
                h('span', null, t('panels.empty'))
              )
        ),
        h(
          UI.Section,
          { title: t('panels.myPresets') },
          h(
            'div',
            { className: 'mf-pnl-save' },
            h('input', {
              className: 'mf-ctl-input mf-pnl-save__input',
              type: 'text',
              value: nameDraft,
              maxLength: 32,
              placeholder: t('panels.saveName'),
              'aria-label': t('panels.saveName'),
              spellCheck: false,
              onChange: function (event) {
                setNameDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitSave();
                }
              },
            }),
            h(
              UI.Button,
              {
                icon: 'save',
                disabled: !String(nameDraft || '').trim(),
                onClick: commitSave,
              },
              t('panels.save')
            )
          ),
          visibleUser.length
            ? h('div', { className: 'mf-pnl-presets__grid' }, userCards)
            : h('p', { className: 'mf-pnl-muted' }, t('panels.noUserPresets'))
        )
      )
    );
  }

  /* ---------------------------------------------------------------- layers */

  function LayerList(props) {
    var t = tr(props.t);
    var state = props.state || {};
    var points = state.points || [];
    var minPoints = limitOf('points', [2, 12])[0];
    var maxPoints = limitOf('points', [2, 12])[1];

    var rows = points.map(function (point, index) {
      var selected = point.id === props.selectedId;
      var name = t('mesh.node') + ' ' + (index + 1);
      return h(
        'div',
        {
          key: point.id,
          className: cx('mf-pnl-layer', selected && 'is-selected'),
          role: 'listitem',
        },
        h(
          'button',
          {
            type: 'button',
            className: 'mf-pnl-layer__main',
            'aria-pressed': selected,
            'aria-label': name,
            onClick: function () {
              if (typeof props.onSelect === 'function') props.onSelect(point.id);
            },
          },
          h('span', {
            className: 'mf-pnl-layer__dot',
            style: { '--mf-pnl-dot': point.color },
            'aria-hidden': 'true',
          }),
          h('span', { className: 'mf-pnl-layer__name' }, name),
          h(
            'span',
            { className: 'mf-pnl-layer__coords', 'aria-hidden': 'true' },
            fmtPct(point.x) + ' · ' + fmtPct(point.y)
          )
        ),
        h(UI.IconButton, {
          icon: 'trash',
          label: t('ui.remove'),
          title: t('ui.remove'),
          size: 24,
          disabled: points.length <= minPoints,
          onClick: function () {
            if (typeof props.onRemove === 'function') props.onRemove(point.id);
          },
        })
      );
    });

    return h(
      'div',
      { className: 'mf-pnl-layers' },
      h('div', { className: 'mf-pnl-layers__list', role: 'list' }, rows),
      h(
        UI.Button,
        {
          icon: 'plus',
          fullWidth: true,
          disabled: points.length >= maxPoints,
          onClick: function () {
            if (typeof props.onAdd === 'function') props.onAdd();
          },
        },
        t('mesh.addNode')
      )
    );
  }

  /* --------------------------------------------------------------- inspector */

  function mixOptions(t) {
    var modes = (MF.model && MF.model.MIX_MODES) || [
      'normal',
      'screen',
      'overlay',
      'soft-light',
      'lighter',
    ];
    return modes.map(function (mode) {
      return {
        value: mode,
        label: tFirst(t, ['mix.' + mode, 'panels.mix.' + mode]),
      };
    });
  }

  function blendOptions(t) {
    var blends = (MF.model && MF.model.GRAIN_BLENDS) || ['overlay', 'soft-light', 'normal'];
    return blends.map(function (blend) {
      return {
        value: blend,
        label: tFirst(t, ['blend.' + blend, 'panels.blend.' + blend]),
      };
    });
  }

  function Inspector(props) {
    var t = tr(props.t);
    var state = props.state || {};
    var points = state.points || [];
    var glass = state.glass || {};
    var grain = state.grain || {};
    var vignette = state.vignette || {};

    var tabState = useState('mesh');
    var tab = tabState[0];
    var setTab = tabState[1];

    var scale = Number(props.exportScale) || 1;

    var selected = null;
    for (var i = 0; i < points.length; i += 1) {
      if (points[i].id === props.selectedId) {
        selected = points[i];
        break;
      }
    }
    if (!selected) selected = points[0] || null;
    var selectedIndex = selected ? points.indexOf(selected) : -1;

    function emit(next, coalesce) {
      if (typeof props.onChange === 'function') props.onChange(next, coalesce === true);
    }

    function patchPoint(patch, coalesce) {
      if (!selected || !MF.model || typeof MF.model.patchPoint !== 'function') return;
      emit(MF.model.patchPoint(state, selected.id, patch), coalesce === true);
    }

    function patchGrain(patch, coalesce) {
      emit({ ...state, grain: { ...grain, ...patch } }, coalesce === true);
    }

    function patchVignette(patch, coalesce) {
      emit({ ...state, vignette: { ...vignette, ...patch } }, coalesce === true);
    }

    function patchGlass(patch, coalesce) {
      emit({ ...state, glass: { ...glass, ...patch } }, coalesce === true);
    }

    function addNode() {
      if (!MF.model || typeof MF.model.addPoint !== 'function') return;
      var next = MF.model.addPoint(state);
      var known = {};
      for (var j = 0; j < points.length; j += 1) known[points[j].id] = true;
      var added = null;
      for (var k = 0; k < next.points.length; k += 1) {
        if (!known[next.points[k].id]) added = next.points[k];
      }
      emit(next, false);
      if (added && typeof props.onSelectPoint === 'function') props.onSelectPoint(added.id);
    }

    function removeNode(id) {
      if (!MF.model || typeof MF.model.removePoint !== 'function') return;
      var next = MF.model.removePoint(state, id);
      emit(next, false);
      var stillThere = false;
      for (var j = 0; j < next.points.length; j += 1) {
        if (next.points[j].id === props.selectedId) stillThere = true;
      }
      if (!stillThere && next.points[0] && typeof props.onSelectPoint === 'function') {
        props.onSelectPoint(next.points[0].id);
      }
    }

    function recolor(paletteId) {
      if (!MF.model || typeof MF.model.recolor !== 'function') return;
      emit(MF.model.recolor(state, paletteId), false);
    }

    function scaleArg() {
      return Number(props.exportScale) || 1;
    }

    function actionBusy(key) {
      var busy = props.busy;
      if (!busy) return false;
      if (typeof busy === 'string') return busy === key;
      return key === 'downloadPNG';
    }

    function runExport(key) {
      if (props.busy) return;
      var fn = props.onExport && props.onExport[key];
      if (typeof fn === 'function') fn(scaleArg());
    }

    function exportButton(key, label, icon) {
      var isBusy = actionBusy(key);
      return h(
        UI.Button,
        {
          key: key,
          icon: isBusy ? 'reset' : icon,
          fullWidth: true,
          disabled: !!props.busy,
          busy: isBusy,
          onClick: function () {
            runExport(key);
          },
        },
        isBusy ? t('export.busy') : label
      );
    }

    /* ------------------------------------------------------------ mesh tab */

    function renderMesh() {
      var nodeFields = h(
        'div',
        { className: 'mf-pnl-fields' },
        h(UI.ColorField, {
          label: t('mesh.color'),
          value: selected ? selected.color : '',
          onChange: function (hex) {
            patchPoint({ color: hex }, false);
          },
        }),
        h(UI.Slider, {
          label: t('mesh.size'),
          value: selected ? selected.size : 0,
          min: limitOf('pointSize', [0.02, 1.4])[0],
          max: limitOf('pointSize', [0.02, 1.4])[1],
          step: 0.01,
          format: fmtPct,
          onChange: function (value) {
            patchPoint({ size: value }, true);
          },
        }),
        h(UI.Slider, {
          label: t('mesh.opacity'),
          value: selected ? selected.opacity : 1,
          min: limitOf('pointOpacity', [0.05, 1])[0],
          max: limitOf('pointOpacity', [0.05, 1])[1],
          step: 0.01,
          format: fmtPct,
          onChange: function (value) {
            patchPoint({ opacity: value }, true);
          },
        }),
        h(UI.Slider, {
          label: t('mesh.x'),
          value: selected ? selected.x : 0.5,
          min: 0,
          max: 1,
          step: 0.005,
          format: fmtPct,
          onChange: function (value) {
            patchPoint({ x: value }, true);
          },
        }),
        h(UI.Slider, {
          label: t('mesh.y'),
          value: selected ? selected.y : 0.5,
          min: 0,
          max: 1,
          step: 0.005,
          format: fmtPct,
          onChange: function (value) {
            patchPoint({ y: value }, true);
          },
        })
      );

      return h(
        'div',
        { className: 'mf-pnl-tabpanel', role: 'tabpanel', 'aria-label': t('panels.tabMesh') },
        h(
          UI.Section,
          {
            title: t('panels.nodes'),
            right: h(UI.IconButton, {
              icon: 'dice',
              label: t('mesh.randomizeNodes'),
              title: t('mesh.randomizeNodes'),
              size: 24,
              onClick: props.onRandomizePoints,
            }),
          },
          h(LayerList, {
            t: t,
            state: state,
            selectedId: selected ? selected.id : null,
            onSelect: props.onSelectPoint,
            onRemove: removeNode,
            onAdd: addNode,
          })
        ),
        selected
          ? h(UI.Section, { title: t('mesh.node') + ' ' + (selectedIndex + 1) }, nodeFields)
          : h(
              UI.Section,
              { title: t('mesh.node') },
              h(
                'div',
                { className: 'mf-pnl-empty' },
                h(UI.Icon, { name: 'layers', size: 16 }),
                h('span', null, t('panels.noSelection'))
              )
            ),
        h(
          UI.Section,
          { title: t('panels.composition') },
          h(
            'div',
            { className: 'mf-pnl-fields' },
            h(UI.ColorField, {
              label: t('mesh.base'),
              value: state.base || '',
              onChange: function (hex) {
                emit({ ...state, base: hex }, false);
              },
            }),
            h(
              'div',
              { className: 'mf-pnl-field' },
              h('span', { className: 'mf-ctl-label' }, t('mesh.mix')),
              h(UI.Segmented, {
                value: state.mix,
                options: mixOptions(t),
                label: t('mesh.mix'),
                className: 'mf-ctl-seg--block',
                onChange: function (value) {
                  emit({ ...state, mix: value }, false);
                },
              })
            ),
            h(
              'div',
              { className: 'mf-pnl-field' },
              h('span', { className: 'mf-ctl-label' }, t('mesh.palette')),
              h(PaletteGrid, {
                t: t,
                value: state.palette,
                onPick: recolor,
                label: t('mesh.palette'),
              })
            )
          )
        )
      );
    }

    /* --------------------------------------------------------- effects tab */

    function renderEffects() {
      var grainOn = !!grain.enabled;
      var vignetteOn = !!vignette.enabled;

      return h(
        'div',
        { className: 'mf-pnl-tabpanel', role: 'tabpanel', 'aria-label': t('panels.tabEffects') },
        h(
          UI.Section,
          { title: t('effects.blur') },
          h(
            'div',
            { className: 'mf-pnl-fields' },
            h(UI.Slider, {
              label: t('effects.blurAmount'),
              value: state.blur || 0,
              min: limitOf('blur', [0, 100])[0],
              max: limitOf('blur', [0, 100])[1],
              format: fmtInt,
              onChange: function (value) {
                emit({ ...state, blur: value }, true);
              },
            })
          )
        ),
        h(
          UI.Section,
          { title: t('effects.grain') },
          h(
            'div',
            { className: 'mf-pnl-fields' },
            h(UI.Toggle, {
              label: t('effects.enabled'),
              checked: grainOn,
              hint: t('effects.grainHint'),
              onChange: function (value) {
                patchGrain({ enabled: value }, false);
              },
            }),
            h(UI.Slider, {
              label: t('effects.amount'),
              value: grain.amount == null ? 0 : grain.amount,
              min: limitOf('grainAmount', [0, 100])[0],
              max: limitOf('grainAmount', [0, 100])[1],
              format: fmtInt,
              disabled: !grainOn,
              onChange: function (value) {
                patchGrain({ amount: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('effects.scale'),
              value: grain.scale == null ? 34 : grain.scale,
              min: limitOf('grainScale', [1, 100])[0],
              max: limitOf('grainScale', [1, 100])[1],
              format: fmtInt,
              disabled: !grainOn,
              onChange: function (value) {
                patchGrain({ scale: value }, true);
              },
            }),
            h(
              'div',
              { className: 'mf-pnl-inline' },
              h(UI.Slider, {
                label: t('effects.seed'),
                value: grain.seed == null ? 1 : grain.seed,
                min: limitOf('grainSeed', [1, 9999])[0],
                max: limitOf('grainSeed', [1, 9999])[1],
                format: fmtInt,
                disabled: !grainOn,
                className: 'mf-pnl-slider--grow',
                onChange: function (value) {
                  patchGrain({ seed: value }, true);
                },
              }),
              h(UI.IconButton, {
                icon: 'dice',
                label: t('effects.newSeed'),
                title: t('effects.newSeed'),
                size: 26,
                disabled: !grainOn,
                onClick: function () {
                  patchGrain({ seed: 1 + Math.floor(Math.random() * 9999) }, false);
                },
              })
            ),
            h(
              'div',
              { className: 'mf-pnl-field' },
              h('span', { className: 'mf-ctl-label' }, t('effects.blend')),
              h(UI.Segmented, {
                value: grain.blend,
                options: blendOptions(t),
                label: t('effects.blend'),
                className: 'mf-ctl-seg--block',
                disabled: !grainOn,
                onChange: function (value) {
                  patchGrain({ blend: value }, false);
                },
              })
            )
          )
        ),
        h(
          UI.Section,
          { title: t('effects.vignette') },
          h(
            'div',
            { className: 'mf-pnl-fields' },
            h(UI.Toggle, {
              label: t('effects.enabled'),
              checked: vignetteOn,
              hint: t('effects.vignetteHint'),
              onChange: function (value) {
                patchVignette({ enabled: value }, false);
              },
            }),
            h(UI.Slider, {
              label: t('effects.vignetteAmount'),
              value: vignette.amount == null ? 0 : vignette.amount,
              min: limitOf('vignetteAmount', [0, 100])[0],
              max: limitOf('vignetteAmount', [0, 100])[1],
              format: fmtInt,
              disabled: !vignetteOn,
              onChange: function (value) {
                patchVignette({ amount: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('effects.vignetteSize'),
              value: vignette.size == null ? 60 : vignette.size,
              min: limitOf('vignetteSize', [0, 100])[0],
              max: limitOf('vignetteSize', [0, 100])[1],
              format: fmtInt,
              disabled: !vignetteOn,
              onChange: function (value) {
                patchVignette({ size: value }, true);
              },
            })
          )
        )
      );
    }

    /* ----------------------------------------------------------- glass tab */

    function renderGlass() {
      var glassOn = !!glass.enabled;

      return h(
        'div',
        { className: 'mf-pnl-tabpanel', role: 'tabpanel', 'aria-label': t('panels.tabGlass') },
        h(
          UI.Section,
          { title: t('glass.panel') },
          h(
            'div',
            { className: 'mf-pnl-fields' },
            h(UI.Toggle, {
              label: t('glass.enabled'),
              checked: glassOn,
              hint: t('glass.hint'),
              onChange: function (value) {
                patchGlass({ enabled: value }, false);
              },
            }),
            h(UI.Slider, {
              label: t('glass.x'),
              value: glass.x == null ? 0.5 : glass.x,
              min: 0,
              max: 1,
              step: 0.005,
              format: fmtPct,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ x: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.y'),
              value: glass.y == null ? 0.5 : glass.y,
              min: 0,
              max: 1,
              step: 0.005,
              format: fmtPct,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ y: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.width'),
              value: glass.w == null ? 0.52 : glass.w,
              min: limitOf('glassSize', [0.05, 1])[0],
              max: limitOf('glassSize', [0.05, 1])[1],
              step: 0.005,
              format: fmtPct,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ w: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.height'),
              value: glass.h == null ? 0.42 : glass.h,
              min: limitOf('glassSize', [0.05, 1])[0],
              max: limitOf('glassSize', [0.05, 1])[1],
              step: 0.005,
              format: fmtPct,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ h: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.opacity'),
              value: glass.opacity == null ? 14 : glass.opacity,
              min: limitOf('glassOpacity', [0, 100])[0],
              max: limitOf('glassOpacity', [0, 100])[1],
              format: fmtInt,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ opacity: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.blur'),
              value: glass.blur == null ? 18 : glass.blur,
              min: limitOf('glassBlur', [0, 60])[0],
              max: limitOf('glassBlur', [0, 60])[1],
              format: fmtInt,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ blur: value }, true);
              },
            }),
            h(UI.ColorField, {
              label: t('glass.tint'),
              value: glass.tint || '',
              disabled: !glassOn,
              onChange: function (hex) {
                patchGlass({ tint: hex }, false);
              },
            }),
            h(UI.Slider, {
              label: t('glass.radius'),
              value: glass.radius == null ? 28 : glass.radius,
              min: limitOf('glassRadius', [0, 80])[0],
              max: limitOf('glassRadius', [0, 80])[1],
              format: fmtInt,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ radius: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.border'),
              value: glass.border == null ? 40 : glass.border,
              min: limitOf('glassBorder', [0, 100])[0],
              max: limitOf('glassBorder', [0, 100])[1],
              format: fmtInt,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ border: value }, true);
              },
            }),
            h(UI.Slider, {
              label: t('glass.sheen'),
              value: glass.sheen == null ? 30 : glass.sheen,
              min: limitOf('glassSheen', [0, 100])[0],
              max: limitOf('glassSheen', [0, 100])[1],
              format: fmtInt,
              disabled: !glassOn,
              onChange: function (value) {
                patchGlass({ sheen: value }, true);
              },
            })
          )
        )
      );
    }

    /* ---------------------------------------------------------- export tab */

    function renderExport() {
      var primaryBusy = actionBusy('downloadPNG');
      return h(
        'div',
        { className: 'mf-pnl-tabpanel', role: 'tabpanel', 'aria-label': t('panels.tabExport') },
        h(
          UI.Section,
          { title: t('export.output') },
          h(
            'div',
            { className: 'mf-pnl-fields' },
            h(
              'div',
              { className: 'mf-pnl-field' },
              h('span', { className: 'mf-ctl-label' }, t('export.scale')),
              h(UI.Segmented, {
                value: scale,
                label: t('export.scale'),
                className: 'mf-ctl-seg--block',
                options: [
                  { value: 1, label: t('export.x1') },
                  { value: 2, label: t('export.x2') },
                  { value: 4, label: t('export.x4') },
                ],
                onChange: function (value) {
                  if (typeof props.onExportScale === 'function') props.onExportScale(Number(value));
                },
              })
            ),
            h(
              'div',
              { className: 'mf-pnl-export__dims' },
              h('span', { className: 'mf-pnl-export__dims-label' }, t('export.size')),
              h(UI.Badge, { tone: 'brand' }, dimensionText(state, scale))
            ),
            h(
              UI.Button,
              {
                variant: 'primary',
                icon: 'download',
                fullWidth: true,
                busy: primaryBusy,
                disabled: !!props.busy,
                onClick: function () {
                  runExport('downloadPNG');
                },
              },
              primaryBusy ? t('export.busy') : t('export.downloadPng')
            ),
            h(
              'div',
              { className: 'mf-pnl-export__actions' },
              exportButton('copyPNG', t('export.copyPng'), 'image'),
              exportButton('copyCSS', t('export.copyCss'), 'copy'),
              exportButton('copyJSON', t('export.copyJson'), 'code'),
              exportButton('downloadCSS', t('export.cssFile'), 'download'),
              exportButton('downloadJSON', t('export.jsonFile'), 'download')
            ),
            h('p', { className: 'mf-pnl-export__hint' }, t('export.hint'))
          )
        )
      );
    }

    /* -------------------------------------------------------------- layout */

    var tabs = [
      { id: 'mesh', label: t('panels.tabMesh'), icon: 'layers', panelId: 'mf-pnl-panel-mesh' },
      { id: 'effects', label: t('panels.tabEffects'), icon: 'sparkle', panelId: 'mf-pnl-panel-effects' },
      { id: 'glass', label: t('panels.tabGlass'), icon: 'grid', panelId: 'mf-pnl-panel-glass' },
      { id: 'export', label: t('panels.tabExport'), icon: 'download', panelId: 'mf-pnl-panel-export' },
    ];

    var body;
    if (tab === 'effects') body = renderEffects();
    else if (tab === 'glass') body = renderGlass();
    else if (tab === 'export') body = renderExport();
    else body = renderMesh();

    return h(
      'div',
      { className: 'mf-pnl-inspector' },
      h(UI.Tabs, {
        tabs: tabs,
        value: tab,
        label: t('panels.inspector'),
        onChange: function (id) {
          setTab(id);
        },
      }),
      h(
        'div',
        { className: 'mf-pnl-inspector__body' },
        h(
          'div',
          {
            key: tab,
            id: 'mf-pnl-panel-' + tab,
            className: 'mf-pnl-tabpanelwrapper',
          },
          body
        )
      )
    );
  }

  /* ------------------------------------------------------------------- sheet */

  var CSS = `
/* MeshFlow Studio - studio side panels. Chrome colours: --dsw-alias-* tokens only. */

.mf-pnl-thumb {
  display: block;
  flex: none;
  box-sizing: border-box;
  width: var(--mf-pnl-thumb-width, 112px);
  max-width: 100%;
  overflow: hidden;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
}

.mf-pnl-thumb__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.mf-pnl-muted {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.85;
}

.mf-pnl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 8px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 9px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
}

/* ------------------------------------------------------------- preset rail */

.mf-pnl-presets {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}

.mf-pnl-presets__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
  padding: 10px 12px 8px;
}

.mf-pnl-presets__title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-primary);
}

.mf-pnl-presets__search {
  position: relative;
  display: block;
  flex: none;
  min-width: 0;
  padding: 0 12px 8px;
}

.mf-pnl-search__icon {
  position: absolute;
  top: 0;
  left: 21px;
  display: flex;
  align-items: center;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  pointer-events: none;
}

.mf-pnl-search__input {
  padding-left: 28px;
}

.mf-pnl-presets__actions {
  flex: none;
  padding: 0 12px 10px;
}

.mf-pnl-presets__palettes {
  flex: none;
  padding: 0 12px 12px;
}

.mf-pnl-presets__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 12px 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
}

.mf-pnl-presets__body::-webkit-scrollbar {
  width: 8px;
}

.mf-pnl-presets__body::-webkit-scrollbar-track {
  background: transparent;
}

.mf-pnl-presets__body::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
  background-color: var(--dsw-alias-border-l2);
}

.mf-pnl-presets__body::-webkit-scrollbar-thumb:hover {
  background-color: var(--dsw-alias-label-secondary);
}

.mf-pnl-presets__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}

/* -------------------------------------------------------------- palettes */

.mf-pnl-palettes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}

.mf-pnl-palette {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s ease, color 0.14s ease, background-color 0.14s ease;
}

.mf-pnl-palette:hover {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.mf-pnl-palette.is-active {
  border-color: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-label-primary);
}

.mf-pnl-palette:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.mf-pnl-palette__dots {
  display: flex;
  flex: none;
  gap: 2px;
}

.mf-pnl-palette__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mf-pnl-dot, transparent);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
}

.mf-pnl-palette__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@supports (background: color-mix(in srgb, currentColor 8%, transparent)) {
  .mf-pnl-palette:hover {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1));
  }
  .mf-pnl-layer:hover {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-base));
  }
}

/* ---------------------------------------------------------- preset cards */

.mf-pnl-preset {
  display: flex;
  flex-direction: column;
  gap: 5px;
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 5px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s ease, background-color 0.14s ease;
}

.mf-pnl-preset .mf-pnl-thumb {
  width: 100%;
}

.mf-pnl-preset:hover {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}

.mf-pnl-preset.is-selected {
  box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-primary);
}

.mf-pnl-preset:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.mf-pnl-preset__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 0 2px 1px;
}

.mf-pnl-preset__name {
  overflow: hidden;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.mf-pnl-preset__tag {
  overflow: hidden;
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

@supports (background: color-mix(in srgb, currentColor 8%, transparent)) {
  .mf-pnl-preset:hover {
    background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1));
  }
}

/* ------------------------------------------------------- saved presets */

.mf-pnl-userpreset {
  position: relative;
  min-width: 0;
}

.mf-pnl-userpreset__del {
  position: absolute;
  top: 3px;
  right: 3px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  opacity: 0;
}

.mf-pnl-userpreset:hover .mf-pnl-userpreset__del,
.mf-pnl-userpreset__del:focus-visible {
  opacity: 1;
}

.mf-pnl-userpreset__del:hover:not(:disabled) {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

.mf-pnl-save {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mf-pnl-save__input {
  flex: 1 1 auto;
  min-width: 0;
}

/* --------------------------------------------------------------- layers */

.mf-pnl-layers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mf-pnl-layers__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mf-pnl-layer {
  display: flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  min-width: 0;
  padding: 1px;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: background-color 0.14s ease, border-color 0.14s ease;
}

.mf-pnl-layer:hover {
  background: var(--dsw-alias-bg-layer-2);
}

.mf-pnl-layer.is-selected {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-label-primary);
}

.mf-pnl-layer__main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  padding: 5px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mf-pnl-layer__main:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}

.mf-pnl-layer__dot {
  flex: none;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--mf-pnl-dot, transparent);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}

.mf-pnl-layer__name {
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mf-pnl-layer__coords {
  flex: none;
  margin-left: auto;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  color: var(--dsw-alias-label-secondary);
}

/* ------------------------------------------------------------ inspector */

.mf-pnl-inspector {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}

.mf-pnl-inspector__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 12px 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
}

.mf-pnl-inspector__body::-webkit-scrollbar {
  width: 8px;
}

.mf-pnl-inspector__body::-webkit-scrollbar-track {
  background: transparent;
}

.mf-pnl-inspector__body::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
  background-color: var(--dsw-alias-border-l2);
}

.mf-pnl-tabpanelwrapper {
  display: block;
  min-width: 0;
}

.mf-pnl-tabpanel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.mf-pnl-fields {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.mf-pnl-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.mf-pnl-inline {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-width: 0;
}

.mf-pnl-slider--grow {
  flex: 1 1 auto;
  min-width: 0;
}

/* --------------------------------------------------------------- export */

.mf-pnl-export__dims {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
}

.mf-pnl-export__dims-label {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--dsw-alias-label-secondary);
}

.mf-pnl-export__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}

.mf-pnl-export__actions > :last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.mf-pnl-export__hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}

@media (hover: none) {
  .mf-pnl-userpreset__del {
    opacity: 1;
  }
}

/* ------------------------------------------------------- reduced motion */

@media (prefers-reduced-motion: reduce) {
  .mf-pnl-palette,
  .mf-pnl-preset,
  .mf-pnl-layer {
    transition: none !important;
  }
}
`;

  return {
    PresetThumb: PresetThumb,
    PresetRail: PresetRail,
    LayerList: LayerList,
    Inspector: Inspector,
    css: CSS,
  };
})();

MF.strings = MF.strings || {};
MF.strings.panels = {
  en: {
    'panels.presets': 'Presets',
    'panels.templates': 'Templates',
    'panels.palettes': 'Palettes',
    'panels.myPresets': 'My presets',
    'panels.searchPh': 'Search presets',
    'panels.surprise': 'Surprise me',
    'panels.save': 'Save',
    'panels.saveName': 'Preset name',
    'panels.empty': 'No presets found',
    'panels.noUserPresets': 'Save the current look to reuse it later.',
    'panels.inspector': 'Inspector',
    'panels.nodes': 'Nodes',
    'panels.composition': 'Composition',
    'panels.noSelection': 'Select a node to edit it.',
    'panels.tabMesh': 'Mesh',
    'panels.tabEffects': 'Effects',
    'panels.tabGlass': 'Glass',
    'panels.tabExport': 'Export',
    'panels.mix.normal': 'Normal',
    'panels.mix.screen': 'Screen',
    'panels.mix.overlay': 'Overlay',
    'panels.mix.soft-light': 'Soft',
    'panels.mix.lighter': 'Lighter',
    'panels.blend.overlay': 'Overlay',
    'panels.blend.soft-light': 'Soft',
    'panels.blend.normal': 'Normal',
    'mesh.node': 'Node',
    'mesh.addNode': 'Add node',
    'mesh.color': 'Color',
    'mesh.size': 'Size',
    'mesh.opacity': 'Opacity',
    'mesh.x': 'X position',
    'mesh.y': 'Y position',
    'mesh.base': 'Base color',
    'mesh.mix': 'Blend mode',
    'mesh.palette': 'Palette',
    'mesh.randomizeNodes': 'Shuffle nodes',
    'effects.blur': 'Blur',
    'effects.blurAmount': 'Strength',
    'effects.grain': 'Film grain',
    'effects.enabled': 'Enabled',
    'effects.amount': 'Amount',
    'effects.scale': 'Scale',
    'effects.seed': 'Seed',
    'effects.newSeed': 'New seed',
    'effects.blend': 'Blend',
    'effects.grainHint': 'Fine monochrome noise over the mesh.',
    'effects.vignette': 'Vignette',
    'effects.vignetteAmount': 'Strength',
    'effects.vignetteSize': 'Size',
    'effects.vignetteHint': 'Darkens the edges of the frame.',
    'glass.panel': 'Glass panel',
    'glass.enabled': 'Enabled',
    'glass.x': 'Position X',
    'glass.y': 'Position Y',
    'glass.width': 'Width',
    'glass.height': 'Height',
    'glass.opacity': 'Opacity',
    'glass.blur': 'Backdrop blur',
    'glass.tint': 'Tint',
    'glass.radius': 'Corner radius',
    'glass.border': 'Border',
    'glass.sheen': 'Sheen',
    'glass.hint': 'A frosted card floating over the mesh.',
    'export.output': 'Output',
    'export.scale': 'Scale',
    'export.size': 'Output size',
    'export.x1': '1×',
    'export.x2': '2×',
    'export.x4': '4×',
    'export.downloadPng': 'Download PNG',
    'export.copyPng': 'Copy PNG',
    'export.copyCss': 'Copy CSS',
    'export.copyJson': 'Copy JSON',
    'export.cssFile': 'Download CSS',
    'export.jsonFile': 'Download JSON',
    'export.hint': 'PNG renders at the selected scale; CSS and JSON stay resolution free.',
    'export.busy': 'Working…',
    'export.png': 'Export PNG',
  },
  zh: {
    'panels.presets': '预设',
    'panels.templates': '模板',
    'panels.palettes': '配色',
    'panels.myPresets': '我的预设',
    'panels.searchPh': '搜索预设',
    'panels.surprise': '给我惊喜',
    'panels.save': '保存',
    'panels.saveName': '预设名称',
    'panels.empty': '未找到预设',
    'panels.noUserPresets': '保存当前效果，方便以后复用。',
    'panels.inspector': '属性',
    'panels.nodes': '节点',
    'panels.composition': '整体',
    'panels.noSelection': '选择一个节点进行编辑。',
    'panels.tabMesh': '网格',
    'panels.tabEffects': '效果',
    'panels.tabGlass': '玻璃',
    'panels.tabExport': '导出',
    'panels.mix.normal': '正常',
    'panels.mix.screen': '滤色',
    'panels.mix.overlay': '叠加',
    'panels.mix.soft-light': '柔光',
    'panels.mix.lighter': '变亮',
    'panels.blend.overlay': '叠加',
    'panels.blend.soft-light': '柔光',
    'panels.blend.normal': '正常',
    'mesh.node': '节点',
    'mesh.addNode': '添加节点',
    'mesh.color': '颜色',
    'mesh.size': '大小',
    'mesh.opacity': '不透明度',
    'mesh.x': '水平位置',
    'mesh.y': '垂直位置',
    'mesh.base': '底色',
    'mesh.mix': '混合模式',
    'mesh.palette': '配色',
    'mesh.randomizeNodes': '打乱节点',
    'effects.blur': '模糊',
    'effects.blurAmount': '强度',
    'effects.grain': '胶片颗粒',
    'effects.enabled': '启用',
    'effects.amount': '强度',
    'effects.scale': '缩放',
    'effects.seed': '随机种子',
    'effects.newSeed': '新种子',
    'effects.blend': '混合',
    'effects.grainHint': '在画面上叠加细腻的单色噪点。',
    'effects.vignette': '暗角',
    'effects.vignetteAmount': '强度',
    'effects.vignetteSize': '范围',
    'effects.vignetteHint': '压暗画面边缘。',
    'glass.panel': '玻璃面板',
    'glass.enabled': '启用',
    'glass.x': '水平位置',
    'glass.y': '垂直位置',
    'glass.width': '宽度',
    'glass.height': '高度',
    'glass.opacity': '不透明度',
    'glass.blur': '背景模糊',
    'glass.tint': '着色',
    'glass.radius': '圆角',
    'glass.border': '边框',
    'glass.sheen': '光泽',
    'glass.hint': '在画面上悬浮一层磨砂玻璃。',
    'export.output': '输出',
    'export.scale': '倍数',
    'export.size': '输出尺寸',
    'export.x1': '1×',
    'export.x2': '2×',
    'export.x4': '4×',
    'export.downloadPng': '下载 PNG',
    'export.copyPng': '复制 PNG',
    'export.copyCss': '复制 CSS',
    'export.copyJson': '复制 JSON',
    'export.cssFile': '下载 CSS',
    'export.jsonFile': '下载 JSON',
    'export.hint': 'PNG 按所选倍数渲染；CSS 与 JSON 不依赖分辨率。',
    'export.busy': '处理中…',
    'export.png': '导出 PNG',
  },
};
