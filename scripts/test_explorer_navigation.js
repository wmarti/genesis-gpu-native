#!/usr/bin/env node
'use strict';

// Run with: node scripts/test_explorer_navigation.js
// Exercises the shipped controller against the real source catalog. The small
// browser mock models the relevant History API rules; it does not automate UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {createExplorerNavigation} = require('../docs/explorer/navigation.js');

const explorer = path.resolve(__dirname, '../docs/explorer');
function readData(filename, globalName) {
  const text = fs.readFileSync(path.join(explorer, filename), 'utf8');
  const assignment = `window.${globalName} = `;
  const start = text.indexOf(assignment);
  assert.notEqual(start, -1, `${filename} must expose its documented global`);
  return JSON.parse(text.slice(start + assignment.length).trim().replace(/;$/, ''));
}
const architecture = readData('source-map.js', 'GENESIS_ARCHITECTURE');
const measurements = readData('measurements.js', 'GENESIS_MEASUREMENTS');
const sourceIndex = readData('source-index.js', 'GENESIS_SOURCE_INDEX');
const component = architecture.components.find(c => c.functions.length >= 2);
assert.ok(component, 'The real catalog must contain a component with sibling definitions');
const [firstFunction, nextFunction] = component.functions;
const unownedSymbol = sourceIndex.symbols.find(symbol =>
  !architecture.components.some(c => c.paths.includes(symbol.path)));
assert.ok(unownedSymbol, 'Test an indexed definition outside the curated component paths');

function browserHarness({hash = '', file = false, precedingEntry = false} = {}) {
  const base = file ? 'file:///preview/explorer/index.html' : 'https://example.test/genesis-gpu-native/';
  const initial = {url: base + hash, state: {unrelatedPageState: 'preserve me'}};
  const entries = precedingEntry
    ? [{url: 'https://example.test/previous-page', state: {previous: true}}, initial]
    : [initial];
  let cursor = entries.length - 1;
  let state = {};
  const listeners = new Map();
  const queuedEvents = [];
  const historyAttempts = [];
  const focusEvents = [];
  let renders = 0;
  const emit = type => {
    for (const listener of listeners.get(type) || []) listener({type});
  };
  function pushEntry(url, entryState = null) {
    entries.splice(cursor + 1); // A new navigation discards the forward branch.
    entries.push({url, state: entryState});
    cursor += 1;
  }
  const env = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    location: {
      get href() { return entries[cursor].url; },
      get hash() { return new URL(entries[cursor].url).hash; },
      set hash(value) {
        const url = new URL(entries[cursor].url);
        url.hash = value;
        if (url.href === entries[cursor].url) return;
        pushEntry(url.href);
        queuedEvents.push(() => emit('hashchange'));
      },
      replace(url) {
        entries[cursor] = {url, state: null};
        queuedEvents.push(() => emit('hashchange'));
      }
    },
    history: {
      get length() { return entries.length; },
      get state() { return entries[cursor].state; },
      pushState(entryState, title, url) {
        historyAttempts.push({method: 'pushState', url});
        if (file) throw new Error('History API unavailable in this file preview');
        pushEntry(new URL(url, entries[cursor].url).href, entryState);
        // pushState itself emits neither popstate nor hashchange.
      },
      replaceState(entryState, title, url) {
        historyAttempts.push({method: 'replaceState', url});
        if (file) throw new Error('History API unavailable in this file preview');
        entries[cursor] = {url: new URL(url, entries[cursor].url).href, state: entryState};
      }
    }
  };
  const navigation = createExplorerNavigation({
    architecture, measurements, sourceIndex, env,
    getState: () => state,
    setState: next => { state = next; },
    render: () => { renders += 1; },
    focus: (route, metadata) => { focusEvents.push({route, metadata}); }
  });
  function travel(delta) {
    assert.ok(cursor + delta >= 0 && cursor + delta < entries.length, 'History target exists');
    const oldHash = env.location.hash;
    cursor += delta;
    emit('popstate');
    if (oldHash !== env.location.hash) emit('hashchange');
  }
  return {
    navigation, env, entries, historyAttempts, focusEvents,
    get state() { return state; },
    get renders() { return renders; },
    get cursor() { return cursor; },
    start: () => navigation.start(),
    back: () => travel(-1),
    forward: () => travel(1),
    flush: () => { while (queuedEvents.length) queuedEvents.shift()(); },
    duplicateEvents: () => { emit('popstate'); emit('hashchange'); }
  };
}

