const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../web/lib.js');

const NOW = new Date(2026, 10, 6, 10, 0);   // Friday 6 Nov 2026, 10am
const lists = [{ id: 'h', name: 'Home' }, { id: 'w', name: 'Work stuff' }];
const q = text => L.parseQuick(text, NOW, lists);
const task = fields => ({ ...L.makeTask({ title: 'T', ...fields }, NOW, {}), ...fields });

test('quick add reads a whole line', () => {
  const t = q('Call mum tomorrow 5pm every week #home !!');
  assert.equal(t.title, 'Call mum');
  assert.equal(t.due, '2026-11-07');
  assert.equal(t.time, '17:00');
  assert.deepEqual(t.repeat, { every: 1, unit: 'week' });
  assert.equal(t.list, 'h');
  assert.equal(t.pri, 2);
});

test('quick add knows days and dates', () => {
  assert.equal(q('Pay rent today').due, '2026-11-06');
  assert.equal(q('Pay rent yesterday').due, '2026-11-05');
  assert.equal(q('Pay rent tmrw').due, '2026-11-07');
  assert.equal(q('Pay rent monday').due, '2026-11-09');
  assert.equal(q('Pay rent on friday').due, '2026-11-13');   // today's a Friday, so the next one
  assert.equal(q('Pay rent next monday').due, '2026-11-16');
  assert.equal(q('Pay rent in 3 days').due, '2026-11-09');
  assert.equal(q('Pay rent in 2 weeks').due, '2026-11-20');
  assert.equal(q('Pay rent next week').due, '2026-11-13');
  assert.equal(q('Pay rent 20 nov').due, '2026-11-20');
  assert.equal(q('Pay rent Dec 25').due, '2026-12-25');
  assert.equal(q('Pay rent 3 jan').due, '2027-01-03');   // already gone this year
  assert.equal(q('Pay rent 14/2').due, '2027-02-14');
  assert.equal(q('Pay rent 14/2').title, 'Pay rent');
});

test('quick add knows times', () => {
  assert.equal(q('Gym 7am').time, '07:00');
  assert.equal(q('Gym at 6:30pm').time, '18:30');
  assert.equal(q('Gym 17:45').time, '17:45');
  assert.equal(q('Gym at 5').time, '17:00');
  assert.equal(q('Gym noon').time, '12:00');
  assert.equal(q('Gym tonight').time, '20:00');
  // A time alone means the next time that clock comes round.
  assert.equal(q('Gym 3pm').due, '2026-11-06');
  assert.equal(q('Gym 8am').due, '2026-11-07');
});

test('quick add knows repeats', () => {
  assert.deepEqual(q('Bins every 2 weeks').repeat, { every: 2, unit: 'week' });
  assert.deepEqual(q('Bins every other day').repeat, { every: 2, unit: 'day' });
  assert.deepEqual(q('Stand up weekdays').repeat, { every: 1, unit: 'weekdays' });
  assert.deepEqual(q('Water plants daily').repeat, { every: 1, unit: 'day' });
  assert.equal(q('Water plants daily').due, '2026-11-06');
  const m = q('Bins every monday');
  assert.deepEqual(m.repeat, { every: 1, unit: 'week' });
  assert.equal(m.due, '2026-11-09');
  assert.equal(m.title, 'Bins');
  assert.equal(q('Rent monthly 31 dec').repeat.dom, 31);
});

test('quick add reads times and dates people actually type', () => {
  const at = text => L.parseQuick(text, new Date(2026, 10, 9, 14, 20), []);   // Mon 9 Nov, 2:20pm
  // "At 3:30" is the afternoon, like "at 3"; never 3:30 in the morning.
  assert.deepEqual([at('Pick up kids at 3:30').due, at('Pick up kids at 3:30').time], ['2026-11-09', '15:30']);
  assert.equal(at('Gym at 7:30 in the morning').time, '07:30');
  // A date before a repeat word.
  const b = at('Mum birthday 14 Feb yearly');
  assert.deepEqual([b.title, b.due, b.repeat.unit], ['Mum birthday', '2027-02-14', 'year']);
  // In so many minutes or hours.
  const o = at('Check oven in 20 min');
  assert.deepEqual([o.title, o.due, o.time], ['Check oven', '2026-11-09', '14:40']);
  assert.deepEqual([at('Call back in 10 hours').due, at('Call back in 10 hours').time], ['2026-11-10', '00:20']);
  // A day of the month.
  const r = at('Pay rent on the 1st every month');
  assert.deepEqual([r.title, r.due, r.repeat.dom], ['Pay rent', '2026-12-01', 1]);
  assert.equal(at('Pay on the 31st').due, '2026-12-31');
});

test('quick add leaves ordinary words alone', () => {
  assert.equal(q('Buy 2 milk').title, 'Buy 2 milk');
  assert.equal(q('Buy 2 milk').due, null);
  assert.equal(q('Read the morningside report').title, 'Read the morningside report');
  assert.equal(q('Fix the sunroof').due, null);
  assert.equal(q('Email Mayor').title, 'Email Mayor');
  assert.equal(q('Email Mayor').due, null);
  assert.equal(q('Wow! great').pri, 0);
});

test('quick add sets a reminder, and an unknown list keeps its name', () => {
  assert.equal(q('Dentist friday 2pm remind me 2 hours before').remind, 120);
  assert.equal(q('Dentist friday 2pm remind me 2 hours before').title, 'Dentist');
  assert.equal(q('Dentist remind 10 min before').remind, 10);
  const t = q('Dentist #health');
  assert.equal(t.list, null);
  assert.equal(t.listName, 'health');
});

