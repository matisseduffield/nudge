# Nudge

To-do lists with reminders that ring. Same family as Bureau, Tally, Dailies and
Bourse: one palette, Hanken Grotesk, no build step, a web page in an Android shell.

- `web/`: the app. `lib.js` is the pure logic (quick add, repeats, working out when
  reminders fire), tested with `node --test "tests/*.test.js"`.
- `app/`: the Android shell. The page owns the tasks and hands the phone a plain
  list of alarms; `reminders/Alarms.kt` rings them with the app closed, and
  `AlarmPlan.kt` is the part with tests (`./gradlew :app:testDebugUnitTest`).
- Taps on notifications queue up in `actions.json` until the page next opens.
- Tasks live in the app's files, so Android's backup carries them to a new phone.

Reminders ring in the Android app and the iPhone app. In a browser it's just a list.

## The iPhone app

`ios/` is a small Swift shell (XcodeGen, built by `.github/workflows/ios.yml` and
`ios-release.yml`) that shows the page from inside the app and turns its list of alarms
into the phone's own notifications (`ios/App/Reminders.swift`). It does not bundle `web/`
as it is: `scripts/ios-bundle.mjs` makes `ios/bundle/web` (not in git), a copy without
what the iPhone app doesn't have, and the app bundles that. Left out is every part of
`index.html`, `style.css`, `app.js` and `lib.js` between these marks:

```
/* ios:cut */ ... /* ios:end */          in scripts and styles
<!-- ios:cut --> ... <!-- ios:end -->    in markup
```

The marks are comments, so the Android app and a browser are not changed by them. Marked
today: the updater and its card, the widget's list, Android's alarm settings and the
question before them, ringing like a call, the Back button message, nudging without end,
what a browser does with no app behind it, and the `ios` flag itself, so the copy has no
platform switch in it. The script stops the build on a mark without its partner, on a
file in `web/` it hasn't been told about, and if any word on its `FORBIDDEN` list is
still in the copy. **Anything new that only the Android app or a browser uses goes
between marks**, and its names on that list.

```
node scripts/ios-bundle.mjs               # make ios/bundle/web and check it (run before xcodegen)
node scripts/ios-bundle.mjs --check DIR   # check a folder, such as the one inside a built app
```

Exact alarms differ by flavor. `github` uses USE_EXACT_ALARM, which needs no asking.
`play` uses SCHEDULE_EXACT_ALARM, because Play keeps USE_EXACT_ALARM for alarm and
calendar apps: Android 14 and later start with it off, the page explains and opens the
setting (`BuildConfig.ASK_EXACT_ALARM`), and without it reminders ring late rather than
not at all.

## Releasing

Commit, push, then push an annotated `v*` tag on its own. Its `- ` lines become
What's new. Actions builds the signed APK and publishes it with `latest.json` to the
public `nudge-releases` repo.