function symbolRoute(symbol = firstFunction) {
  return {view: 'architecture', component: component.id, symbol, tab: 'code'};
}
function assertExactFunction(route, wanted) {
  assert.equal(route.symbol.path, wanted.path);
  assert.equal(route.symbol.line, wanted.line);
  assert.equal(route.symbol.name, wanted.name);
  assert.equal(route.symbol.snippet, wanted.snippet);
}

test('direct source links restore exact trusted definitions and tabs without rewriting initial history', () => {
  const hash = '#' + new URLSearchParams({
    component: component.id, function: firstFunction.id, tab: 'evidence'
  });
  const browser = browserHarness({hash, precedingEntry: true});
  const originalEntries = JSON.parse(JSON.stringify(browser.entries));
  browser.start();
  assertExactFunction(browser.state, firstFunction);
  assert.equal(browser.state.component, component.id);
  assert.equal(browser.state.focus, component.id);
  assert.equal(browser.state.tab, 'evidence');
  assert.deepEqual(browser.entries, originalEntries);
  assert.equal(browser.historyAttempts.length, 0);
  assert.equal(browser.focusEvents.length, 0, 'Initial load must not steal focus');
  const encoded = browser.navigation.encode(browser.state);
  assert.deepEqual(browser.navigation.decode(encoded), browser.state);
  const refreshed = browserHarness({hash: encoded});
  refreshed.start();
  assert.deepEqual(refreshed.state, browser.state);
  const sourceLink = browser.navigation.encode({...browser.state, tab: 'code'});
  const sourceReader = browserHarness({hash: sourceLink});
  sourceReader.start();
  assert.equal(sourceReader.focusEvents.length, 1, 'An explicit source link reveals its reader on stacked layouts');
  assertExactFunction(sourceReader.focusEvents[0].route, firstFunction);
  assert.equal(sourceReader.historyAttempts.length, 0);
});

test('malformed routes cannot supply source paths, code snippets, invalid enums, or an unrelated owner', () => {
  const browser = browserHarness();
  browser.start();
  for (const line of ['0', '-1', '1.5', 'NaN', '1e999', '99999999999999999']) {
    const route = browser.navigation.decode('#' + new URLSearchParams({
      file: firstFunction.path, line, symbol: firstFunction.name,
      view: 'javascript:alert(1)', tab: 'arbitrary', component: 'not-a-component'
    }));
    assert.equal(route.symbol, null, `Reject invalid line ${line}`);
    assert.equal(route.component, null);
    assert.equal(route.view, 'architecture');
    assert.equal(route.tab, 'details');
  }
  for (const file of ['../../etc/passwd', 'javascript:alert(1)', 'https://other.test/source']) {
    assert.equal(browser.navigation.decode('#' + new URLSearchParams({
      file, line: String(firstFunction.line), symbol: firstFunction.name
    })).symbol, null);
  }
  assert.equal(browser.navigation.decode('#' + new URLSearchParams({
    file: firstFunction.path, line: String(firstFunction.line), symbol: 'invented_function'
  })).symbol, null);
  const unrelated = architecture.components.find(c => c.id !== component.id &&
    !c.functions.some(f => f.path === firstFunction.path && f.line === firstFunction.line));
  assert.ok(unrelated);
  const resolved = browser.navigation.normalize({
    ...symbolRoute(), component: unrelated.id,
    symbol: {...firstFunction, snippet: '<script>not trusted</script>', url: 'javascript:alert(1)'}
  });
  assertExactFunction(resolved, firstFunction);
  assert.equal(resolved.component, component.id);
  assert.equal(resolved.symbol.url, firstFunction.url);
  browser.navigation.navigate({view: 'measurements', deck: 'cellulose', precision: 'FP64', hardware: 'a100'});
  const fresh = browser.navigation.decode('#view=bad&deck=unknown&hardware=unknown');
  assert.equal(fresh.view, 'architecture');
  assert.equal(fresh.deck, 'tuned', 'Parsing must start fresh rather than leak previous route fields');
  assert.equal(fresh.hardware, 'b200');
});