test('repeats move on properly', () => {
  assert.equal(L.nextDate('2026-11-06', { every: 1, unit: 'day' }), '2026-11-07');
  assert.equal(L.nextDate('2026-11-06', { every: 2, unit: 'week' }), '2026-11-20');
  assert.equal(L.nextDate('2026-11-06', { every: 1, unit: 'weekdays' }), '2026-11-09');   // Friday to Monday
  // The 31st holds on through short months.
  assert.equal(L.nextDate('2027-01-31', { every: 1, unit: 'month', dom: 31 }), '2027-02-28');
  assert.equal(L.nextDate('2027-02-28', { every: 1, unit: 'month', dom: 31 }), '2027-03-31');
  assert.equal(L.nextDate('2028-02-29', { every: 1, unit: 'year', dom: 29 }), '2029-02-28');
});

test('ticking off finishes a task, or moves a repeating one on', () => {
  const plain = L.complete(task({ due: '2026-11-06' }), NOW);
  assert.equal(plain.done, +NOW);
  const weekly = L.complete(task({ due: '2026-11-06', repeat: { every: 1, unit: 'week' }, subs: [{ id: 's', title: 'a', done: true }], snooze: 5 }), NOW);
  assert.equal(weekly.done, null);
  assert.equal(weekly.due, '2026-11-13');
  assert.equal(weekly.subs[0].done, false);
  assert.equal(weekly.snooze, null);
  // Long overdue: it lands on the next date after today, not one in the past.
  assert.equal(L.complete(task({ due: '2026-10-01', repeat: { every: 1, unit: 'day' } }), NOW).due, '2026-11-07');
  // And a weekly task keeps its own day.
  assert.equal(L.complete(task({ due: '2026-11-02', repeat: { every: 1, unit: 'week' } }), NOW).due, '2026-11-09');
  // Past its end date, it really is done.
  assert.ok(L.complete(task({ due: '2026-11-06', repeat: { every: 1, unit: 'day', until: '2026-11-06' } }), NOW).done);
});

test('a task with several reminders raises each one', () => {
  const t = task({ title: 'Dentist', due: '2026-11-07', time: '14:00', reminders: [{ before: 0 }, { before: 60 }, { before: 1440 }] });
  assert.deepEqual(L.firings(t, NOW).map(f => f.at).sort(), ['2026-11-06T14:00', '2026-11-07T13:00', '2026-11-07T14:00']);
  assert.ok(L.firings(t, NOW).every(f => f.occ === '2026-11-07' && f.title === 'Dentist'));
});

test('reminders in the past are dropped, and a task with no time rings at nine', () => {
  const t = task({ due: '2026-11-06', time: '09:30', reminders: [{ before: 0 }] });
  assert.deepEqual(L.firings(t, NOW), []);
  assert.equal(L.firings(task({ due: '2026-11-07', reminders: [{ before: 0 }] }), NOW)[0].at, '2026-11-07T09:00');
});

test('a repeating task keeps ringing, up to its end date', () => {
  const t = task({ due: '2026-11-07', time: '08:00', repeat: { every: 1, unit: 'day' }, reminders: [{ before: 0 }] });
  const f = L.firings(t, NOW);
  assert.equal(f.length, 60);
  assert.equal(f[1].occ, '2026-11-08');
  const ending = task({ due: '2026-11-07', time: '08:00', repeat: { every: 1, unit: 'day', until: '2026-11-09' }, reminders: [{ before: 0 }] });
  assert.equal(L.firings(ending, NOW).length, 3);
});

test('a custom reminder, a snooze and keep nudging all reach the phone', () => {
  const t = task({ due: '2026-11-08', reminders: [{ at: '2026-11-07T07:15' }], nag: 15, snooze: +new Date(2026, 10, 6, 11, 0) });
  const f = L.firings(t, NOW);
  assert.deepEqual(f.map(x => x.at).sort(), ['2026-11-06T11:00', '2026-11-07T07:15']);
  assert.ok(f.every(x => x.nag === 15));
  // No date at all still rings.
  assert.equal(L.firings(task({ reminders: [{ at: '2026-11-07T07:15' }] }), NOW).length, 1);
});

test('done and deleted tasks raise nothing', () => {
  assert.deepEqual(L.firings(task({ due: '2026-11-07', reminders: [{ before: 0 }], done: 1 }), NOW), []);
  assert.deepEqual(L.firings(task({ due: '2026-11-07', reminders: [{ before: 0 }], deleted: 1 }), NOW), []);
});

test('the phone gets one sorted list, with the morning summary', () => {
  const state = { tasks: [task({ title: 'B', due: '2026-11-08', reminders: [{ before: 0 }] }), task({ title: 'A', due: '2026-11-07', reminders: [{ before: 0 }, { before: 0 }] }), task({ title: 'Old', due: '2026-11-01' })], prefs: { summary: '08:00' }, lists: [] };
  const s = L.schedule(state, NOW);
  const alarms = s.filter(x => !x.summary);
  assert.deepEqual(alarms.map(x => x.title), ['A', 'B']);
  const sums = s.filter(x => x.summary);
  assert.equal(sums[0].at, '2026-11-07T08:00');
  assert.equal(sums[0].title, '2 tasks today');   // Old is still overdue tomorrow
  assert.equal(sums[0].body, 'A, Old');
  assert.deepEqual([...s.map(x => x.at)].sort(), s.map(x => x.at));
});

test('each alarm carries the 24-hour setting, for the clock on the alarm page', () => {
  const tasks = [task({ due: '2026-11-07', time: '15:00', reminders: [{ before: 0 }] }), task({ due: '2026-11-07', reminders: [{ before: 0 }] })];
  const at = use24 => L.schedule({ tasks, prefs: { use24 }, lists: [] }, NOW).filter(x => !x.summary);
  assert.deepEqual(at(true).map(x => x.use24), [true, true]);   // untimed too: its text has no time to go by
  assert.deepEqual(at(false).map(x => x.use24), [false, false]);
  assert.equal(at(true).find(x => x.body.includes(':')).body, 'Today, 15:00');   // written for when it rings
});

