/**
 * MeshFlow Studio - unit tests for `src/25-exporter.js` (MF.exporter).
 *
 *   node --test test/exporter.test.mjs
 *
 * The fragment is plain script (no ESM), so it is loaded inside a `node:vm` context together
 * with the real prelude. `MF.model` / `MF.engine` are stubbed after load (the exporter only
 * looks them up at call time), which also lets the tests count delegation with spies.
 *
 * The suite covers:
 *   - the public surface (all eight functions);
 *   - `filename` delegation to `MF.model.filename` (plus its safe fallback);
 *   - loading the fragment is side-effect free and touches no browser API;
 *   - every copy/download helper degrades to false/null without DOM/clipboard/Blob/URL;
 *   - the happy paths (clipboard, temporary anchor, Blob + object URL, ClipboardItem PNG);
 *   - cleanup: no anchor/textarea is left in the DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const preludeSource = readFileSync(new URL('../src/00-prelude.js', import.meta.url), 'utf8');
const exporterSource = readFileSync(new URL('../src/25-exporter.js', import.meta.url), 'utf8');

const EXPORTED_FUNCTIONS = [
  'filename',
  'downloadPNG',
  'copyText',
  'copyCSS',
  'copyJSON',
  'copyPNG',
  'downloadCSS',
  'downloadJSON',
];

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

/** Runs prelude + exporter in one fresh VM context, as build.mjs concatenates them. */
function createHarness(env = {}, options = {}) {
  const sandbox = Object.assign({ __mf: undefined }, env);
  vm.createContext(sandbox);
  vm.runInContext(
    [preludeSource, exporterSource, 'globalThis.__mf = MF;'].join('\n'),
    sandbox,
    { filename: 'meshflow-studio.fragment.js' }
  );

  const mf = sandbox.__mf;
  assert.ok(mf, 'prelude created MF');

  const calls = {
    filename: 0,
    dimensionsOf: 0,
    toCSS: 0,
    toJSON: 0,
    toDataURL: 0,
    exportCanvas: 0,
    toBlob: 0,
    writeText: 0,
    write: 0,
    execCommand: 0,
    createObjectURL: 0,
    revokeObjectURL: 0,
    click: 0,
    appended: 0,
    removed: 0,
  };
  const sink = { writtenTexts: [], writtenItems: [], lastBlob: null, toBlobType: null };

  if (options.stubs !== false) {
    mf.model = {
      filename(state, scale) {
        calls.filename += 1;
        const label = (state && state.name ? String(state.name) : 'state')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        return 'meshflow-stub-' + (label || 'state') + '-' + scale + '.png';
      },
      dimensionsOf() {
        calls.dimensionsOf += 1;
        return { width: 1600, height: 900 };
      },
      toCSS() {
        calls.toCSS += 1;
        return '/* meshflow-studio */\n.mf-art { background: #0a0a12; }';
      },
      toJSON() {
        calls.toJSON += 1;
        return '{\n  "format": "meshflow-studio",\n  "version": 1\n}';
      },
    };
    mf.engine = {
      toDataURL() {
        calls.toDataURL += 1;
        return 'data:image/png;base64,MESHFORWSTUB';
      },
      exportCanvas() {
        calls.exportCanvas += 1;
        return {
          toBlob(callback, type) {
            calls.toBlob += 1;
            sink.toBlobType = type;
            callback({ mock: 'png-blob', type });
          },
        };
      },
    };
  }

  return { mf, calls, sandbox, sink };
}

