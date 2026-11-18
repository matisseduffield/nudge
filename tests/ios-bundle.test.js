// The iPhone app's copy of the page (scripts/ios-bundle.mjs): it loads, it has
// nothing in it for features the iPhone app doesn't have, its reminders come out
// as they did, and the Android app and a browser still have all of theirs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const SCRIPT = path.join(ROOT, 'scripts/ios-bundle.mjs');
const load = () => import('file://' + SCRIPT.replace(/\\/g, '/'));
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

// Made once, by running the script as the build does.
const OUT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-ios-')), 'web');
test.after(() => fs.rmSync(path.dirname(OUT), { recursive: true, force: true }));
const made = () => {
  if (!fs.existsSync(OUT)) execFileSync(process.execPath, [SCRIPT, '--out', OUT], { stdio: 'pipe' });
  return OUT;
};
const CODE = ['index.html', 'style.css', 'lib.js', 'app.js'];

// Named in the sources the Android app and a browser run; never in the iPhone copy.
const ELSEWHERE = [
  'installUpdate', 'checkUpdate', 'updateCard', 'Update available', 'Check for updates', 'selfUpdates',
  'widgetItems', 'widget:', 'askExact', 'shouldAskExact', 'exactAsk', 'Ring on time?', 'Exact alarms',
  'No battery limits', 'Full-screen alarms', 'Show over other apps', 'loudBlocker',
  'Ring like a call', 'Rings like a call', 'fLoud', 'LOUD_NAG', 'ensureRing',
  'tellBack', "type: 'back'", 'focusAdd', 'nudgeFlush', 'nudging(t)',
  'nudgePlatform', 'data-platform', 'const ios', 'if (ios)', 'if (app)', 'if (!app)',
  'navigator.share', 'navigator.clipboard', 'Android', 'theme-color', 'module.exports', 'app.js?v=',
];

test('the script makes the iPhone copy and passes its own checks', async () => {
  const { check, KEEP } = await load();
  assert.deepEqual(check(made()), []);
  for (const file of KEEP) assert.ok(fs.existsSync(path.join(made(), file)), file);
});

test('only the files the iPhone app uses are in it', async () => {
  const { KEEP, LEAVE } = await load();
  const list = dir => fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => e.isFile())
    .map(e => path.relative(dir, path.join(e.parentPath || e.path, e.name)).split(path.sep).join('/')).sort();
  assert.deepEqual(list(made()), [...KEEP].sort());
  // Every file of web/ is accounted for, kept or left out.
  assert.deepEqual(list(WEB), [...KEEP, ...LEAVE].sort());
});

test('each script in it parses, and the page is whole', async () => {
  const { pageParts, SCRIPTS } = await load();
  const out = made();
  for (const file of SCRIPTS) execFileSync(process.execPath, ['--check', path.join(out, file)], { stdio: 'pipe' });
  const { inline, scripts, markup, local } = pageParts(read(out, 'index.html'));
  assert.deepEqual(inline, []);
  assert.deepEqual(scripts, SCRIPTS);
  for (const ref of local) assert.ok(fs.existsSync(path.join(out, ref)), ref);
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'an id is on the page twice');
  for (const m of read(out, 'app.js').matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) assert.ok(ids.includes(m[1]), `#${m[1]}`);
  // Each choice row still has the select it reads.
  for (const m of markup.matchAll(/data-pick="([^"]+)"/g)) assert.ok(ids.includes(m[1]), m[1]);
});

test('what only the other editions have is not in it, and is still in web/', async () => {
  const { FORBIDDEN } = await load();
  const out = made();
  const copy = CODE.map(f => read(out, f)).join('\n');
  const source = CODE.map(f => read(WEB, f)).join('\n');
  for (const word of ELSEWHERE) {
    assert.ok(!copy.includes(word), `in the copy: ${word}`);
    assert.ok(source.includes(word), `gone from web/: ${word}`);
  }
  for (const [pattern, why] of FORBIDDEN) assert.doesNotMatch(copy, pattern, why);
});

