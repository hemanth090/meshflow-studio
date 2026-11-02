/**
 * Bundle integration test (no browser).
 *
 * Loads the generated `client.js` inside a Node VM, materialises the lazy factory with a
 * minimal React stub, and drives the Client plugin's `apply()` against fake `locale`, `slots`
 * and `layout` services. This proves the bundle parses, every module fragment attaches to the
 * shared `MF` namespace, the dictionary merge is complete, and the three slot contributions
 * are declared - before anything is installed into the profile.
 *
 *   node --test test/integration.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function makeReact() {
  function createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() };
  }
  return {
    createElement,
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useReducer: (reducer, initial) => [initial, () => {}],
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    memo: (component) => component,
  };
}

function loadBundle() {
  let factory = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(definition) {
          factory = definition.factory;
        },
      },
    },
    console: { log() {}, error() {}, warn() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    devicePixelRatio: 1,
    localStorage: {
      store: new Map(),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      setItem(key, value) {
        this.store.set(key, String(value));
      },
      removeItem(key) {
        this.store.delete(key);
      },
    },
    navigator: { clipboard: undefined },
    document: undefined,
    URL: undefined,
    Blob: undefined,
    ClipboardItem: undefined,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox, { filename: 'client.js' });
  assert.equal(typeof factory, 'function', 'bundle registers a lazy factory');

  const React = makeReact();
  const requireStub = (id) => {
    if (id === 'react') return React;
    throw new Error('bundle must not require anything except react: ' + id);
  };
  return factory(requireStub);
}

function createFakeServices() {
  const dictionaries = Object.create(null);
  const registrations = [];
  const selectedPanels = [];
  let currentLocale = 'en';

  const locale = {
    register(namespace, language, dict) {
      if (!dictionaries[namespace]) dictionaries[namespace] = Object.create(null);
      if (dictionaries[namespace][language]) {
        throw new Error('duplicate dictionary ' + namespace + '/' + language);
      }
      dictionaries[namespace][language] = dict;
      return () => {
        delete dictionaries[namespace][language];
      };
    },
    bind(namespace) {
      return (key) => {
        const tables = dictionaries[namespace];
        if (!tables) return key;
        const table = tables[currentLocale] || tables.en;
        if (!table) return key;
        return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
      };
    },
    getSnapshot() {
      return { id: currentLocale, revision: 0 };
    },
    subscribe() {
      return () => {};
    },
    setLocale(next) {
      currentLocale = next;
    },
    addLanguage() {
      return () => {};
    },
  };

  const slots = {
    inject(key, callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  };

  const layout = {
    selectPanel(panelId) {
      selectedPanels.push(panelId);
    },
  };

  const ctx = {
    locale,
    slots,
    get(name) {
      return name === 'layout' ? layout : undefined;
    },
    effect(callback) {
      const dispose = callback();
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
  };

  return { ctx, locale, slots, registrations, selectedPanels, dictionaries };
}

test('bundle loads and exposes the Client plugin shape', () => {
  const plugin = loadBundle();
  assert.equal(typeof plugin, 'object');
  assert.ok(Array.isArray(plugin.inject), 'plugin declares inject');
  assert.ok(plugin.inject.includes('slots'));
  assert.ok(plugin.inject.includes('locale'));
  assert.equal(typeof plugin.apply, 'function');
});

test('registers locale dictionaries covering en and zh', () => {
  const services = createFakeServices();
  const plugin = loadBundle();
  plugin.apply(services.ctx);

  const tables = services.dictionaries['meshflow-studio'];
  assert.ok(tables, 'locale namespace registered');
  const enKeys = Object.keys(tables.en || {});
  const zhKeys = Object.keys(tables.zh || {});
  assert.ok(enKeys.length > 80, 'expected a full English dictionary, got ' + enKeys.length);
  assert.equal(zhKeys.length, enKeys.length, 'zh dictionary must mirror every en key');
  const untranslated = enKeys.filter((key) => !tables.zh[key]);
  assert.deepEqual(untranslated, [], 'every zh key has a value');
  const badValues = enKeys.filter(
    (key) => typeof tables.en[key] !== 'string' || !tables.en[key].trim()
  );
  assert.deepEqual(badValues, [], 'every English value is a non-empty string');
});

test('registers sidebar icon, main panel and composer launcher', () => {
  const services = createFakeServices();
  const plugin = loadBundle();
  plugin.apply(services.ctx);

  const panelIcon = services.registrations.find(
    (entry) => entry.options.name === 'sidebar.panellist'
  );
  assert.ok(panelIcon, 'sidebar.panellist registered');
  assert.equal(panelIcon.options.id, 'meshflow-studio');
  assert.equal(typeof panelIcon.component, 'function');
  const label = panelIcon.options.label();
  assert.equal(typeof label, 'string');
  assert.ok(label.length > 0 && label !== 'panel.title', 'panel label is localized');

  const mainPanel = services.registrations.find((entry) => entry.options.name === 'main');
  assert.ok(mainPanel, 'main keyed panel registered');
  assert.equal(mainPanel.options.key, 'meshflow-studio');
  assert.equal(typeof mainPanel.component, 'function');

  const launcher = services.registrations.find(
    (entry) => entry.options.name === 'conversation.input.left'
  );
  assert.ok(launcher, 'composer launcher registered');
  assert.equal(typeof launcher.component, 'function');
});

test('sidebar icon renders without throwing', () => {
  const services = createFakeServices();
  const plugin = loadBundle();
  plugin.apply(services.ctx);
  const panelIcon = services.registrations.find(
    (entry) => entry.options.name === 'sidebar.panellist'
  );
  const tree = panelIcon.component({ size: 24, active: true });
  assert.equal(tree.type, 'svg');
  assert.ok(tree.children.length >= 2, 'icon has visible artwork');
});

test('launcher calls layout.selectPanel with the panel id', () => {
  const services = createFakeServices();
  const plugin = loadBundle();
  plugin.apply(services.ctx);
  const launcher = services.registrations.find(
    (entry) => entry.options.name === 'conversation.input.left'
  );
  // Render the component with a stubbed React hook environment already provided by makeReact.
  const tree = launcher.component({});
  assert.equal(tree.type, 'button');
  tree.props.onClick();
  assert.deepEqual(services.selectedPanels, ['meshflow-studio']);
});

test('apply is idempotent-safe when locale dictionary already exists', () => {
  const services = createFakeServices();
  const plugin = loadBundle();
  services.locale.register('meshflow-studio', 'en', { 'launcher.label': 'MeshFlow' });
  assert.doesNotThrow(() => plugin.apply(services.ctx));
  assert.ok(services.registrations.length >= 3, 'registration continues after duplicate locale');
});