test('browser Back and Forward restore sibling functions and tabs, rendering once per traversal', () => {
  const browser = browserHarness();
  browser.start();
  browser.navigation.navigate({component: component.id});
  browser.navigation.navigate({focus: component.id});
  browser.navigation.navigate(symbolRoute());
  browser.navigation.navigate({symbol: nextFunction});
  browser.navigation.navigate({tab: 'evidence'});
  let renders = browser.renders;
  browser.back();
  assert.equal(browser.renders, renders + 1, 'popstate + hashchange must not render twice');
  assertExactFunction(browser.state, nextFunction);
  assert.equal(browser.state.tab, 'code');
  renders = browser.renders;
  browser.back();
  assert.equal(browser.renders, renders + 1);
  assertExactFunction(browser.state, firstFunction);
  browser.back();
  assert.equal(browser.state.symbol, null);
  assert.equal(browser.state.focus, component.id);
  browser.forward();
  assertExactFunction(browser.state, firstFunction);
  assert.equal(browser.focusEvents.at(-1).metadata.restoring, true);
  renders = browser.renders;
  browser.duplicateEvents();
  assert.equal(browser.renders, renders, 'Repeated delivery of the same location is inert');
});

test('in-app Back follows source → parts → selected map component → overview', () => {
  const browser = browserHarness();
  browser.start();
  browser.navigation.navigate(symbolRoute());
  assert.equal(browser.state.focus, component.id, 'Opening source must keep its parts navigator');
  assert.equal(browser.navigation.goUp(), true);
  assert.equal(browser.state.symbol, null);
  assert.equal(browser.state.focus, component.id);
  assert.equal(browser.state.tab, 'details');
  assert.equal(browser.navigation.goUp(), true);
  assert.equal(browser.state.focus, null);
  assert.equal(browser.state.component, component.id);
  assert.equal(browser.navigation.goUp(), true);
  assert.equal(browser.state.component, null);
  assert.equal(browser.navigation.canGoUp(), false);
  const length = browser.entries.length;
  assert.equal(browser.navigation.goUp(), false);
  assert.equal(browser.entries.length, length);
});

test('unowned indexed definitions return to the source index and commit details return to history', () => {
  const browser = browserHarness();
  browser.start();
  browser.navigation.navigate({symbol: unownedSymbol, tab: 'code'});
  assert.equal(browser.state.component, null);
  assert.equal(browser.state.focus, null);
  assert.equal(browser.state.symbol, unownedSymbol);
  browser.navigation.goUp();
  assert.equal(browser.state.tab, 'code');
  assert.equal(browser.state.symbol, null);
  browser.navigation.goUp();
  assert.equal(browser.state.tab, 'details');
  browser.navigation.navigate({view: 'movement', commit: measurements.history[0].sha});
  browser.navigation.goUp();
  assert.equal(browser.state.view, 'movement');
  assert.equal(browser.state.commit, null);
  browser.navigation.goUp();
  assert.equal(browser.state.view, 'architecture');
});

test('route no-ops add no history and new navigation after Back discards the old forward branch', () => {
  const browser = browserHarness();
  browser.start();
  browser.navigation.navigate(symbolRoute());
  const length = browser.entries.length;
  browser.navigation.navigate(symbolRoute());
  browser.navigation.commit();
  assert.equal(browser.entries.length, length);
  browser.navigation.navigate({symbol: nextFunction});
  browser.back();
  browser.navigation.navigate({tab: 'evidence'});
  assert.equal(browser.cursor, browser.entries.length - 1);
  assert.equal(browser.entries.length, length + 1);
  assertExactFunction(browser.state, firstFunction);
  assert.equal(browser.state.tab, 'evidence');
});

test('measurement choices roundtrip and browser Back restores the previous experiment', () => {
  const browser = browserHarness();
  browser.start();
  const previous = {view: 'measurements', measure: 'scaling', deck: 'cellulose',
    hardware: 'a100', precision: 'FP64', unit: 'msPerStep', tab: 'evidence'};
  browser.navigation.navigate(previous);
  browser.navigation.navigate({hardware: 'rtx3090', unit: 'nsPerDay', tab: 'details'});
  browser.back();
  for (const [key, value] of Object.entries(previous)) assert.equal(browser.state[key], value);
  assert.deepEqual(browser.navigation.decode(browser.navigation.encode(browser.state)), browser.state);
});

test('file preview falls back to fragments and suppresses its own queued hashchange', () => {
  const browser = browserHarness({file: true});
  browser.start();
  assert.equal(browser.historyAttempts.length, 0);
  const result = browser.navigation.navigate(symbolRoute());
  assert.equal(result.written, true);
  assert.equal(browser.historyAttempts[0].method, 'pushState');
  assert.equal(browser.entries.length, 2);
  assert.ok(browser.env.location.href.startsWith('file:///preview/explorer/index.html#'));
  const renders = browser.renders;
  browser.flush();
  assert.equal(browser.renders, renders, 'The fallback hashchange must not replay its own route');
  browser.back();
  assert.equal(browser.state.symbol, null);
  assert.equal(browser.state.component, null);
  browser.forward();
  assertExactFunction(browser.state, firstFunction);
  assert.equal(browser.state.focus, component.id);
});