test('what was tapped on a notification lands on the task', () => {
  const a = task({ id: 'a', due: '2026-11-06' });
  const b = task({ id: 'b', due: '2026-11-06', repeat: { every: 1, unit: 'week' } });
  const c = task({ id: 'c', due: '2026-11-07' });
  const out = L.applyActions({ tasks: [a, b, c] }, [{ type: 'done', task: 'a', when: +NOW }, { type: 'done', task: 'b', occ: '2026-11-06', when: +NOW }, { type: 'snooze', task: 'c', until: 123 }], NOW);
  assert.ok(out.tasks[0].done);
  assert.equal(out.tasks[1].due, '2026-11-13');
  assert.equal(out.tasks[2].snooze, 123);
  // An old occurrence tapped late doesn't skip the one after it.
  const again = L.applyActions(out, [{ type: 'done', task: 'b', occ: '2026-11-06', when: +NOW }], NOW);
  assert.equal(again.tasks[1].due, '2026-11-13');
});

test('today and upcoming sort things out', () => {
  const tasks = [
    task({ title: 'late', due: '2026-11-01' }), task({ title: 'evening', due: '2026-11-06', time: '18:00' }), task({ title: 'morning', due: '2026-11-06', time: '08:00' }),
    task({ title: 'next', due: '2026-11-09' }), task({ title: 'whenever' }), task({ title: 'gone', due: '2026-11-06', done: 1 }),
  ];
  const t = L.today(tasks, NOW);
  assert.deepEqual(t.overdue.map(x => x.title), ['late']);
  assert.deepEqual(t.today.map(x => x.title), ['morning', 'evening']);
  const u = L.upcoming(tasks, NOW);
  assert.deepEqual(u.days.map(d => d.date), ['2026-11-09']);
  assert.deepEqual(u.someday.map(x => x.title), ['whenever']);
  assert.deepEqual(L.search(tasks, 'NEX').map(x => x.title), ['next']);
  assert.deepEqual(L.search(tasks, '  '), []);
});

test('quick add leaves everyday phrases alone', () => {
  const same = ['Fix sat nav', 'Buy sun cream', 'Pack sat-nav', 'Look at 3 quotes', 'Meet at 10 Downing Street', 'Read John 3:16', 'Finish 3/4 of essay', '24/7 support ticket',
    'Write weekly report', 'Daily standup notes', 'Morning walk', "Check today's rota", 'Long March 5 launch', 'Turn the heating on', 'Put kettle on', 'On call rota', 'By the sea walk'];
  for (const text of same) {
    const t = q(text);
    assert.equal(t.title, text);
    assert.deepEqual([t.due, t.time, t.repeat], [null, null, null], text);
  }
  assert.equal(q('Fix issue #12').title, 'Fix issue #12');
  assert.equal(q('Fix issue #12').listName, null);
  assert.equal(q('Gym sat').due, '2026-11-07');
  assert.equal(q('Gym on sat').due, '2026-11-07');
  assert.equal(q('Water plants daily 8am').repeat.unit, 'day');
});

test('part of the day settles the hour', () => {
  const late = new Date(2026, 10, 6, 19, 0);
  const p = text => L.parseQuick(text, late, lists);
  assert.deepEqual([p('Call mum tonight at 9').time, p('Call mum tonight at 9').due], ['21:00', '2026-11-06']);
  assert.equal(p('Dinner at 8 in the evening').time, '20:00');
  assert.equal(p('Dinner at 8 in the evening').title, 'Dinner');
  assert.equal(p('Gym in the morning').time, '09:00');
  assert.equal(p('Gym tomorrow at 7 in the morning').time, '07:00');
});

test('quick add handles the awkward dates', () => {
  const saturday = new Date(2026, 10, 7, 10, 0);
  assert.equal(L.parseQuick('Standup every weekday', saturday, []).due, '2026-11-09');
  // 29 Feb waits for the next leap year, and a date that never comes stays in the title.
  const leap = L.parseQuick('Leap day 29 feb', new Date(2028, 2, 10), []);
  assert.deepEqual([leap.due, leap.title], ['2032-02-29', 'Leap day']);
  assert.equal(q('Birthday 29 feb').due, '2028-02-29');
  assert.deepEqual(q('Birthday 29 feb yearly').repeat, { every: 1, unit: 'year', dom: 29 });
  assert.equal(L.parseQuick('Leap day 29 feb', new Date(2028, 1, 29, 8, 0), []).due, '2028-02-29');
  assert.deepEqual([q('Nothing 30 feb').due, q('Nothing 30 feb').title], [null, 'Nothing 30 feb']);
  assert.equal(q('Dentist 14 feb').due, '2027-02-14');
});

test('a reminder always has a date to count back from', () => {
  const t = L.makeTask({ title: 'Buy milk', remind: 60 }, NOW, {});
  assert.equal(t.due, '2026-11-06');
});

test('Done on a later notification still counts, and an older one does not', () => {
  const daily = task({ id: 'd', due: '2026-11-02', time: '09:00', repeat: { every: 1, unit: 'day' } });
  const out = L.applyActions({ tasks: [daily] }, [{ type: 'done', task: 'd', occ: '2026-11-03', when: +new Date(2026, 10, 3, 9, 5) }], NOW);
  assert.equal(out.tasks[0].due, '2026-11-04');
  const old = L.applyActions(out, [{ type: 'done', task: 'd', occ: '2026-11-02', when: +NOW }], NOW);
  assert.equal(old.tasks[0].due, '2026-11-04');
  // A snooze from an old date doesn't ring on the new one.
  assert.equal(L.applyActions(out, [{ type: 'snooze', task: 'd', occ: '2026-11-02', until: 5 }], NOW).tasks[0].snooze, null);
});

test('a long-ignored repeating task still rings', () => {
  const t = task({ due: '2026-09-01', time: '09:00', repeat: { every: 1, unit: 'day' }, reminders: [{ before: 0 }] });
  const f = L.firings(t, NOW);
  assert.equal(f.length, 59);
  assert.equal(f[0].at, '2026-11-07T09:00');
});