test('the copy has the iPhone\'s side written in, with no switch round it', () => {
  const copy = read(made(), 'app.js'), source = read(WEB, 'app.js');
  for (const line of [
    'const app = window.nudgeApp;',
    'const late = true;',
    "$('fCustom').addEventListener('blur', () => {",
    "$('health').replaceChildren(line('Notifications', health.notifications));",
    "$('fNag').setAttribute('aria-label', 'Keep nudging');",
    "toApp({ type: 'hello' });",
    'window.nudgeBack = () => {',
  ]) assert.ok(copy.includes(line), line);
  assert.match(source, /const ios = window\.nudgePlatform === 'ios';/);
  assert.match(source, /if \(app\) \{\r?\n/);
  // The styles the shared file keeps for the iPhone app apply to the copy outright.
  const css = read(made(), 'style.css');
  assert.equal((read(WEB, 'style.css').match(/\[data-platform="ios"\] /g) || []).length, (css.match(/^:root [^{]/gm) || []).length);
  assert.match(css, /^:root \.app \{ padding-top: max\(8px, env\(safe-area-inset-top, 0px\)\); \}/m);
  assert.match(css, /^\.notes-in \{ font-size: 1rem; \}/m);
});

// The copy's lib.js, run as the page runs it.
const copyLib = () => {
  const box = vm.createContext({});
  vm.runInContext(read(made(), 'lib.js'), box, { filename: 'lib.js' });
  return box.NudgeLib;
};
const without = (value, key) => JSON.parse(JSON.stringify(value, (k, v) => (k === key ? undefined : v)));
const same = (a, b, what) => assert.equal(JSON.stringify(a), JSON.stringify(b), what);

test('the copy\'s lib.js has every function of web/lib.js but the cut ones', () => {
  const W = require('../web/lib.js');
  const cut = ['shouldAskExact', 'exactBlocker', 'loudBlocker', 'ensureRing', 'LOUD_NAG', 'widgetItems'];
  assert.deepEqual(Object.keys(copyLib()), Object.keys(W).filter(k => !cut.includes(k)));
});

test('the copy works out tasks and reminders as web/lib.js does for the iPhone', () => {
  // Each side from a fresh start, so the ids they hand out run in step.
  delete require.cache[require.resolve('../web/lib.js')];
  const W = require('../web/lib.js'), C = copyLib();
  const NOW = new Date(2026, 10, 6, 10, 0);   // Friday 6 Nov 2026, 10am
  const lists = [{ id: 'h', name: 'Home' }, { id: 'w', name: 'Work stuff' }];
  const lines = [
    'Call mum tomorrow 5pm every week #home !!', 'Pills !!!', 'Pay rent on the 1st monthly remind me 1 day before',
    'Bins tonight', 'Run at 5:30', 'Dinner at 8', 'Standup every weekday 9am', 'Gym every mon, wed and fri 6pm',
    'Dentist 14 Feb 10:30', 'Water plants every 3 days', 'Ring bank in 20 min', 'Passport #newlist next month',
    'Lunch noon', 'Report friday', 'Nothing special', 'Meds every morning remind me 10 min before !',
  ];
  const tasks = [];
  for (const prefs of [{}, { defaultReminder: 0 }, { defaultReminder: 30, use24: true }]) {
    for (const text of lines) {
      // On the iPhone the page set loud to false before making the task; the copy never has it.
      const w = W.parseQuick(text, NOW, lists, { use24: prefs.use24 });
      const c = C.parseQuick(text, NOW, lists, { use24: prefs.use24 });
      same(without(w, 'loud'), c, `parseQuick: ${text}`);
      const made = W.makeTask({ ...w, loud: false }, NOW, prefs);
      same(without(made, 'loud'), C.makeTask(c, NOW, prefs), `makeTask: ${text}`);
      tasks.push(made);
    }
  }
  // Some set to keep nudging, one rung a few minutes ago, one snoozed, one done, one deleted.
  tasks[0].nag = 5;
  tasks[3] = { ...tasks[3], due: '2026-11-06', time: '09:55', reminders: [{ before: 0 }], nag: 5 };
  tasks[4] = { ...tasks[4], due: '2026-11-06', time: '09:50', reminders: [{ before: 0 }], nag: 15, snooze: +NOW + 6e5 };
  tasks[5].done = +NOW;
  tasks[6].deleted = +NOW;
  tasks[7].reminders = [{ before: 0 }, { before: 60 }, { at: '2026-11-08T07:15' }];
  for (const summary of [null, '08:00']) {
    for (const use24 of [false, true]) {
      const state = { lists, tasks, prefs: { summary, defaultReminder: 0, use24 } };
      for (const at of [NOW, new Date(2026, 10, 6, 23, 59), new Date(2026, 11, 31, 8, 0)]) {
        const w = W.schedule(state, at, true), c = C.schedule(without(state, 'loud'), at, true);
        assert.ok(w.length > 10);
        same(without(w, 'loud'), c, 'schedule');
        for (const t of tasks) same(without(W.firings(t, at, 60, use24, true), 'loud'), C.firings(without(t, 'loud'), at, 60, use24, true), 'firings');
      }
      same(without(W.cleanState(state), 'loud'), C.cleanState(without(state, 'loud')), 'cleanState');
      same(without(W.cleanState(JSON.parse(JSON.stringify(state))), 'loud'), C.cleanState(JSON.parse(JSON.stringify(without(state, 'loud')))), 'cleanState, from a save');
    }
  }
  for (const t of tasks) assert.equal(W.nagOf({ ...t, loud: false }), C.nagOf(t));
  // The reminder check: the iPhone app only ever had notifications to be off.
  for (const notifications of [true, false]) {
    assert.equal(W.reminderWarning({ notifications, exact: true, battery: true, fullScreen: true, overlay: true }, false), C.reminderWarning({ notifications }));
  }
  assert.equal(C.reminderWarning(null), null);
  // Taps on a reminder, ticking off, and the screens' lists.
  const state = { lists, tasks, prefs: {} };
  const actions = [{ type: 'done', task: tasks[0].id, occ: tasks[0].due, when: +NOW }, { type: 'snooze', task: tasks[1].id, occ: tasks[1].due, until: +NOW + 6e5 }];
  same(without(W.applyActions(state, actions, NOW), 'loud'), C.applyActions(without(state, 'loud'), actions, NOW), 'applyActions');
  for (const t of tasks) same(without(W.complete(t, NOW), 'loud'), C.complete(without(t, 'loud'), NOW), 'complete');
  same(without(W.today(tasks, NOW), 'loud'), C.today(without(tasks, 'loud'), NOW), 'today');
  same(without(W.upcoming(tasks, NOW), 'loud'), C.upcoming(without(tasks, 'loud'), NOW), 'upcoming');
});

test('the copy and the Swift shell say only what the other knows', async () => {
  const { messages, SENDS, HEARS } = await load();
  const { sends, hears } = messages(read(made(), 'app.js'));
  assert.deepEqual(sends, SENDS);
  assert.deepEqual(hears, HEARS);
  const swift = read(ROOT, 'ios/App/App.swift') + read(ROOT, 'ios/Shell/Shell.swift');
  // Every message the copy sends has a case for it, and there is no case for one it doesn't send.
  const handled = [...new Set([...swift.matchAll(/case ((?:"\w+"(?:, )?)+):/g)].flatMap(m => m[1].match(/\w+/g)))].sort();
  assert.deepEqual(handled, SENDS);
  const sent = [...new Set([...swift.matchAll(/"type": "(\w+)"/g)].map(m => m[1]))].sort();
  assert.deepEqual(sent, HEARS);
  // The web page of the other editions still has the messages that were cut from the copy.
  const all = messages(read(WEB, 'app.js'));
  for (const type of ['back', 'checkUpdate', 'installUpdate']) assert.ok(all.sends.includes(type), type);
  for (const type of ['focusAdd', 'update', 'updateStatus']) assert.ok(all.hears.includes(type), type);
});

test('the Swift shell names nothing the iPhone app does not have', () => {
  const swift = ['ios/App/App.swift', 'ios/Shell/Shell.swift', 'ios/App/Reminders.swift'].map(f => read(ROOT, f)).join('\n');
  for (const word of [
    'nudgePlatform', 'checkUpdate', 'installUpdate', '"updates"', '"platform"', '"exact"', '"battery"', '"fullScreen"', '"overlay"',
    '"notify"', 'isAppPath', 'WKUIDelegate', 'runJavaScript', 'createWebViewWith', 'openURLContexts', 'NSUserActivityTypeBrowsingWeb',
    'UniformTypeIdentifiers', 'webmanifest', 'wasm', 'mediaTypesRequiringUserActionForPlayback', 'androidplatform', 'blob',
  ]) assert.ok(!swift.includes(word), word);
  // It serves the kinds of file the copy has, and no others.
  const types = read(ROOT, 'ios/Shell/Shell.swift').match(/private static let types = \[([\s\S]*?)\]/)[1];
  assert.deepEqual([...types.matchAll(/"(\w+)": /g)].map(m => m[1]).sort(), ['css', 'html', 'js', 'txt', 'woff2']);
});

test('the iPhone app bundles the copy, made first, and Android still takes web/', () => {
  const project = read(ROOT, 'ios/project.yml');
  assert.match(project, /- path: bundle\/web\r?\n\s+type: folder/);
  assert.doesNotMatch(project, /\.\.\/web/);
  for (const file of ['.github/workflows/ios.yml', '.github/workflows/ios-release.yml']) {
    const flow = read(ROOT, file);
    const make = flow.indexOf('run: node scripts/ios-bundle.mjs'), gen = flow.indexOf('xcodegen generate');
    assert.ok(make > 0 && make < gen, `${file} makes the copy before the project`);
    assert.match(flow, /node scripts\/ios-bundle\.mjs --check "/, `${file} checks the built app`);
  }
  assert.match(read(ROOT, 'app/build.gradle.kts'), /assets\.srcDirs\("\.\.\/web"\)/);
  assert.match(read(ROOT, '.gitignore'), /^ios\/bundle\/$/m);
});

test('cuts take whole lines or part of one, with either line ending', async () => {
  const { strip } = await load();
  for (const nl of ['\n', '\r\n']) {
    const lines = ['a', '  /* ios:cut */', '  gone', '  /* ios:end */', 'b /* ios:cut */gone /* ios:end */c', '<p>', '<!-- ios:cut -->', '<i>gone</i>', '<!-- ios:end -->', '</p>'];
    const made = strip(lines.join(nl));
    assert.equal(made.text, ['a', 'b c', '<p>', '</p>'].join(nl));
    assert.equal(made.cuts, 3);
  }
});

test('a mark without its partner, or mistyped, stops the build', async () => {
  const { strip } = await load();
  assert.throws(() => strip('a /* ios:cut */ b'), /no end/);
  assert.throws(() => strip('a /* ios:end */ b'), /no cut/);
  assert.throws(() => strip('/* ios:cut */ a /* ios:cut */ b /* ios:end */'), /inside the cut/);
  assert.throws(() => strip('/* ios:cut */ a <!-- ios:end -->'), /not the kind/);
  assert.throws(() => strip('/* iOS: cut */ a /* ios:end */'), /no cut|looks like a mark/);
  assert.throws(() => strip('a /*ios:cut*/ b'), /looks like a mark/);
});

test('the checker turns away web/ itself, and a copy that has been added to', async () => {
  const { check } = await load();
  assert.ok(check(WEB).length > 50);
  const dir = path.join(path.dirname(made()), 'tampered');
  const fresh = () => { fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(made(), dir, { recursive: true }); };
  const add = (file, text) => { fresh(); fs.appendFileSync(path.join(dir, file), text); return check(dir).join('\n'); };
  assert.match(add('app.js', "\nfetch('https://example.com/x');"), /an address the iPhone app should not name: https:\/\/example\.com/);
  assert.match(add('app.js', "\ntoApp({ type: 'checkUpdate' });"), /the updater/);
  assert.match(add('app.js', "\ntoApp({ type: 'ring' });"), /app\.js sends the app/);
  assert.match(add('app.js', "\n$('nowhere');"), /#nowhere, which is not on the page/);
  assert.match(add('app.js', '\nnew Function("return 1")();'), /made or loaded at run time/);
  assert.match(add('lib.js', '\nconst x = navigator.userAgent;'), /where the page is running/);
  assert.match(add('style.css', '\n.x { color: red;'), /style\.css: \d+ \{ and \d+ \}/);
  assert.match(add('index.html', '<script>1</script>'), /inline scripts/);
  fresh();
  fs.writeFileSync(path.join(dir, 'sw.js'), '');
  assert.match(check(dir).join('\n'), /sw\.js: not a file the iPhone app should have/);
  fresh();
  const page = path.join(dir, 'index.html');
  fs.writeFileSync(page, read(page).replace('https://teloone.au/apps/nudge/privacy/', '#').replace('https://teloone.au/apps/nudge/terms/', '#'));
  assert.match(check(dir).join('\n'), /no longer names/);
});