/** Minimal fake document: tracks created/appended/removed nodes and dispatched clicks. */
function makeFakeDocument() {
  const log = { created: [], appended: [], removed: [], clicked: [], exec: [] };
  const body = {
    children: [],
    appendChild(node) {
      this.children.push(node);
      node.parentNode = this;
      log.appended.push(node);
      return node;
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
      node.parentNode = null;
      log.removed.push(node);
      return node;
    },
  };
  const documentStub = {
    body,
    documentElement: body,
    createElement(tag) {
      const element = {
        tagName: String(tag).toLowerCase(),
        style: {},
        attributes: {},
        parentNode: null,
        clicked: false,
        href: '',
        download: '',
        rel: '',
        value: '',
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        click() {
          this.clicked = true;
          log.clicked.push(this);
        },
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {
          if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
            this.parentNode.removeChild(this);
          }
        },
      };
      log.created.push(element);
      return element;
    },
    execCommand(command) {
      log.exec.push(command);
      return command === 'copy';
    },
  };
  return { documentStub, body, log };
}

function makeFakeURL() {
  const state = { created: [], revoked: [] };
  const api = {
    createObjectURL(blob) {
      state.created.push(blob);
      return 'blob:meshflow/' + state.created.length;
    },
    revokeObjectURL(url) {
      state.revoked.push(url);
    },
  };
  return { api, state };
}

function FakeBlob(parts, options) {
  this.parts = parts;
  this.type = (options && options.type) || '';
  this.size = parts.reduce((total, part) => total + String(part).length, 0);
}

function FakeClipboardItem(data) {
  this.data = data;
  this.types = Object.keys(data);
}

function makeNavigator(options = {}) {
  const state = { writtenTexts: [], writtenItems: [] };
  const navigatorStub = {
    clipboard: {
      async writeText(text) {
        if (options.rejectWriteText) throw new Error('clipboard denied');
        state.writtenTexts.push(text);
      },
      async write(items) {
        if (options.rejectWrite) throw new Error('clipboard write denied');
        state.writtenItems.push(items);
      },
    },
  };
  return { navigatorStub, state };
}

function makeDOMEnv(options = {}) {
  const dom = makeFakeDocument();
  const blobState = { blobs: [] };
  function RecordingBlob(parts, blobOptions) {
    FakeBlob.call(this, parts, blobOptions);
    blobState.blobs.push(this);
  }
  RecordingBlob.prototype = Object.create(FakeBlob.prototype);
  const url = makeFakeURL();
  const env = {
    document: dom.documentStub,
    Blob: RecordingBlob,
    URL: url.api,
  };
  if (options.navigator) env.navigator = options.navigator;
  if (options.ClipboardItem) env.ClipboardItem = options.ClipboardItem;
  return { env, dom, url, blobState };
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

test('fragment attaches MF.exporter with exactly the contract functions', () => {
  const { mf } = createHarness();
  assert.ok(mf.exporter, 'MF.exporter exists');
  assert.equal(typeof mf.exporter, 'object');
  for (const name of EXPORTED_FUNCTIONS) {
    assert.equal(typeof mf.exporter[name], 'function', 'MF.exporter.' + name + ' is a function');
  }
});

test('filename(state, scale) delegates to MF.model.filename', () => {
  const { mf, calls } = createHarness();
  const state = { name: 'Aurora Veil' };
  const name = mf.exporter.filename(state, 2);
  assert.equal(calls.filename, 1, 'MF.model.filename was called once');
  assert.equal(name, 'meshflow-stub-aurora-veil-2.png');
  assert.equal(typeof name, 'string');
});

test('filename falls back to a dimension-based name when MF.model.filename is unavailable', () => {
  const { mf, calls } = createHarness();
  delete mf.model.filename;
  const name = mf.exporter.filename({}, 2);
  assert.equal(name, 'meshflow-3200x1800.png');
  assert.equal(calls.dimensionsOf, 1);
  // Never throws, even with no model at all.
  delete mf.model;
  assert.doesNotThrow(() => mf.exporter.filename({}, 1));
  assert.match(mf.exporter.filename({}, 1), /^meshflow-\d+x\d+\.png$/);
});

/* ------------------------------------------------------------------ *
 * Load-time hygiene
 * ------------------------------------------------------------------ */

test('loading the fragment has no side effects and touches no browser API', () => {
  const reads = {
    document: 0,
    navigator: 0,
    window: 0,
    URL: 0,
    Blob: 0,
    ClipboardItem: 0,
  };
  const sandbox = { __mf: undefined };
  for (const name of Object.keys(reads)) {
    let value;
    Object.defineProperty(sandbox, name, {
      configurable: true,
      enumerable: true,
      get() {
        reads[name] += 1;
        return value;
      },
      set(next) {
        value = next;
      },
    });
  }
  const before = Object.getOwnPropertyNames(sandbox).sort();
  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(
      [preludeSource, exporterSource, 'globalThis.__mf = MF;'].join('\n'),
      sandbox,
      { filename: 'meshflow-studio.fragment.js' }
    );
  }, 'fragment loads without a DOM');
  const touched = Object.keys(reads).filter((name) => reads[name] > 0);
  assert.deepEqual(touched, [], 'no browser global is read at module-evaluation time');
  assert.deepEqual(
    Object.getOwnPropertyNames(sandbox).sort(),
    before,
    'loading leaks no globals'
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(sandbox, 'MF'),
    false,
    'MF stays inside the factory scope (module lexical binding)'
  );

  // The only MF member the fragment adds is `exporter`.
  const bare = { __mf: undefined };
  vm.createContext(bare);
  vm.runInContext([preludeSource, 'globalThis.__mf = MF;'].join('\n'), bare, {
    filename: '00-prelude.js',
  });
  const preludeKeys = Object.keys(bare.__mf).sort();
  const loadedKeys = Object.keys(sandbox.__mf).sort();
  assert.deepEqual(
    loadedKeys,
    preludeKeys.concat('exporter').sort(),
    'exporter is the only member added'
  );
  for (const name of EXPORTED_FUNCTIONS) {
    assert.equal(typeof sandbox.__mf.exporter[name], 'function');
  }
});

