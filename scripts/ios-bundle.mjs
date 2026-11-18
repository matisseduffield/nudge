#!/usr/bin/env node
// Makes the iPhone app's copy of the page.
//
// web/ is one set of files for the Android app, the iPhone app and a plain browser.
// Some of it is only for the others: the Android app's updater, its home screen
// widget, its alarm settings, ringing like a call, its Back button and its endless
// nudging, and what a browser does with no app behind the page. Those parts are
// marked in the sources:
//
//   /* ios:cut */ ... /* ios:end */        in scripts and styles
//   <!-- ios:cut --> ... <!-- ios:end -->  in markup
//
// The marks are comments, so the Android app and a browser run the files exactly as
// before. This script copies web/ to ios/bundle/web without the marked parts, then
// checks the copy: it must load, and none of the words in FORBIDDEN may be left in
// it. The iPhone app bundles that folder (ios/project.yml), so what it ships has no
// code for features it doesn't have.
//
//   node scripts/ios-bundle.mjs               make ios/bundle/web and check it
//   node scripts/ios-bundle.mjs --out DIR     make it somewhere else
//   node scripts/ios-bundle.mjs --check DIR   only check a folder (the one in a built app)
//
// No dependencies: Node 18 or later.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB = path.join(ROOT, 'web');
export const OUT = path.join(ROOT, 'ios', 'bundle', 'web');

// Every file in web/ is on one of these two lists. A new file stops the build
// until someone says which it is.
export const KEEP = [
  'index.html',
  'style.css',
  'lib.js',
  'app.js',
  'fonts/OFL.txt',
  'fonts/hanken-grotesk-latin.woff2',
];
export const LEAVE = [];

// The page's scripts, in the order it loads them.
export const SCRIPTS = ['lib.js', 'app.js'];