test('the phone says so before its plan runs out', () => {
  const t = task({ due: '2026-11-07', time: '09:00', repeat: { every: 1, unit: 'day' }, reminders: [{ before: 0 }] });
  const s = L.schedule({ tasks: [t], prefs: {}, lists: [] }, NOW);
  const last = s[s.length - 1];
  assert.equal(last.id, 'keep-going');
  assert.equal(last.title, 'Open Nudge');
  assert.ok(last.at > s[s.length - 2].at);
  // A repeat with an end date just ends.
  const ending = task({ due: '2026-11-07', time: '09:00', repeat: { every: 1, unit: 'day', until: '2026-11-09' }, reminders: [{ before: 0 }] });
  assert.ok(!L.schedule({ tasks: [ending], prefs: {}, lists: [] }, NOW).some(x => x.id === 'keep-going'));
});

test('a notification reads right on the day it rings', () => {
  const t = task({ due: '2026-11-07', time: '09:00', reminders: [{ before: 0 }, { before: 1440 }] });
  const f = L.firings(t, NOW);
  assert.equal(f.find(x => x.at === '2026-11-07T09:00').body, 'Today, 9am');
  assert.equal(f.find(x => x.at === '2026-11-06T09:00') , undefined);
  const later = task({ due: '2026-11-09', time: '14:00', reminders: [{ before: 1440 }] });
  assert.equal(L.firings(later, NOW)[0].body, 'Tomorrow, 2pm');
  assert.equal(L.firings(later, NOW, 60, true)[0].body, 'Tomorrow, 14:00');
});

test('a day before keeps its clock time', () => {
  const t = task({ due: '2027-10-03', time: '09:00', reminders: [{ before: 1440 }, { before: 10080 }] });
  assert.deepEqual(L.firings(t, NOW).map(f => f.at).sort(), ['2027-09-26T09:00', '2027-10-02T09:00']);
});

test('a repeat can fall on certain days', () => {
  const r = { every: 1, unit: 'days', days: [1, 3, 5] };
  assert.equal(L.nextDate('2026-11-06', r), '2026-11-09');   // Friday to Monday
  assert.equal(L.nextDate('2026-11-09', r), '2026-11-11');
  assert.equal(L.repeatText({ ...r, days: [5, 0, 1] }), 'Mon, Fri, Sun');
  assert.equal(L.fitToDays('2026-11-07', r), '2026-11-09');
  assert.equal(L.fitToDays('2026-11-06', r), '2026-11-06');
  const t = q('Gym every mon, wed and fri 7am');
  assert.equal(t.title, 'Gym');
  assert.deepEqual(t.repeat, { every: 1, unit: 'days', days: [1, 3, 5] });
  assert.equal(t.due, '2026-11-06');
  assert.equal(q('Bins every tue and thu').due, '2026-11-10');
  assert.equal(q('Gym every mon and wed tomorrow').due, '2026-11-09');   // tomorrow's a Saturday
  assert.equal(L.complete(task({ due: '2026-11-06', repeat: r }), NOW).due, '2026-11-09');
  assert.deepEqual(L.cleanState({ tasks: [{ id: 'a', title: 'x', due: '2026-11-06', repeat: r }] }).tasks[0].repeat, r);
});

test('overdue tasks can all move to today', () => {
  const tasks = [task({ title: 'a', due: '2026-11-01' }), task({ title: 'b', due: '2026-11-09' }), task({ title: 'c', due: '2026-11-01', done: 1 }), task({ title: 'bins', due: '2026-11-02', repeat: { every: 1, unit: 'week' } })];
  const moved = L.moveOverdue(tasks, NOW);
  // A weekly task keeps its own day.
  assert.deepEqual(moved.map(t => t.due), ['2026-11-06', '2026-11-09', '2026-11-01', '2026-11-02']);
  assert.ok(L.canMove(tasks[0], NOW));
  assert.ok(!L.canMove(tasks[3], NOW));
});

test('done today, list order and old deletions', () => {
  const tasks = [task({ title: 'today', done: +NOW }), task({ title: 'old', done: +NOW - 3 * 864e5 }), task({ title: 'gone', done: +NOW, deleted: +NOW })];
  assert.deepEqual(L.doneToday(tasks, NOW).map(t => t.title), ['today']);
  const list = [task({ title: 'new', due: '2026-11-07' }), task({ title: 'second', order: 2 }), task({ title: 'first', order: 1 })];
  assert.deepEqual(L.listOrder(list).map(t => t.title), ['first', 'second', 'new']);
  const state = { tasks: [task({ title: 'keep', deleted: +NOW - 864e5 }), task({ title: 'purge', deleted: +NOW - 31 * 864e5 }), task({ title: 'open' })] };
  assert.deepEqual(L.tidy(state, +NOW).tasks.map(t => t.title), ['keep', 'open']);
});

test('an urgent task rings like a call and keeps coming back', () => {
  const t = task({ due: '2026-11-07', time: '09:00', reminders: [{ before: 0 }], loud: true });
  const f = L.firings(t, NOW)[0];
  assert.equal(f.loud, true);
  assert.equal(f.nag, 5);
  assert.equal(L.firings({ ...t, nag: 15 }, NOW)[0].nag, 15);
  assert.equal(L.firings({ ...t, loud: false }, NOW)[0].loud, false);
  assert.equal(L.firings({ ...t, loud: false }, NOW)[0].nag, 0);
  assert.equal(L.cleanState({ tasks: [{ id: 'a', title: 'x', loud: 'yes' }] }).tasks[0].loud, false);
});

test('three exclamation marks make a task ring like a call', () => {
  const p = q('Take the pills 8pm !!!');
  assert.equal(p.title, 'Take the pills');
  assert.deepEqual([p.loud, p.pri], [true, 2]);
  assert.equal(q('Take the pills 8pm !!').loud, false);
  const early = new Date(2026, 10, 6, 7, 0);
  const made = L.makeTask({ title: 'Now', loud: true }, early, { defaultReminder: null });
  assert.equal(made.loud, true);
  assert.equal(made.due, '2026-11-06');
  assert.deepEqual(made.reminders, [{ before: 0 }]);
});