/* ------------------------------------------------------------------ *
 * Graceful degradation - no DOM, no clipboard, no Blob/URL
 * ------------------------------------------------------------------ */

test('all copy/download helpers resolve false/null (never throw) without DOM APIs', async () => {
  const env = {
    document: undefined,
    navigator: undefined,
    URL: undefined,
    Blob: undefined,
    ClipboardItem: undefined,
  };
  const { mf, calls } = createHarness(env);
  const state = { name: 'No DOM' };

  assert.equal(await mf.exporter.copyText('hello'), false);
  assert.equal(await mf.exporter.copyCSS(state), false);
  assert.equal(await mf.exporter.copyJSON(state), false);
  assert.equal(await mf.exporter.copyPNG(state, 2), false);
  assert.equal(await mf.exporter.downloadPNG(state, 2), null);
  assert.equal(await mf.exporter.downloadCSS(state), false);
  assert.equal(await mf.exporter.downloadJSON(state), false);

  // The serializers were consulted by both the copy and the download helpers.
  assert.equal(calls.toCSS, 2);
  assert.equal(calls.toJSON, 2);
  // PNG export used the engine data URL but had nowhere to click.
  assert.equal(calls.toDataURL, 1);
  assert.equal(calls.createObjectURL, 0, 'no object URL without the URL API');
});

test('copyText never throws even for hostile inputs', async () => {
  const { mf } = createHarness({ document: undefined, navigator: undefined });
  assert.equal(await mf.exporter.copyText(null), false);
  assert.equal(await mf.exporter.copyText(undefined), false);
  assert.equal(await mf.exporter.copyText({ toString() { throw new Error('boom'); } }), false);
});

/* ------------------------------------------------------------------ *
 * copyText / copyCSS / copyJSON
 * ------------------------------------------------------------------ */

test('copyText uses navigator.clipboard.writeText when available', async () => {
  const { navigatorStub, state } = makeNavigator();
  const { mf } = createHarness({ navigator: navigatorStub });
  assert.equal(await mf.exporter.copyText('gelato'), true);
  assert.deepEqual(state.writtenTexts, ['gelato']);
});

