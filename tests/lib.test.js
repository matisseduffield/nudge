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
  // Long overdue: it lands on the next date from today, not one in the past.
  assert.equal(L.complete(task({ due: '2026-10-01', repeat: { every: 1, unit: 'day' } }), NOW).due, '2026-11-06');
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
  assert.equal(sums[0].title, '1 task today');
  assert.equal(sums[0].body, 'A');
  assert.deepEqual([...s.map(x => x.at)].sort(), s.map(x => x.at));
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
  assert.equal(L.parseQuick('Leap day 29 feb', new Date(2028, 2, 10), []).due, null);
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
  assert.equal(L.reminderText({ before: 120 }, NOW), '2 hours before');
  assert.equal(L.reminderText({ before: 0 }, NOW), 'At the time');
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