test('an urgent task always has something left to ring', () => {
  // Added at 3pm with no time: nine o'clock has gone, so it rings in an hour.
  const late = new Date(2026, 10, 6, 15, 0);
  const made = L.makeTask({ title: 'Pills', loud: true }, late, {});
  assert.equal(L.firings(made, late).length, 1);
  assert.equal(L.firings(made, late)[0].at, '2026-11-06T16:00');
  // One with a reminder still to come is left alone.
  const fine = task({ due: '2026-11-07', reminders: [{ before: 0 }], loud: true });
  assert.equal(L.ensureRing(fine, NOW), fine);
  assert.deepEqual(L.ensureRing(task({ loud: false }), NOW).reminders, []);
});

test('dates and times read naturally', () => {
  assert.equal(L.dayText('2026-11-06', NOW), 'Today');
  assert.equal(L.dayText('2026-11-07', NOW), 'Tomorrow');
  assert.equal(L.dayText('2026-11-05', NOW), 'Yesterday');
  assert.equal(L.dayText('2026-11-10', NOW), 'Tuesday');
  assert.equal(L.dayText('2026-11-20', NOW), '20 Nov');
  assert.equal(L.dayText('2027-01-03', NOW), '3 Jan 2027');
  assert.equal(L.timeText('17:30'), '5:30pm');
  assert.equal(L.timeText('09:00'), '9am');
  assert.equal(L.timeText('00:15'), '12:15am');
  assert.equal(L.timeText('17:30', true), '17:30');
  assert.equal(L.repeatText({ every: 2, unit: 'week' }), 'Every 2 weeks');
  assert.equal(L.reminderText({ before: 120 }, NOW, false, '17:00'), '2 hours before');
  assert.equal(L.reminderText({ before: 0 }, NOW, false, '17:00'), 'At the time');
});

test('a damaged save still opens', () => {
  const s = L.cleanState({ lists: [{}], tasks: [null, { id: 'a', title: 'x' }, { title: 'no id' }], prefs: { use24: true } });
  assert.equal(s.lists.length, 0);
  assert.equal(s.tasks.length, 1);
  assert.deepEqual(s.tasks[0].reminders, []);
  assert.equal(s.prefs.use24, true);
  assert.deepEqual(L.cleanState(null).tasks, []);
  const broken = L.cleanState({ tasks: [{ id: 'b', title: 'x', due: 5, notes: null, subs: [null], reminders: [null, { before: 5 }], repeat: { unit: 'fortnight' } }] }).tasks[0];
  assert.deepEqual([broken.due, broken.notes, broken.subs, broken.reminders, broken.repeat], [null, '', [], [{ before: 5 }], null]);
  assert.doesNotThrow(() => L.schedule({ tasks: [broken], prefs: {} }, NOW));
});

const ON = { notifications: true, exact: true, overlay: true, fullScreen: true };

test('a GitHub build warns just as it always has', () => {
  assert.equal(L.reminderWarning(null, false), null);
  assert.equal(L.reminderWarning(ON, false), null);
  assert.equal(L.reminderWarning({ ...ON, exact: false }, false), 'Reminders are switched off. Tap to fix.');
  assert.equal(L.reminderWarning({ ...ON, notifications: false }, false), 'Reminders are switched off. Tap to fix.');
});

test('a Play build says late when reminders are late, and off when they are off', () => {
  assert.equal(L.reminderWarning(ON, true), null);
  assert.equal(L.reminderWarning({ ...ON, exact: false }, true), 'Reminders may ring late. Tap to fix.');
  assert.equal(L.reminderWarning({ ...ON, notifications: false }, true), 'Reminders are switched off. Tap to fix.');
  assert.equal(L.reminderWarning({ ...ON, notifications: false, exact: false }, true), 'Reminders are switched off. Tap to fix.');
});

test('exact alarms are asked for once, and only when they matter', () => {
  const late = { ...ON, exact: false };
  assert.equal(L.shouldAskExact(late, true, true, null), true);
  assert.equal(L.shouldAskExact(late, true, true, true), false, 'already asked');
  assert.equal(L.shouldAskExact(late, true, false, null), false, 'nothing to ring');
  assert.equal(L.shouldAskExact(late, false, true, null), false, 'GitHub build');
  assert.equal(L.shouldAskExact(ON, true, true, null), false, 'already allowed');
  assert.equal(L.shouldAskExact({ ...late, notifications: false }, true, true, null), false, 'notifications come first');
  assert.equal(L.shouldAskExact(null, true, true, null), false, 'the phone has not reported yet');
});

test('an urgent task says what is stopping it, in order', () => {
  assert.equal(L.loudBlocker(null, true), null);
  assert.equal(L.loudBlocker(ON, true), null);
  assert.equal(L.loudBlocker({ ...ON, exact: false, overlay: false }, true).what, 'alarms');
  assert.equal(L.loudBlocker({ ...ON, overlay: false, fullScreen: false }, true).what, 'overlay');
  assert.equal(L.loudBlocker({ ...ON, fullScreen: false }, true).what, 'fullscreen');
});

test('a test reminder only promises a minute if it can keep to it', () => {
  assert.equal(L.exactBlocker({ ...ON, exact: false }, true).what, 'alarms');
  assert.equal(L.exactBlocker(ON, true), null);
  assert.equal(L.exactBlocker({ ...ON, exact: false }, false), null, 'GitHub build');
  assert.equal(L.exactBlocker(null, true), null);
});

test('a GitHub build never asks an urgent task about exact alarms', () => {
  assert.equal(L.loudBlocker({ ...ON, exact: false }, false), null);
  assert.equal(L.loudBlocker({ ...ON, exact: false, overlay: false }, false).what, 'overlay');
});