test('full-file links use trusted files, preserve an arbitrary line, and reveal the reader on load', () => {
  const file = sourceIndex.files.find(f => f.path === firstFunction.path);
  assert.ok(file);
  const line = Math.min(firstFunction.line + 7, file.lines);
  const hash = '#' + new URLSearchParams({source: 'file', file: file.path, line: String(line)});
  const browser = browserHarness({hash, precedingEntry: true});
  const initialEntries = JSON.parse(JSON.stringify(browser.entries));
  browser.start();
  assert.equal(browser.state.view, 'architecture');
  assert.equal(browser.state.tab, 'code');
  assert.equal(browser.state.sourceMode, 'file');
  assert.equal(browser.state.sourceFile, file.path);
  assert.equal(browser.state.sourceLine, line);
  assert.equal(browser.state.symbol, null, 'A file location must not invent a selected definition');
  assert.equal(browser.state.component, component.id);
  assert.equal(browser.state.focus, component.id);
  assert.equal(browser.focusEvents.length, 1);
  assert.deepEqual(browser.entries, initialEntries, 'Opening a shared file link preserves browser history');
  assert.deepEqual(browser.navigation.decode(browser.navigation.encode(browser.state)), browser.state);

  const noDefinitions = sourceIndex.files.find(f => f.symbols === 0);
  assert.ok(noDefinitions, 'The real catalog contains source files without indexed definitions');
  const header = browser.navigation.decode('#' + new URLSearchParams({
    source: 'file', file: noDefinitions.path, line: '1', view: 'measurements', tab: 'evidence'
  }));
  assert.equal(header.sourceFile, noDefinitions.path);
  assert.equal(header.sourceMode, 'file');
  assert.equal(header.view, 'architecture');
  assert.equal(header.tab, 'code');
});

test('full-file routes reject unindexed paths and keep line locations within the actual file', () => {
  const browser = browserHarness();
  browser.start();
  const file = sourceIndex.files.find(f => f.path === firstFunction.path);
  for (const path of ['../../etc/passwd', '/etc/passwd', 'javascript:alert(1)',
    'https://other.test/source', file.path + '/../../README.md']) {
    const route = browser.navigation.decode('#' + new URLSearchParams({
      source: 'file', file: path, line: '10'
    }));
    assert.equal(route.sourceMode, 'excerpt', path);
    assert.equal(route.sourceFile, null, path);
    assert.equal(route.sourceLine, null, path);
  }
  for (const invalid of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '1e2', '99999999999999999']) {
    const route = browser.navigation.decode('#' + new URLSearchParams({
      source: 'file', file: file.path, line: invalid
    }));
    assert.equal(route.sourceLine, 1, `Invalid line ${invalid} defaults to the first line`);
  }
  const beyondEnd = browser.navigation.decode('#' + new URLSearchParams({
    source: 'file', file: file.path, line: String(file.lines + 123)
  }));
  assert.equal(beyondEnd.sourceLine, file.lines);
  const excerpt = browser.navigation.normalize({
    ...symbolRoute(), sourceMode: 'excerpt', sourceFile: file.path, sourceLine: 25
  });
  assert.equal(excerpt.sourceFile, null);
  assert.equal(excerpt.sourceLine, null);
});

test('sharing a full file preserves exact symbol identity separately from the line being read', () => {
  const browser = browserHarness();
  browser.start();
  const file = sourceIndex.files.find(f => f.path === firstFunction.path);
  const line = Math.min(firstFunction.line + 7, file.lines);
  assert.notEqual(line, firstFunction.line, 'Exercise a location beyond the definition header');
  browser.navigation.navigate({...symbolRoute(), sourceMode: 'file', sourceLine: line});
  assert.equal(browser.state.sourceFile, file.path, 'The symbol supplies its trusted file');
  assertExactFunction(browser.state, firstFunction);
  const hash = browser.navigation.encode(browser.state);
  const params = new URLSearchParams(hash.slice(1));
  assert.equal(params.get('source'), 'file');
  assert.equal(params.get('file'), file.path);
  assert.equal(params.get('line'), String(line));
  assert.equal(params.get('symbolLine'), String(firstFunction.line));
  const recipient = browserHarness({hash});
  recipient.start();
  assert.deepEqual(recipient.state, browser.state);
  assertExactFunction(recipient.state, firstFunction);

  const atDefinition = browser.navigation.normalize({...browser.state, sourceLine: firstFunction.line});
  const declarationHash = browser.navigation.encode(atDefinition);
  assert.equal(new URLSearchParams(declarationHash.slice(1)).has('symbolLine'), false);
  assert.deepEqual(browser.navigation.decode(declarationHash), atDefinition);
});

