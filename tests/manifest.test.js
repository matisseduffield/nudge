const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const permissions = file => [...read(file).matchAll(/<uses-permission\s+android:name="android\.permission\.(\w+)"([^>]*)\/>/g)]
  .map(m => ({ name: m[1], rest: m[2] }));
const named = (list, name) => list.find(p => p.name === name);

const main = permissions('app/src/main/AndroidManifest.xml');
const github = permissions('app/src/github/AndroidManifest.xml');
const play = permissions('app/src/play/AndroidManifest.xml');

test('the shared manifest leaves exact alarms to each flavor', () => {
  assert.equal(named(main, 'USE_EXACT_ALARM'), undefined);
  assert.equal(named(main, 'SCHEDULE_EXACT_ALARM'), undefined);
});

test('the Play build has only the permission a person grants', () => {
  assert.equal(named(play, 'USE_EXACT_ALARM'), undefined);
  // No cap: Android 13 and later need it too, or setExactAndAllowWhileIdle can't be used.
  assert.ok(named(play, 'SCHEDULE_EXACT_ALARM'));
  assert.doesNotMatch(named(play, 'SCHEDULE_EXACT_ALARM').rest, /maxSdkVersion/);
});

test('the GitHub build keeps what it had', () => {
  assert.ok(named(github, 'USE_EXACT_ALARM'));
  assert.match(named(github, 'SCHEDULE_EXACT_ALARM').rest, /maxSdkVersion="32"/);
  assert.ok(named(github, 'REQUEST_INSTALL_PACKAGES'));
});

test('the self-updater permission never reaches the Play build', () => {
  assert.equal(named(main, 'REQUEST_INSTALL_PACKAGES'), undefined);
  assert.equal(named(play, 'REQUEST_INSTALL_PACKAGES'), undefined);
});

test('alarms set again when the person allows exact alarms', () => {
  assert.match(read('app/src/main/AndroidManifest.xml'), /android\.app\.action\.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED/);
});

test('only the Play build asks for exact alarms', () => {
  const gradle = read('app/build.gradle.kts');
  const flavor = name => gradle.slice(gradle.indexOf(`create("${name}")`)).split('}')[0];
  assert.match(flavor('github'), /"ASK_EXACT_ALARM", "false"/);
  assert.match(flavor('play'), /"ASK_EXACT_ALARM", "true"/);
});

test('settings links to the privacy policy, which opens outside the app', () => {
  const page = read('web/index.html');
  const settings = page.slice(page.indexOf('id="settingsPage"'), page.indexOf('</dialog>', page.indexOf('id="settingsPage"')));
  assert.match(settings, /<a class="privacy" href="https:\/\/teloone\.au\/apps\/nudge\/privacy\/"[^>]*>Privacy<\/a>/);
  // Any address that isn't the app's own goes to the system browser.
  const activity = read('app/src/main/java/com/matisseduffield/nudge/MainActivity.kt');
  assert.match(activity, /if \(request\.url\.host == APP_HOST\) return false\s+runCatching \{ startActivity\(Intent\(Intent\.ACTION_VIEW, request\.url\)\) \}/);
});
