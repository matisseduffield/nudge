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

Reminders only ring in the Android app. In a browser it's just a list.

## Releasing

Commit, push, then push an annotated `v*` tag on its own. Its `- ` lines become
What's new. Actions builds the signed APK and publishes it with `latest.json` to the
public `nudge-releases` repo.