test('in-app Back exits full file to excerpt, parts, or source index according to context', () => {
  const browser = browserHarness();
  browser.start();
  browser.navigation.navigate({...symbolRoute(), sourceMode: 'file'});
  assert.equal(browser.navigation.backLabel(), 'Back to source excerpt');
  browser.navigation.goUp();
  assertExactFunction(browser.state, firstFunction);
  assert.equal(browser.state.sourceMode, 'excerpt');
  assert.equal(browser.state.sourceFile, null);
  assert.equal(browser.state.sourceLine, null);
  assert.equal(browser.state.tab, 'code');
  browser.navigation.goUp();
  assert.equal(browser.state.symbol, null);
  assert.equal(browser.state.focus, component.id);
  assert.equal(browser.state.tab, 'details');

  browser.navigation.navigate({sourceMode: 'file', sourceFile: firstFunction.path, sourceLine: 1});
  assert.equal(browser.navigation.backLabel(), 'Back to component parts');
  browser.navigation.goUp();
  assert.equal(browser.state.focus, component.id);
  assert.equal(browser.state.tab, 'details');
  assert.equal(browser.state.sourceFile, null);

  browser.navigation.navigate({sourceMode: 'file', sourceFile: unownedSymbol.path, sourceLine: 1});
  assert.equal(browser.state.component, null, 'A previous component cannot claim an unrelated file');
  assert.equal(browser.state.focus, null);
  assert.equal(browser.navigation.backLabel(), 'Back to source index');
  browser.navigation.goUp();
  assert.equal(browser.state.sourceMode, 'excerpt');
  assert.equal(browser.state.symbol, null);
  assert.equal(browser.state.tab, 'code');
});

test('full-file browser history restores line and symbol, and explicit exits clear file state', () => {
  const browser = browserHarness();
  browser.start();
  browser.navigation.navigate(symbolRoute());
  browser.navigation.navigate({sourceMode: 'file', sourceLine: firstFunction.line + 1});
  const firstFileState = {...browser.state};
  browser.navigation.navigate({sourceLine: firstFunction.line + 2});
  const length = browser.entries.length;
  browser.navigation.navigate({sourceLine: firstFunction.line + 2});
  assert.equal(browser.entries.length, length, 'Sharing or repeating the same file location is a route no-op');
  browser.back();
  assert.deepEqual(browser.state, firstFileState);
  browser.back();
  assert.equal(browser.state.sourceMode, 'excerpt');
  assert.equal(browser.state.sourceFile, null);
  assertExactFunction(browser.state, firstFunction);
  browser.forward();
  assert.deepEqual(browser.state, firstFileState);
  const renders = browser.renders;
  browser.duplicateEvents();
  assert.equal(browser.renders, renders);
  browser.navigation.navigate({view: 'measurements', component: null, focus: null, symbol: null,
    sourceMode: 'excerpt', sourceFile: null, sourceLine: null, tab: 'details'});
  assert.equal(browser.state.view, 'measurements');
  assert.equal(browser.state.sourceFile, null);
  assert.equal(browser.state.sourceLine, null);
});

test('full-file routes work in file previews and do not retain a symbol from a different file', () => {
  const browser = browserHarness({file: true});
  browser.start();
  browser.navigation.navigate({...symbolRoute(), sourceMode: 'file'});
  assert.equal(browser.historyAttempts.at(-1).method, 'pushState');
  const renders = browser.renders;
  browser.flush();
  assert.equal(browser.renders, renders);
  browser.navigation.navigate({sourceFile: unownedSymbol.path, sourceLine: unownedSymbol.line});
  assert.equal(browser.state.sourceFile, unownedSymbol.path);
  assert.equal(browser.state.symbol, null);
  assert.equal(browser.state.component, null);
  browser.back();
  assert.equal(browser.state.sourceFile, firstFunction.path);
  assertExactFunction(browser.state, firstFunction);
});