test('copyText falls back to a hidden textarea + execCommand and cleans it up', async () => {
  const dom = makeFakeDocument();
  const { navigatorStub } = makeNavigator({ rejectWriteText: true });
  const { mf } = createHarness({ document: dom.documentStub, navigator: navigatorStub });

  assert.equal(await mf.exporter.copyText('legacy path'), true);
  assert.deepEqual(dom.log.exec, ['copy'], 'execCommand("copy") was attempted once');
  assert.equal(dom.body.children.length, 0, 'textarea was removed from the DOM');
  const textarea = dom.log.created.find((element) => element.tagName === 'textarea');
  assert.ok(textarea, 'a textarea was created');
  assert.equal(textarea.value, 'legacy path');
  assert.equal(textarea.parentNode, null);
  assert.ok(dom.log.removed.includes(textarea), 'textarea removal was tracked');
});

test('copyText with clipboard rejection and no document resolves false', async () => {
  const { navigatorStub } = makeNavigator({ rejectWriteText: true });
  const { mf } = createHarness({ document: undefined, navigator: navigatorStub });
  assert.equal(await mf.exporter.copyText('nowhere'), false);
});

test('copyCSS / copyJSON delegate to MF.model.toCSS / toJSON and copy the text', async () => {
  const { navigatorStub, state } = makeNavigator();
  const { mf, calls } = createHarness({ navigator: navigatorStub });
  const composition = { name: 'CSS test' };

  assert.equal(await mf.exporter.copyCSS(composition), true);
  assert.equal(await mf.exporter.copyJSON(composition), true);
  assert.equal(calls.toCSS, 1, 'MF.model.toCSS spy counted once');
  assert.equal(calls.toJSON, 1, 'MF.model.toJSON spy counted once');
  assert.equal(state.writtenTexts.length, 2);
  assert.match(state.writtenTexts[0], /background:/);
  assert.match(state.writtenTexts[1], /"format": "meshflow-studio"/);
});

test('copyCSS / copyJSON resolve false when the serializers yield nothing', async () => {
  const { navigatorStub, state } = makeNavigator();
  const { mf } = createHarness({ navigator: navigatorStub });
  mf.model.toCSS = () => '';
  mf.model.toJSON = () => undefined;
  assert.equal(await mf.exporter.copyCSS({}), false);
  assert.equal(await mf.exporter.copyJSON({}), false);
  assert.equal(state.writtenTexts.length, 0, 'nothing empty is written to the clipboard');
});

/* ------------------------------------------------------------------ *
 * copyPNG
 * ------------------------------------------------------------------ */

test('copyPNG writes an image/png ClipboardItem when the browser supports it', async () => {
  const { navigatorStub, state } = makeNavigator();
  const { mf, calls, sink } = createHarness({
    navigator: navigatorStub,
    ClipboardItem: FakeClipboardItem,
  });

  assert.equal(await mf.exporter.copyPNG({ name: 'PNG' }, 2), true);
  assert.equal(calls.exportCanvas, 1, 'MF.engine.exportCanvas spy counted once');
  assert.equal(calls.toBlob, 1);
  assert.equal(sink.toBlobType, 'image/png');
  assert.equal(state.writtenItems.length, 1);
  const item = state.writtenItems[0][0];
  assert.ok(item instanceof FakeClipboardItem);
  assert.deepEqual(item.types, ['image/png']);
  assert.equal(item.data['image/png'].mock, 'png-blob');
});

test('copyPNG resolves false without ClipboardItem or clipboard permission', async () => {
  const noItem = makeNavigator();
  const harnessA = createHarness({ navigator: noItem.navigatorStub });
  assert.equal(await harnessA.mf.exporter.copyPNG({}, 2), false);
  assert.equal(harnessA.calls.exportCanvas, 0, 'canvas work is skipped when unsupported');

  const rejected = makeNavigator({ rejectWrite: true });
  const harnessB = createHarness({
    navigator: rejected.navigatorStub,
    ClipboardItem: FakeClipboardItem,
  });
  assert.equal(await harnessB.mf.exporter.copyPNG({}, 2), false);
});