test('a morning summary set days ahead counts what will be overdue by then', () => {
  // Planned now, rung later: if the app isn't opened in between, it should say what Today will show.
  const state = { tasks: [task({ title: 'Late', due: '2026-11-04' }), task({ title: 'Weekly', due: '2026-11-06', repeat: { every: 1, unit: 'week' } })], prefs: { summary: '08:00' }, lists: [] };
  const sums = L.schedule(state, NOW).filter(x => x.summary && x.id.startsWith('summary|'));
  assert.equal(sums[0].at, '2026-11-07T08:00');
  assert.equal(sums[0].body, 'Late, Weekly');
  assert.equal(sums.length, 29);   // every day from tomorrow, none skipped for want of a new due date
  // Ticked off, it goes from the plan.
  const done = { ...state, tasks: state.tasks.map(t => ({ ...t, done: +NOW })) };
  assert.equal(L.schedule(done, NOW).filter(x => x.summary && x.id.startsWith('summary|')).length, 0);
});

test('a weekday repeat never starts on a weekend', () => {
  const r = { every: 1, unit: 'weekdays' };
  assert.equal(L.fitToDays('2026-11-07', r), '2026-11-09');   // Saturday to Monday
  assert.equal(L.fitToDays('2026-11-08', r), '2026-11-09');   // Sunday to Monday
  assert.equal(L.fitToDays('2026-11-06', r), '2026-11-06');
  assert.equal(L.fitToDays('2026-11-07', { every: 1, unit: 'week' }), '2026-11-07');   // other repeats keep their day
  assert.equal(L.fitToDays('2026-11-07', null), '2026-11-07');
  assert.equal(q('Standup weekdays').due, '2026-11-06');
  assert.equal(q('Standup tomorrow every weekday').due, '2026-11-09');
});

test('a picked reminder time follows the 24-hour setting', () => {
  assert.equal(L.reminderText({ at: '2026-11-07T17:30' }, NOW), 'Tomorrow, 5:30pm');
  assert.equal(L.reminderText({ at: '2026-11-07T17:30' }, NOW, true), 'Tomorrow, 17:30');
});

test('the widget gets a week of dated tasks, so it can move on to a new day by itself', () => {
  const tasks = [
    task({ id: 'late', title: 'Late', due: '2026-11-04' }),
    task({ id: 'now', title: 'Now', due: '2026-11-06', time: '09:00' }),
    task({ id: 'week', title: 'Week', due: '2026-11-13' }),
    task({ id: 'far', title: 'Far', due: '2026-11-14' }),
    task({ id: 'none', title: 'No date' }),
    task({ id: 'done', title: 'Done', due: '2026-11-06', done: +NOW }),
  ];
  const items = L.widgetItems(tasks, NOW);
  assert.deepEqual(items.map(x => x.id), ['late', 'now', 'week']);
  assert.deepEqual(items[1], { id: 'now', title: 'Now', due: '2026-11-06' });
});

test('an urgent task nudges every 5 minutes unless it says otherwise', () => {
  assert.equal(L.nagOf(task({ loud: true })), 5);
  assert.equal(L.nagOf(task({ loud: true, nag: 15 })), 15);
  assert.equal(L.nagOf(task({})), 0);
  assert.equal(L.nagOf(task({ nag: 30 })), 30);
});