// What must not be in the iPhone app's copy, and why. Checked against the page, its
// styles and its scripts, case as written unless marked i.
export const FORBIDDEN = [
  [/ios\s*:\s*(cut|end)/i, 'a cut mark left behind, or one mistyped'],
  [/android/i, 'the Android app'],
  [/\bapk\b/i, 'the Android package'],
  [/latest\.json/, 'the updater\'s release file'],
  [/nudge-releases|githubusercontent|github\.com/i, 'the releases repository'],
  [/update/i, 'the updater: its card, its menu row, its messages and its words'],
  [/selfUpdates|versionTimer|showNote|aboutCheck|aboutNote|aboutApp|id="version"|\$\('version'\)|#version\b|data-state/, 'the updater'],
  [/What's new|allow installs|Not now|Couldn.t check|Checking/i, 'the updater\'s words'],
  [/(?<!interactive-)widget/i, 'the home screen widget'],   // interactive-widget is a word of the viewport tag
  [/askExact|shouldAskExact|exactBlocker|exactAsk|exactGo|exactLater|askedExact|health\.exact|Exact alarms|Ring on time|ring late|Alarms &amp; reminders|alarms and reminders/, 'Android\'s exact alarm setting'],
  [/battery|fullScreen|full-screen|fullscreen|overlay|over other apps|lock screen/i, 'Android\'s other alarm settings'],
  [/\bloud\b|fLoud|LOUD_NAG|loudBlocker|ensureRing|like a call|Takes over the screen/i, 'ringing like a call'],
  [/\bnudging\(|\bnudging = |Alarms\.keep|AlarmPlan/, 'the Android app\'s endless nudging, or its classes by name'],
  [/tellBack|type: 'back'|focusAdd|nudgeFlush/, 'messages and hooks only the Android app uses'],
  [/nudgePlatform|data-platform|dataset\.platform|\bios\b/i, 'a platform switch, or the platform named'],
  [/if \(!?app\)|\bapp &&|nudgeApp \|\||typeof module|module\.exports|node --test/, 'a test for whether there is an app, or for where the script is running'],
  [/navigator\.|clipboard|userAgent|hostname|standalone|CSS\.supports|@supports \(-webkit/, 'a browser fallback, or a test of where the page is running'],
  [/serviceWorker|service worker|manifest|apple-touch-icon|apple-mobile-web-app|mobile-web-app-capable|Add to Home Screen/i, 'home screen installing'],
  [/\b(Google )?Play\b|App Store/, 'store talk'],
  [/play store|TestFlight/i, 'store talk'],
  [/download|sideload|upgrade|new version/i, 'words for getting the app some other way'],
  [/website|browser|on a computer|on the web\b|web ?views?\b/i, 'a comment about another edition'],
  [/theme-color|rel="icon"|\.(js|css)\?v=/, 'something only the other editions use'],
  [/btn primary|\.btn\.primary|\.row-v\.new|\.editor \.warn/, 'styles only the cut parts used'],
  [/\beval\(|\bFunction\(|importScripts|document\.write|createElement\(\s*['"`]script|\bimport\(|set(Timeout|Interval)\(\s*['"`]|Worker\(|WebAssembly|XMLHttpRequest|WebSocket|sendBeacon|\bfetch\(|<iframe|javascript:/i, 'code made or loaded at run time, or a way out to the network (the page has none)'],
  [/sessionStorage|\bprompt\(|\bconfirm\(|\balert\(/, 'something the page has no use for'],
];

// Every address the copy may name: the two links on the About page (the privacy
// policy and the terms). The page fetches nothing. The check wants exactly these,
// no more and no fewer, so a new address is a decision.
export const HOSTS = [
  'teloone.au',
];

// The messages the copy may send the app, and the ones it may hear. The Swift side
// (ios/App/App.swift, ios/Shell/Shell.swift) handles and sends exactly these.
export const SENDS = ['askNotifications', 'haptic', 'hello', 'openSettings', 'save', 'share'];
export const HEARS = ['actions', 'health', 'info', 'open', 'state'];

// The files the FORBIDDEN words are looked for in. Not the font's licence, which is
// someone else's text and has to stay as it is.
const isCode = file => /\.(html|css|js)$/.test(file);
const isText = file => isCode(file) || /\.(txt|json|svg|mjs)$/.test(file);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

// Takes the marked parts out of one file's text. A cut that has lines to itself
// goes with its lines; one inside a line leaves the rest of the line as it was.
// Throws on a mark with no partner, a cut inside a cut, or an end of the other kind.
export function strip(text, name = 'text') {
  const marks = /(\/\*|<!--) ios:(cut|end) (\*\/|-->)/g;
  const where = index => `${name}:${lineOf(text, index)}`;
  let out = '', from = 0, open = null, cuts = 0;
  for (const m of text.matchAll(marks)) {
    const [whole, opener, word, closer] = m;
    if ((opener === '/*') !== (closer === '*/')) throw new Error(`${where(m.index)}: a malformed mark, ${whole}`);
    if (word === 'cut') {
      if (open) throw new Error(`${where(m.index)}: a cut inside the cut that starts at line ${lineOf(text, open.index)}`);
      open = { index: m.index, opener };
      continue;
    }
    if (!open) throw new Error(`${where(m.index)}: an end with no cut before it`);
    if (open.opener !== opener) throw new Error(`${where(m.index)}: this end is not the kind of mark its cut is (line ${lineOf(text, open.index)})`);
    let start = open.index, end = m.index + whole.length;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const after = /^[ \t]*\r?\n/.exec(text.slice(end));
    if (/^[ \t]*$/.test(text.slice(lineStart, start)) && after) { start = lineStart; end += after[0].length; }
    out += text.slice(from, start);
    from = end;
    open = null;
    cuts++;
  }
  if (open) throw new Error(`${where(open.index)}: a cut with no end`);
  out += text.slice(from);
  const left = /ios\s*:\s*(cut|end)/i.exec(out);
  if (left) throw new Error(`${name}:${lineOf(out, left.index)} (after cutting): something that looks like a mark but isn't written as one`);
  return { text: out, cuts };
}

// The two things the copy has written differently, besides what is cut. Each must be
// found, or the build stops.
function rewrite(file, text) {
  if (file === 'index.html') {
    // The ?v= on a file's name is for caches between a server and a browser. The
    // app's own files can't be stale.
    for (const name of ['style.css', ...SCRIPTS]) {
      const tag = new RegExp(`"${name.replace('.', '\\.')}\\?v=\\d+"`, 'g');
      if ((text.match(tag) || []).length !== 1) throw new Error(`web/index.html: expected one "${name}?v=N"`);
      text = text.replace(tag, `"${name}"`);
    }
  }
  if (file === 'style.css') {
    // Rules the shared styles keep for the iPhone app alone apply to every page of
    // the copy. `:root` weighs what the attribute did, so each rule still wins and
    // loses against the same rules as before.
    const flag = '[data-platform="ios"] ';
    if (!text.includes(flag)) throw new Error('web/style.css: expected rules that start [data-platform="ios"]');
    text = text.split(flag).join(':root ');
  }
  return text;
}

// Copies web/ to `out` without the marked parts.
export function build(out = OUT, web = WEB) {
  const files = walk(web);
  const unknown = files.filter(f => !KEEP.includes(f) && !LEAVE.includes(f));
  if (unknown.length) throw new Error(`web/ has files this script has not been told about (add each to KEEP or LEAVE): ${unknown.join(', ')}`);
  const missing = [...KEEP, ...LEAVE].filter(f => !files.includes(f));
  if (missing.length) throw new Error(`Listed in this script but not in web/: ${missing.join(', ')}`);
  fs.rmSync(out, { recursive: true, force: true });
  let cuts = 0;
  for (const file of KEEP) {
    const to = path.join(out, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!isCode(file)) { fs.copyFileSync(path.join(web, file), to); continue; }
    const made = strip(fs.readFileSync(path.join(web, file), 'utf8'), `web/${file}`);
    cuts += made.cuts;
    fs.writeFileSync(to, rewrite(file, made.text));
  }
  return { out, files: KEEP.length, cuts };
}

// The inline scripts of a page, and the scripts and files it names.
export function pageParts(html) {
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const inline = [...bare.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const scripts = [...bare.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m => m[1]);
  const markup = bare.replace(/<script[^>]*>[\s\S]*?<\/script>/g, m => m.replace(/>[\s\S]*</, '><')).replace(/<style[^>]*>[\s\S]*?<\/style>/g, '<style></style>');
  const refs = new Set();
  for (const m of markup.matchAll(/\b(?:src|href)="([^"]+)"/g)) refs.add(m[1]);
  const local = [...refs].filter(r => !/^(https?:|data:|mailto:|#)/.test(r)).map(r => r.split(/[?#]/)[0]);
  return { inline, scripts, markup, local };
}

// Every tag that opens is closed, in order. Enough to say the page will load as written.
function tagProblems(markup) {
  const empty = new Set(['meta', 'link', 'input', 'img', 'br', 'hr', '!doctype']);
  const stack = [], problems = [];
  for (const m of markup.matchAll(/<(\/?)([A-Za-z!][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g)) {
    const [, closing, raw, , selfClosed] = m;
    const tag = raw.toLowerCase();
    if (empty.has(tag) || selfClosed) continue;
    if (!closing) { stack.push(tag); continue; }
    const top = stack.pop();
    if (top !== tag) problems.push(`</${tag}> closes <${top || 'nothing'}>`);
  }
  if (stack.length) problems.push(`left open: ${stack.join(', ')}`);
  return problems;
}

// The message types a script sends the app, and the ones it listens for.
export function messages(code) {
  const sends = new Set([...code.matchAll(/toApp\(\{ type: '(\w+)'/g)].map(m => m[1]));
  const hears = new Set([...code.matchAll(/m\.type === '(\w+)'/g)].map(m => m[1]));
  return { sends: [...sends].sort(), hears: [...hears].sort() };
}

// Checks a folder that is meant to be the iPhone app's copy. Returns the problems found.
export function check(dir = OUT) {
  const problems = [];
  if (!fs.existsSync(dir)) return [`${dir} does not exist`];
  const files = walk(dir);
  const text = file => fs.readFileSync(path.join(dir, file), 'utf8');
  for (const f of files) if (!KEEP.includes(f)) problems.push(`${f}: not a file the iPhone app should have`);
  for (const f of KEEP) if (!files.includes(f)) problems.push(`${f}: missing`);
  for (const f of files) if (!isCode(f) && isText(f) && f !== 'fonts/OFL.txt') problems.push(`${f}: a text file nobody has read for the iPhone app`);
  for (const file of files.filter(isCode)) {
    text(file).split('\n').forEach((line, i) => {
      for (const [pattern, why] of FORBIDDEN) {
        const hit = pattern.exec(line);
        if (hit) problems.push(`${file}:${i + 1}: "${hit[0]}" (${why})`);
      }
    });
  }
  // The addresses in the page, its styles and its scripts (not the font's licence text).
  const hosts = new Set(), plain = new Set();
  for (const file of files.filter(isCode)) {
    for (const m of text(file).matchAll(/(https?):\/\/([^\/\s"'`<>)]+)/g)) (m[1] === 'https' ? hosts : plain).add(m[2]);
  }
  for (const h of hosts) if (!HOSTS.includes(h)) problems.push(`an address the iPhone app should not name: https://${h}`);
  for (const h of HOSTS) if (!hosts.has(h)) problems.push(`an address on the list that the copy no longer names (take it off HOSTS): https://${h}`);
  for (const h of plain) problems.push(`an address without https: http://${h}`);
  const parses = (code, name) => { try { new vm.Script(code, { filename: name }); } catch (e) { problems.push(`${name}: does not parse: ${e.message}`); } };
  for (const file of files.filter(f => f.endsWith('.js'))) parses(text(file), file);
  if (files.includes('style.css')) {
    const css = text('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const opens = (css.match(/\{/g) || []).length, closes = (css.match(/\}/g) || []).length;
    if (opens !== closes) problems.push(`style.css: ${opens} { and ${closes} }`);
    if (/\{\s*\{|,\s*\{|\{[^{}]*\{[^{}]*\{[^{}]*\{/.test(css)) problems.push('style.css: a rule a cut has left broken');
    for (const m of css.matchAll(/url\("([^"]+)"\)/g)) if (!/^data:/.test(m[1]) && !files.includes(m[1])) problems.push(`style.css: names ${m[1]}, which is not in the folder`);
  }
  if (files.includes('index.html')) {
    const html = text('index.html');
    const { inline, scripts, markup, local } = pageParts(html);
    if (!/^<!doctype html>/i.test(html)) problems.push('index.html: no doctype');
    if (inline.length) problems.push(`index.html: ${inline.length} inline scripts, expected none`);
    if (scripts.join() !== SCRIPTS.join()) problems.push(`index.html: loads ${scripts.join(', ') || 'no scripts'}, expected ${SCRIPTS.join(', ')}`);
    if (/\son\w+="/.test(markup)) problems.push('index.html: a script written into a tag');
    for (const p of tagProblems(markup)) problems.push(`index.html: ${p}`);
    for (const ref of local) if (!files.includes(ref)) problems.push(`index.html: names ${ref}, which is not in the folder`);
    // Each element the script asks for by name is on the page, and no name is there twice.
    const all = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const ids = new Set(all);
    for (const id of ids) if (all.filter(x => x === id).length > 1) problems.push(`index.html: #${id} is on the page more than once`);
    if (files.includes('app.js')) {
      const code = text('app.js');
      for (const m of code.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) {
        if (!ids.has(m[1])) problems.push(`app.js asks for #${m[1]}, which is not on the page`);
      }
      // The copy and the app say only what the other knows.
      const { sends, hears } = messages(code);
      if (sends.join() !== SENDS.join()) problems.push(`app.js sends the app ${sends.join(', ')}; expected ${SENDS.join(', ')}`);
      if (hears.join() !== HEARS.join()) problems.push(`app.js hears ${hears.join(', ')} from the app; expected ${HEARS.join(', ')}`);
    }
  }
  return [...new Set(problems)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const only = value('--check');
  if ((args.includes('--check') && !only) || (args.includes('--out') && !value('--out'))) {
    console.error('Usage: node scripts/ios-bundle.mjs [--out DIR] | --check DIR');
    process.exit(2);
  }
  try {
    let dir = only && path.resolve(only);
    if (!dir) {
      const made = build(value('--out') ? path.resolve(value('--out')) : OUT);
      dir = made.out;
      console.log(`${path.relative(process.cwd(), dir) || dir}: ${made.files} files, ${made.cuts} marked parts left out`);
    }
    const problems = check(dir);
    if (problems.length) {
      console.error(`Not fit for the iPhone app (${problems.length}):`);
      for (const p of problems) console.error('  ' + p);
      process.exit(1);
    }
    console.log('Checked: it parses, and nothing the iPhone app does not have is in it.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