/* ------------------------------------------------------------------ *
 * Downloads
 * ------------------------------------------------------------------ */

test('downloadPNG triggers a temporary anchor download and returns the file name', async () => {
  const dom = makeFakeDocument();
  const { mf, calls } = createHarness({ document: dom.documentStub });

  const state = { name: 'Aurora Veil' };
  const result = await mf.exporter.downloadPNG(state, 2);
  assert.equal(result, 'meshflow-stub-aurora-veil-2.png');
  assert.equal(calls.filename, 1);
  assert.equal(calls.toDataURL, 1);
  assert.equal(calls.click, 0, 'the click counter belongs to the fake anchor');
  assert.equal(dom.log.clicked.length, 1, 'exactly one anchor was clicked');
  const anchor = dom.log.clicked[0];
  assert.equal(anchor.tagName, 'a');
  assert.equal(anchor.download, result);
  assert.equal(anchor.href, 'data:image/png;base64,MESHFORWSTUB');
  assert.equal(dom.body.children.length, 0, 'the anchor was removed synchronously');
  assert.ok(dom.log.removed.includes(anchor));
});

test('downloadPNG resolves null when no data URL can be produced', async () => {
  const dom = makeFakeDocument();
  const { mf } = createHarness({ document: dom.documentStub });
  mf.engine.toDataURL = () => {
    throw new Error('canvas exploded');
  };
  assert.equal(await mf.exporter.downloadPNG({}, 1), null);
  assert.equal(dom.log.clicked.length, 0);
});

test('downloadCSS saves a .css Blob through an object URL and revokes it', async () => {
  const fake = makeDOMEnv();
  const { mf, calls } = createHarness(fake.env);

  assert.equal(await mf.exporter.downloadCSS({ name: 'Aurora Veil' }), true);
  assert.equal(calls.toCSS, 1);
  assert.equal(fake.url.state.created.length, 1);
  assert.equal(fake.url.state.revoked.length, 1, 'object URL was revoked');
  assert.equal(fake.url.state.revoked[0], 'blob:meshflow/1');
  const blob = fake.url.state.created[0];
  assert.match(blob.type, /^text\/css/);
  assert.match(String(blob.parts[0]), /background:/);
  const anchor = fake.dom.log.clicked[0];
  assert.match(anchor.download, /^meshflow-stub-aurora-veil-1\.css$/);
  assert.equal(fake.dom.body.children.length, 0);
});

test('downloadJSON saves a .json Blob through an object URL and revokes it', async () => {
  const fake = makeDOMEnv();
  const { mf, calls } = createHarness(fake.env);

  assert.equal(await mf.exporter.downloadJSON({ name: 'Aurora Veil' }), true);
  assert.equal(calls.toJSON, 1);
  assert.equal(fake.url.state.created.length, 1);
  assert.equal(fake.url.state.revoked.length, 1);
  const blob = fake.url.state.created[0];
  assert.match(blob.type, /^application\/json/);
  assert.match(String(blob.parts[0]), /"format": "meshflow-studio"/);
  const anchor = fake.dom.log.clicked[0];
  assert.match(anchor.download, /^meshflow-stub-aurora-veil-1\.json$/);
  assert.equal(fake.dom.body.children.length, 0);
});

test('downloadCSS / downloadJSON resolve false when the serializers yield nothing', async () => {
  const fake = makeDOMEnv();
  const { mf } = createHarness(fake.env);
  mf.model.toCSS = () => {
    throw new Error('bad css');
  };
  mf.model.toJSON = () => '';
  assert.equal(await mf.exporter.downloadCSS({}), false);
  assert.equal(await mf.exporter.downloadJSON({}), false);
  assert.equal(fake.url.state.created.length, 0, 'no blob is built for empty output');
  assert.equal(fake.dom.log.clicked.length, 0);
});