test('a repeating task gives the widget each of its dates that week', () => {
  const daily = task({ id: 'd', title: 'Pills', due: '2026-11-05', repeat: { every: 1, unit: 'day' } });
  const weekly = task({ id: 'w', title: 'Bins', due: '2026-11-10', repeat: { every: 1, unit: 'week' } });
  const items = L.widgetItems([daily, weekly], NOW);
  // Overdue since yesterday, then every day from today to a week out.
  assert.deepEqual(items.filter(x => x.id === 'd').map(x => x.due),
    ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(items.filter(x => x.id === 'w').map(x => x.due), ['2026-11-10']);
  assert.ok(items.every(x => x.repeat === true));
  assert.deepEqual(items.map(x => x.due), [...items.map(x => x.due)].sort());
});

test('switching on ring like a call after its time rings in 5 minutes, a new task in an hour', () => {
  const late = task({ due: '2026-11-06', time: '09:00', loud: true, reminders: [{ before: 0 }] });
  assert.deepEqual(L.ensureRing(late, NOW, L.LOUD_NAG).reminders.at(-1), { at: '2026-11-06T10:05' });
  assert.deepEqual(L.ensureRing(late, NOW).reminders.at(-1), { at: '2026-11-06T11:00' });
});

test('on the 24-hour clock, "at 5:30" means 05:30', () => {
  const at = (text, use24) => L.parseQuick(text, new Date(2026, 10, 9, 14, 20), [], { use24 });
  assert.equal(at('Run at 5:30').time, '17:30');
  assert.equal(at('Run at 5:30', true).time, '05:30');
  assert.equal(at('Run at 5:30', true).due, '2026-11-10');   // that clock time next comes round tomorrow
  assert.equal(at('Run at 5', true).time, '17:00');           // a bare hour still means the afternoon
});

test('"on the 2nd floor" and "on the 4th of July" are not dates', () => {
  assert.deepEqual([q('Meet on the 2nd floor').title, q('Meet on the 2nd floor').due], ['Meet on the 2nd floor', null]);
  assert.deepEqual([q('Party on the 4th of July').title, q('Party on the 4th of July').due], ['Party on the 4th of July', null]);
  assert.equal(q('Pay on the 2nd').due, '2026-12-02');
});

test('a change to the date, time or reminders drops a snooze', () => {
  const t = task({ due: '2026-11-06', time: '09:00', reminders: [{ before: 0 }], snooze: +new Date(2026, 10, 6, 11, 0) });
  assert.equal(L.edited(t, { time: '15:00' }).snooze, null);
  assert.equal(L.edited(t, { due: '2026-11-07' }).snooze, null);
  assert.equal(L.edited(t, { reminders: [] }).snooze, null);
  // Nothing about when it rings changed, so the snooze still stands.
  assert.equal(L.edited(t, { title: 'New name', time: '09:00' }).snooze, t.snooze);
  assert.equal(L.edited(t, { reminders: [{ before: 0 }] }).snooze, t.snooze);
  // So the phone isn't left ringing the old snooze.
  const moved = L.edited(t, { time: '15:00' });
  assert.deepEqual(L.firings(moved, NOW).map(f => f.at), ['2026-11-06T15:00']);
  assert.deepEqual(L.firings(L.edited(t, { reminders: [] }), NOW), []);
});

test('a reminder on a task with no time says when it rings', () => {
  assert.equal(L.reminderText({ before: 0 }, NOW), '9am');
  assert.equal(L.reminderText({ before: 60 }, NOW), '8am');
  assert.equal(L.reminderText({ before: 30 }, NOW), '8:30am');
  assert.equal(L.reminderText({ before: 60 }, NOW, true), '08:00');
  assert.equal(L.reminderText({ before: 1440 }, NOW), '1 day before, 9am');
  assert.equal(L.reminderText({ before: 10080 }, NOW), '7 days before, 9am');
  assert.equal(L.reminderText({ before: 720 }, NOW), '1 day before, 9pm');
  // And it is what the phone is given.
  const t = task({ due: '2026-11-07', reminders: [{ before: 60 }, { before: 720 }] });
  assert.deepEqual(L.firings(t, NOW).map(f => f.at), ['2026-11-07T08:00', '2026-11-06T21:00']);
  // With a time, it counts back from it.
  assert.equal(L.reminderText({ before: 60 }, NOW, false, '17:00'), '1 hour before');
});

test('search shows what is still to do first, then done, newest first', () => {
  const tasks = [
    task({ title: 'call old', due: '2026-10-01', done: 100 }), task({ title: 'call later', due: '2026-11-20' }),
    task({ title: 'call recent', due: '2026-11-01', done: 300 }), task({ title: 'call soon', due: '2026-11-07' }),
    task({ title: 'call nodate' }), task({ title: 'call gone', deleted: 5 }),
  ];
  assert.deepEqual(L.search(tasks, 'call').map(x => x.title), ['call soon', 'call later', 'call nodate', 'call recent', 'call old']);
});

test('a morning summary says which task dates it counts', () => {
  const state = {
    tasks: [
      task({ id: 'late', title: 'Late', due: '2026-11-04' }),
      task({ id: 'daily', title: 'Daily', due: '2026-11-06', repeat: { every: 1, unit: 'day' } }),
      task({ id: 'weekly', title: 'Weekly', due: '2026-11-02', repeat: { every: 1, unit: 'week' } }),
    ],
    prefs: { summary: '08:00' }, lists: [],
  };
  const sums = L.schedule(state, NOW).filter(x => x.id.startsWith('summary|'));
  const sum = sums.find(x => x.id === 'summary|2026-11-07');
  // A repeating task stops counting once ticked up to its last date on or before the day.
  // A one-off task is finished by any Done, so it carries no due date.
  assert.deepEqual(sum.items, [['late', '2026-11-04', 'Late', ''], ['daily', '2026-11-07', 'Daily', '2026-11-06'], ['weekly', '2026-11-02', 'Weekly', '2026-11-02']]);
  assert.equal(sum.title, '3 tasks today');
  assert.equal(sum.more, 0);
  // Weekly on Mondays: from Monday the 9th, it's the 9th it has to be ticked up to.
  assert.deepEqual(sums.find(x => x.id === 'summary|2026-11-12').items[2], ['weekly', '2026-11-09', 'Weekly', '2026-11-02']);
  assert.deepEqual(L.summaryText(['A']), { title: '1 task today', body: 'A' });
  assert.deepEqual(L.summaryText(['A', 'B', 'C', 'D']), { title: '4 tasks today', body: 'A, B, C' });
});

test('a morning summary lists only its first few tasks for the phone, and counts the rest', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => task({ id: `t${i}`, title: `T${i}`, due: '2026-11-01' }));
  const sum = L.schedule({ tasks, prefs: { summary: '08:00' }, lists: [] }, NOW).find(x => x.id === 'summary|2026-11-07');
  assert.equal(sum.items.length, 8);
  assert.equal(sum.more, 4);
  assert.equal(sum.title, '12 tasks today');
  assert.equal(sum.body, 'T0, T1, T2');
});

test('moving overdue tasks to today drops their snoozes', () => {
  const t = task({ due: '2026-11-02', snooze: +new Date(2026, 10, 6, 11, 0) });
  assert.equal(L.moveOverdue([t], NOW)[0].snooze, null);
});

// Tue 10 Nov 2026, 2:30pm
const parsed = (text, now = new Date(2026, 10, 10, 14, 30)) => { const r = L.parseQuick(text, now, []); return [r.title, r.due, r.time]; };

test('midnight tonight is the start of tomorrow, not noon', () => {
  assert.deepEqual(parsed('Call mum tonight at midnight'), ['Call mum', '2026-11-11', '00:00']);
  assert.deepEqual(parsed('Call 12am tonight'), ['Call', '2026-11-11', '00:00']);
  assert.deepEqual(parsed('Call tonight 12:30am'), ['Call', '2026-11-11', '00:30']);
  assert.deepEqual(parsed('Call tonight at 12'), ['Call', '2026-11-11', '00:00']);
  // Without "tonight", twelve and midnight read as they always did.
  assert.deepEqual(parsed('Lunch at noon'), ['Lunch', '2026-11-11', '12:00']);
  assert.deepEqual(parsed('Call tonight at 9'), ['Call', '2026-11-10', '21:00']);
  assert.deepEqual(parsed('Party at midnight'), ['Party', '2026-11-11', '00:00']);
});

test('a bare time counts right after a part of the day', () => {
  assert.deepEqual(parsed('Movie tonight 7:30'), ['Movie', '2026-11-10', '19:30']);
  assert.deepEqual(parsed('Run tomorrow morning 8:15'), ['Run', '2026-11-11', '08:15']);
  assert.deepEqual(parsed('Walk this evening 7:30'), ['Walk', '2026-11-10', '19:30']);
  // Anywhere else it's still part of the title.
  assert.deepEqual(parsed('Read John 3:16'), ['Read John 3:16', null, null]);
  assert.deepEqual(parsed('Read John 3:16 tonight'), ['Read John 3:16', '2026-11-10', '20:00']);
  assert.deepEqual(parsed('Good morning 7:30 crew'), ['Good morning 7:30 crew', null, null]);
});

test('tonight for a time already gone leaves the time out', () => {
  const late = new Date(2026, 10, 10, 23, 50);
  assert.deepEqual(parsed('Bins tonight', late), ['Bins', '2026-11-10', null]);
  assert.deepEqual(parsed('Movie tonight at 7', late), ['Movie', '2026-11-10', null]);
  assert.deepEqual(parsed('Call tonight at midnight', late), ['Call', '2026-11-11', '00:00']);
  assert.deepEqual(parsed('Bins tonight'), ['Bins', '2026-11-10', '20:00']);
});

test('every morning or night repeats daily', () => {
  const r = text => { const p = L.parseQuick(text, new Date(2026, 10, 10, 14, 30), []); return [p.title, p.time, p.repeat]; };
  assert.deepEqual(r('Meds every morning'), ['Meds', '09:00', { every: 1, unit: 'day' }]);
  assert.deepEqual(r('Meds every afternoon'), ['Meds', '15:00', { every: 1, unit: 'day' }]);
  assert.deepEqual(r('Meds every evening'), ['Meds', '18:00', { every: 1, unit: 'day' }]);
  assert.deepEqual(r('Feed cat every night'), ['Feed cat', '20:00', { every: 1, unit: 'day' }]);
  assert.deepEqual(r('Feed cat every night 9pm'), ['Feed cat', '21:00', { every: 1, unit: 'day' }]);
  assert.deepEqual(r('Shift mon-fri 9am'), ['Shift', '09:00', { every: 1, unit: 'weekdays' }]);
  assert.deepEqual(r('Shift every mon-fri'), ['Shift', null, { every: 1, unit: 'weekdays' }]);
  // In the middle of a title the words stay.
  assert.deepEqual(r('Every morning routine checklist'), ['Every morning routine checklist', null, null]);
  assert.deepEqual(r('Every night counts poster'), ['Every night counts poster', null, null]);
  assert.deepEqual(r('Email mon-fri schedule to Bob'), ['Email mon-fri schedule to Bob', null, null]);
});

test('night, this evening and in a week are read', () => {
  assert.deepEqual(parsed('Call Bob tomorrow night'), ['Call Bob', '2026-11-11', '20:00']);
  assert.deepEqual(parsed('Drinks friday night'), ['Drinks', '2026-11-13', '20:00']);
  assert.deepEqual(parsed('Drinks friday night at 9'), ['Drinks', '2026-11-13', '21:00']);
  assert.deepEqual(parsed('Call Bob this evening'), ['Call Bob', '2026-11-10', '18:00']);
  assert.deepEqual(parsed('Call Bob this afternoon'), ['Call Bob', '2026-11-10', '15:00']);
  assert.deepEqual(parsed('Reply in a week'), ['Reply', '2026-11-17', null]);
  assert.deepEqual(parsed('Reply in a month'), ['Reply', '2026-12-10', null]);
  assert.deepEqual(parsed('Reply in an hour'), ['Reply', '2026-11-10', '15:30']);
  // Titles that only happen to hold the words keep them.
  const plain = [
    'Buy night cream', 'Watch this is us', 'Date night ideas', 'Plan movie night', 'Date night',
    'Night shift roster', 'Read a week in winter', 'Book in a week off', 'Fix this bug',
    'Buy this evening dress', 'Read this morning news', 'Stay the night at mums', 'Book a table',
    'Good morning email',
  ];
  for (const title of plain) assert.deepEqual(parsed(title), [title, null, null]);
});

test('a snooze rings on the minute and is not sent again once it has', () => {
  const until = +new Date(2026, 10, 6, 10, 17, 23);
  const t = task({ due: '2026-11-06', reminders: [], snooze: until });
  assert.deepEqual(L.firings(t, new Date(2026, 10, 6, 10, 16, 59)).map(f => f.at), ['2026-11-06T10:17']);
  assert.deepEqual(L.firings(t, new Date(2026, 10, 6, 10, 17, 0)), []);
  assert.deepEqual(L.firings(t, new Date(2026, 10, 6, 10, 17, 10)), []);
});

test('a damaged repeat cannot hang the app', () => {
  const fix = repeat => L.cleanState({ tasks: [{ id: 'a', title: 'x', due: '2026-11-06', repeat }] }).tasks[0];
  assert.deepEqual(fix({ every: -2, unit: 'day' }).repeat, { every: 1, unit: 'day' });
  assert.deepEqual(fix({ every: 2.7, unit: 'week' }).repeat, { every: 2, unit: 'week' });
  assert.deepEqual(fix({ every: 'x', unit: 'month', dom: -4 }).repeat, { every: 1, unit: 'month' });
  assert.deepEqual(fix({ every: 1, unit: 'days', days: [9, 'mon', 3, 3, 1.5] }).repeat, { every: 1, unit: 'days', days: [3] });
  assert.deepEqual(fix({ every: 1, unit: 'days', days: [9, 'mon'] }).repeat, { every: 1, unit: 'week' });
  assert.deepEqual(fix({ every: 1, unit: 'days' }).repeat, { every: 1, unit: 'week' });
  const whole = { every: 3, unit: 'year', dom: 29, until: '2030-01-01' };
  assert.deepEqual(fix(whole).repeat, whole);
  assert.equal(L.complete(fix({ every: -2, unit: 'day' }), NOW).due, '2026-11-07');
  const bad = [fix({ every: 1, unit: 'days', days: [9] }), fix({ every: -1, unit: 'week' })];
  assert.doesNotThrow(() => L.schedule({ tasks: bad, prefs: {} }, NOW));
});
