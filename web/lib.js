// Nudge's pure logic: dates, repeats, quick add, and working out when reminders
// fire. No DOM, so it runs in the page and under `node --test`.
//
// The app hands the phone a plain list of alarms worked out here, so the Android
// side never needs to understand tasks. An alarm carries the occurrence it belongs
// to, which is how a Done tapped on a notification finds its way back.
(function (root) {
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / DAY);
  const NO_TIME = '09:00';   // when a task with a date and no time rings
  const atTime = (day, time) => { const d = parseDay(day); const [h, m] = (time || NO_TIME).split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
  const local = d => `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const NAMES = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  WEEKDAYS.forEach((w, i) => { NAMES[w] = i; });
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY = Object.keys(NAMES).sort((a, b) => b.length - a.length).join('|');
  const LONG_DAY = WEEKDAYS.join('|');
  const SHORT_DAY = Object.keys(NAMES).filter(n => !WEEKDAYS.includes(n)).sort((a, b) => b.length - a.length).join('|');
  const END = '(?=\\s*$)';            // at the end of the line
  const WHOLE = "(?![-'’/\\w])";      // a whole word, so today's and sat-nav don't count
  const MONTH = [...MONTHS, ...MONTHS.map(m => m.slice(0, 3)), 'sept'].sort((a, b) => b.length - a.length).join('|');
  const monthOf = m => MONTHS.findIndex(x => x.startsWith(m.slice(0, 3)));

  // The next date a weekday falls on, today not included.
  function nextWeekday(from, day) {
    const d = parseDay(from);
    return addDays(from, ((day - d.getDay() + 7) % 7) || 7);
  }

  // ---- repeats ----
  // { every: n, unit: 'day'|'week'|'month'|'year'|'weekdays'|'days', dom: day of the month, days: [weekday numbers], until: day }
  function addMonths(day, n, dom) {
    const d = parseDay(day);
    const want = dom || d.getDate();
    const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(want, last));
    return iso(first);
  }
  function nextOn(day, days) {
    let next = addDays(day, 1);
    while (!days.includes(parseDay(next).getDay())) next = addDays(next, 1);
    return next;
  }
  function nextDate(day, repeat) {
    const n = repeat.every || 1;
    switch (repeat.unit) {
      case 'day': return addDays(day, n);
      case 'week': return addDays(day, 7 * n);
      case 'month': return addMonths(day, n, repeat.dom);
      case 'year': return addMonths(day, 12 * n, repeat.dom);
      case 'weekdays': return nextOn(day, [1, 2, 3, 4, 5]);
      case 'days': return nextOn(day, repeat.days?.length ? repeat.days : [parseDay(day).getDay()]);
      default: return addDays(day, 1);
    }
  }
  const repeatText = r => {
    if (!r) return '';
    if (r.unit === 'weekdays') return 'Weekdays';
    if (r.unit === 'days') return [...(r.days || [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DAY_LABELS[d]).join(', ');
    const n = r.every || 1;
    if (n === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[r.unit];
    return `Every ${n} ${r.unit}s`;
  };

  // ---- quick add ----
  // One line in, a task out. Each rule takes its words out of the line, and what's
  // left is the title.
  // options.use24: with the 24-hour clock on, "at 5:30" is 05:30 as written.
  function parseQuick(text, now, lists = [], options = {}) {
    const today = iso(now);
    let t = ` ${text.trim()} `;
    const out = { title: '', due: null, time: null, pri: 0, repeat: null, list: null, listName: null, remind: null, loud: false };
    const take = (re, fn) => {
      const m = t.match(re);
      if (!m) return false;
      if (fn(m) === false) return false;
      t = t.replace(m[0], ' ');
      return true;
    };

    take(/\s#(\p{L}[\p{L}\p{N}_-]*)(?=\s)/u, m => {
      out.listName = m[1];
      const hit = lists.find(l => l.name.toLowerCase().replace(/\s+/g, '') === m[1].toLowerCase());
      out.list = hit ? hit.id : null;
    });
    // Three is the top of the scale: it rings like a call.
    take(/\s(!{1,3})(?=\s)/, m => { out.pri = Math.min(2, m[1].length); out.loud = m[1].length === 3; });
    take(/\sremind(?: me)?\s+(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\s+before(?=\s)/i, m => {
      out.remind = Number(m[1]) * ({ m: 1, h: 60, d: 1440 }[m[2][0].toLowerCase()]);
    });

    // Repeats that say "every" are clear anywhere. "Weekly" alone only counts at the
    // end of the line, later on, so "Write weekly report" stays a title.
    let onDay = null, onDays = null;
    const dayName = `(?:${WEEKDAY})\\b`;
    take(new RegExp(`\\severy\\s+(${dayName}(?:\\s*(?:,|and|&)\\s*${dayName})+)`, 'i'), m => {
      onDays = [...new Set(m[1].toLowerCase().split(/\s*(?:,|and|&)\s*/).map(n => NAMES[n.trim()]))];
      out.repeat = { every: 1, unit: 'days', days: onDays };
    })
      || take(new RegExp(`\\severy\\s+(${WEEKDAY})\\b`, 'i'), m => { out.repeat = { every: 1, unit: 'week' }; onDay = NAMES[m[1].toLowerCase()]; })
      || take(/\severy\s+(\d+)\s+(day|week|month|year)s?\b/i, m => { out.repeat = { every: Number(m[1]), unit: m[2].toLowerCase() }; })
      || take(/\severy\s+other\s+(day|week|month|year)\b/i, m => { out.repeat = { every: 2, unit: m[1].toLowerCase() }; })
      || take(/\severy\s+weekday\b/i, () => { out.repeat = { every: 1, unit: 'weekdays' }; })
      || take(/\severy\s+(day|week|month|year)\b/i, m => { out.repeat = { every: 1, unit: m[1].toLowerCase() }; });
    // A repeat word right at the end comes off now, so a date or time before it ("14 Feb
    // yearly") is at the end of the line too. One before a date is taken further down.
    const repeatWord = () => {
      if (out.repeat) return;
      take(new RegExp(`\\s(daily|weekly|monthly|yearly|weekdays)${END}`, 'i'), m => {
        const word = m[1].toLowerCase();
        out.repeat = word === 'weekdays' ? { every: 1, unit: 'weekdays' } : { every: 1, unit: { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[word] };
      });
    };
    repeatWord();

    // Part of the day, which also settles "at 9" one way or the other.
    let part = null, tonight = false;
    take(new RegExp(`\\stonight${WHOLE}`, 'i'), () => { part = 'evening'; tonight = true; })
      || take(/\sin the\s+(morning|afternoon|evening)\b/i, m => { part = m[1].toLowerCase(); })
      || take(new RegExp(`\\s(morning|afternoon|evening)${END}`, 'i'), m => { part = m[1].toLowerCase(); });

    // Times.
    const clock = (h, m, half) => {
      let hour = Number(h);
      if (hour > 23 || Number(m || 0) > 59 || (half && hour > 12)) return false;
      if (half) hour = (hour % 12) + (half.toLowerCase() === 'pm' ? 12 : 0);
      out.time = `${pad(hour)}:${pad(Number(m || 0))}`;
      return true;
    };
    const DATE_NEXT = `(?=\\s*$|\\s+(?:today|tomorrow|tmrw|tmr|on\\s|next\\s|in\\s+\\d|${LONG_DAY}|${SHORT_DAY}))`;
    // Hours 1 to 7 with no am, pm or part of the day mean the afternoon: nobody means 3:30am.
    // Someone on the 24-hour clock writes what they mean.
    const guess = (h, m) => { const n = Number(h); return clock(!part && !options.use24 && n >= 1 && n <= 7 ? n + 12 : n, m); };
    // "In 20 min", "in 2 hours": that clock time, today or past midnight.
    take(/\sin\s+(\d{1,3})\s*(mins?|minutes?|hrs?|hours?)\b/i, m => {
      const at = new Date(+now + Number(m[1]) * (m[2][0].toLowerCase() === 'h' ? 60 : 1) * 60000);
      out.time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      out.due = iso(at);
    })
      || take(/\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i, m => clock(m[1], m[2], m[3]))
      || take(/\sat\s+(\d{1,2}):(\d{2})\b/, m => guess(m[1], m[2]))
      // Two-digit hours only, so "Read John 3:16" stays a title.
      || take(new RegExp(`\\s(\\d{2}):(\\d{2})${END}`), m => clock(m[1], m[2]))
      || take(new RegExp(`\\sat\\s+(\\d{1,2})${DATE_NEXT}`), m => {
        const h = Number(m[1]);
        return clock(!part && h >= 1 && h <= 7 ? h + 12 : h, 0);
      })
      || take(/\s(?:at\s+)?noon\b/i, () => { out.time = '12:00'; })
      || take(/\s(?:at\s+)?midnight\b/i, () => { out.time = '00:00'; });
    if (part && !out.time) out.time = tonight ? '20:00' : { morning: '09:00', afternoon: '15:00', evening: '18:00' }[part];
    else if (part && part !== 'morning' && Number(out.time.slice(0, 2)) < 12) out.time = `${pad(Number(out.time.slice(0, 2)) + 12)}${out.time.slice(2)}`;

    // Dates.
    const dayOfYear = (d, mo) => {
      let when = new Date(now.getFullYear(), mo, d);
      if (when.getMonth() !== mo) return false;
      if (iso(when) < today) when = new Date(now.getFullYear() + 1, mo, d);
      if (when.getMonth() !== mo) return false;   // 29 Feb, in a year without one
      out.due = iso(when);
      return true;
    };
    const weekday = m => {
      const next = nextWeekday(today, NAMES[m[2].toLowerCase()]);
      out.due = m[1] && daysBetween(today, next) < 7 ? addDays(next, 7) : next;
    };
    if (tonight) out.due = today;
    take(new RegExp(`\\stoday${WHOLE}`, 'i'), () => { out.due = today; })
      || take(new RegExp(`\\syesterday${WHOLE}`, 'i'), () => { out.due = addDays(today, -1); })
      || take(new RegExp(`\\s(?:the\\s+)?day after tomorrow${WHOLE}`, 'i'), () => { out.due = addDays(today, 2); })
      || take(new RegExp(`\\s(?:tomorrow|tmrw|tmr)${WHOLE}`, 'i'), () => { out.due = addDays(today, 1); })
      || take(/\snext week\b/i, () => { out.due = addDays(today, 7); })
      || take(/\snext month\b/i, () => { out.due = addMonths(today, 1); })
      || take(/\sin\s+(\d+)\s+(day|week|month)s?\b/i, m => {
        const n = Number(m[1]), unit = m[2].toLowerCase();
        out.due = unit === 'month' ? addMonths(today, n) : addDays(today, n * (unit === 'week' ? 7 : 1));
      })
      // Sat and sun are ordinary words, so short names need "on" or the end of the line.
      || take(new RegExp(`\\s(?:on\\s+)?(next\\s+)?(${LONG_DAY})${WHOLE}`, 'i'), weekday)
      || take(new RegExp(`\\s(?:on\\s+|(next)\\s+)(${SHORT_DAY})${WHOLE}`, 'i'), weekday)
      || take(new RegExp(`\\s()(${SHORT_DAY})${END}`, 'i'), weekday)
      || take(new RegExp(`\\son\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\b`, 'i'), m => dayOfYear(Number(m[1]), monthOf(m[2].toLowerCase())))
      || take(new RegExp(`\\s(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})${END}`, 'i'), m => dayOfYear(Number(m[1]), monthOf(m[2].toLowerCase())))
      || take(new RegExp(`\\son\\s+(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), m => dayOfYear(Number(m[2]), monthOf(m[1].toLowerCase())))
      || take(new RegExp(`\\s(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?${END}`, 'i'), m => dayOfYear(Number(m[2]), monthOf(m[1].toLowerCase())))
      // "On the 1st": the next date with that day of the month. Not "on the 2nd floor" or
      // "on the 4th of July".
      || take(/\son\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:floor|of)\b)/i, m => {
        const d = Number(m[1]);
        for (let k = 0; d >= 1 && d <= 31 && k < 13; k++) {
          const when = new Date(now.getFullYear(), now.getMonth() + k, d);
          if (when.getDate() === d && iso(when) >= today) { out.due = iso(when); return true; }
        }
        return false;
      })
      || take(/\son\s+(\d{1,2})\/(\d{1,2})\b/, m => dayOfYear(Number(m[1]), Number(m[2]) - 1))
      || take(new RegExp(`\\s(\\d{1,2})/(\\d{1,2})${END}`), m => dayOfYear(Number(m[1]), Number(m[2]) - 1));

    repeatWord();

    if (onDay !== null && !out.due) out.due = parseDay(today).getDay() === onDay ? today : nextWeekday(today, onDay);
    if (onDays && !out.due) out.due = onDays.includes(parseDay(today).getDay()) ? today : nextDate(today, out.repeat);
    if (out.repeat && !out.due) out.due = today;
    if (out.repeat) out.due = fitToDays(out.due, out.repeat);
    // A time alone means the next time that clock comes round.
    if (out.time && !out.due) out.due = atTime(today, out.time) > now ? today : addDays(today, 1);
    if (out.repeat && ['month', 'year'].includes(out.repeat.unit) && out.due) out.repeat.dom = parseDay(out.due).getDate();

    out.title = t.replace(/\s+/g, ' ').trim();
    if (out.due || out.time) out.title = out.title.replace(/\s+(on|at|by)$/i, '').replace(/^(on|at|by)\s+/i, '');
    return out;
  }

  // ---- tasks ----
  let idCount = 0;
  const newId = now => `${Math.floor(+now).toString(36)}${(idCount++ % 1296).toString(36)}`;

  function makeTask(fields, now, prefs = {}) {
    const reminders = fields.remind != null ? [{ before: fields.remind }]
      : fields.loud ? [{ before: 0 }]
        : fields.due && prefs.defaultReminder != null ? [{ before: prefs.defaultReminder }] : [];
    return ensureRing({
      id: newId(now), title: fields.title, notes: '', list: fields.list || null, due: fields.due || (fields.remind != null || fields.loud ? iso(now) : null), time: fields.time || null,
      pri: fields.pri || 0, repeat: fields.repeat || null, reminders, nag: 0, loud: !!fields.loud, subs: [], done: null, deleted: null, snooze: null, created: +now,
    }, now);
  }

  // An urgent task has to have something left to ring, even if its time has gone by:
  // an hour away for a new task, sooner when switched on for one already due.
  function ensureRing(task, now, leadMinutes = 60) {
    if (!task.loud || firings(task, now).length) return task;
    return { ...task, reminders: [...task.reminders, { at: local(new Date(+now + leadMinutes * 6e4)) }] };
  }

  const isOpen = t => !t.done && !t.deleted;

  // A change made in the editor. A snooze put off one ringing, so a new date, time or
  // set of reminders replaces it.
  function edited(task, change) {
    const out = { ...task, ...change };
    const moved = ['due', 'time', 'reminders'].some(k => k in change && JSON.stringify(change[k]) !== JSON.stringify(task[k]));
    return moved && out.snooze ? { ...out, snooze: null } : out;
  }

  // What the phone's settings mean for reminders. askExact is on in builds where the
  // person has to allow exact alarms: there, without it, reminders are late, not off.
  function reminderWarning(health, askExact) {
    if (!health || (health.notifications && health.exact)) return null;
    if (askExact && health.notifications) return 'Reminders may ring late. Tap to fix.';
    return 'Reminders are switched off. Tap to fix.';
  }
  // Asked once, after notifications, and only when a task has a reminder to ring.
  const shouldAskExact = (health, askExact, hasReminders, asked) =>
    !!(askExact && hasReminders && !asked && health && health.notifications && !health.exact);
  // What's stopping a reminder ringing on time, if anything.
  const exactBlocker = (health, askExact) => (health && askExact && !health.exact
    ? { what: 'alarms', text: 'Allow alarms and reminders, or this may ring late. Tap to turn it on.' } : null);
  // What's stopping an urgent task taking over the screen, if anything.
  function loudBlocker(health, askExact) {
    if (!health) return null;
    const late = exactBlocker(health, askExact);
    if (late) return late;
    if (!health.overlay) return { what: 'overlay', text: 'Allow Show over other apps, or this stays a banner while you’re using your phone. Tap to turn it on.' };
    if (!health.fullScreen) return { what: 'fullscreen', text: 'Allow full-screen alarms, or this won’t show on the lock screen. Tap to turn it on.' };
    return null;
  }

  // Ticking off: a repeating task moves to its next date, and anything else is done.
  function complete(task, now) {
    const today = iso(now);
    if (task.repeat && task.due) {
      // Overdue and ticked means caught up, so today's date goes with it.
      const overdue = task.due < today;
      let next = nextDate(task.due, task.repeat);
      while (next < today || (overdue && next === today)) next = nextDate(next, task.repeat);
      if (!task.repeat.until || next <= task.repeat.until) {
        return { ...task, due: next, snooze: null, subs: task.subs.map(s => ({ ...s, done: false })), reminders: task.reminders.filter(r => r.before != null) };
      }
    }
    return { ...task, done: +now, snooze: null };
  }

  // Dates a task falls on, for working out alarms. An old unticked task counts from
  // `from`, or its dates would all be used up in the past.
  function occurrences(task, limit, from) {
    const out = [];
    let day = task.due;
    for (let guard = 0; day && out.length < limit && guard < 20000; guard++) {
      if (task.repeat?.until && day > task.repeat.until) break;
      if (!from || day >= from || !task.repeat) out.push(day);
      if (!task.repeat) break;
      day = nextDate(day, task.repeat);
    }
    return out;
  }

  // A task that rings like a call keeps coming back until it's dealt with.
  const LOUD_NAG = 5;   // minutes
  const nagOf = task => task.nag || (task.loud ? LOUD_NAG : 0);

  // When a reminder rings. Days and weeks before keep the clock time, even across a
  // change of daylight saving.
  function ringTime(occ, time, before) {
    if (before % 1440 === 0) return atTime(addDays(occ, -before / 1440), time);
    return new Date(atTime(occ, time) - before * 6e4);
  }

  // Every alarm a task should raise from now on. The text is written for the moment
  // it rings, not the moment it's saved.
  function firings(task, now, limit = 60, use24 = false) {
    if (!isOpen(task)) return [];
    const out = [];
    const body = (when, day) => (day ? [dayText(day, when), timeText(task.time, use24)].filter(Boolean).join(', ') : '');
    const add = (when, occ) => {
      if (when > now) out.push({ id: `${task.id}|${local(when)}`, task: task.id, occ, at: local(when), title: task.title, body: body(when, occ), nag: nagOf(task), loud: !!task.loud, use24 });
    };
    for (const occ of occurrences(task, limit, iso(now))) {
      for (const r of task.reminders) if (r.before != null) add(ringTime(occ, task.time, r.before), occ);
    }
    for (const r of task.reminders) if (r.at) add(new Date(r.at), task.due || '');
    if (task.snooze) add(new Date(task.snooze), task.due || '');
    return out;
  }

  const onDay = (task, day) => occurrences(task, 1, day)[0] === day;

  // A repeat on set days, or on weekdays, has to start on one of them.
  function fitToDays(day, repeat) {
    const days = repeat?.unit === 'weekdays' ? [1, 2, 3, 4, 5] : repeat?.unit === 'days' ? repeat.days : null;
    if (!days?.length || days.includes(parseDay(day).getDay())) return day;
    return nextDate(day, repeat);
  }

  // What a morning summary says. AlarmPlan.summaryText says it the same way, for when
  // the phone takes a task off the count.
  const summaryText = names => ({ title: `${names.length} ${names.length === 1 ? 'task' : 'tasks'} today`, body: names.slice(0, 3).join(', ') });

  // The whole list the phone is given, soonest first. Two reminders can't share a
  // minute for one task, and a morning summary rides along for the next fortnight.
  function schedule(state, now) {
    const use24 = !!state.prefs?.use24;
    const seen = new Set();
    let out = [];
    for (const task of state.tasks) for (const f of firings(task, now, 60, use24)) {
      if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
    }
    const time = state.prefs?.summary;
    let lastSummary = null;
    if (time) {
      for (let i = 0; i < 30; i++) {
        const day = addDays(iso(now), i);
        const when = atTime(day, time);
        if (when <= now) continue;
        // Anything still open from before that day is overdue by then, as Today will show it.
        const open = state.tasks.filter(t => isOpen(t) && t.due && (onDay(t, day) || t.due < day));
        lastSummary = local(when);
        if (!open.length) continue;
        // Each with the date it's counted for, so Done on a notification can take it
        // off the count before the page is next opened (AlarmPlan.afterDone).
        const items = open.map(t => [t.id, onDay(t, day) ? day : t.due, t.title]);
        out.push({ id: `summary|${day}`, task: '', occ: '', at: local(when), ...summaryText(items.map(i => i[2])), items, nag: 0, summary: true });
      }
    }
    out = out.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 800);

    // Only the page can plan further ahead. If it isn't opened for a month or two,
    // the last thing the phone does is say so, rather than going quiet.
    const ends = state.tasks.filter(t => isOpen(t) && t.repeat && !t.repeat.until && t.reminders.some(r => r.before != null))
      .map(t => out.filter(f => f.task === t.id).pop()?.at).filter(Boolean);
    if (lastSummary) ends.push(lastSummary);
    if (ends.length) {
      const when = new Date(new Date(ends.sort()[0]).getTime() + 6e4);
      out.push({ id: 'keep-going', task: '', occ: '', at: local(when), title: 'Open Nudge', body: 'Open the app to keep your repeating reminders going.', nag: 0, summary: true });
      out.sort((a, b) => (a.at < b.at ? -1 : 1));
    }
    return out;
  }

  // What was tapped on a notification while the app was closed.
  function applyActions(state, actions, now) {
    let tasks = state.tasks;
    for (const a of actions) {
      tasks = tasks.map(t => {
        if (t.id !== a.task || !isOpen(t)) return t;
        // An old notification tapped late can't undo what's happened since.
        const stale = t.repeat && a.occ < t.due;
        if (a.type === 'done') {
          if (stale) return t;
          return complete(t.repeat ? { ...t, due: a.occ } : t, new Date(a.when || now));
        }
        if (a.type === 'snooze' && !stale) return { ...t, snooze: a.until };
        return t;
      });
    }
    return { ...state, tasks };
  }

  // ---- what the screens show ----
  // Overdue one-off tasks can all move to today. A repeating task's date is what
  // keeps it on its day, and ticking it catches it up anyway.
  const canMove = (t, now) => isOpen(t) && !t.repeat && t.due && t.due < iso(now);
  function moveOverdue(tasks, now) {
    const day = iso(now);
    return tasks.map(t => (canMove(t, now) ? { ...t, due: day } : t));
  }

  // Ticked off today. A repeating task moves on instead, so it isn't here.
  const doneToday = (tasks, now) => tasks.filter(t => !t.deleted && t.done && iso(new Date(t.done)) === iso(now)).sort((a, b) => b.done - a.done);

  // A list in the order it was dragged into, with anything newer after that by date.
  const listOrder = tasks => [...tasks].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || byDue(a, b));

  // Deleted tasks stay a month in case they're wanted back.
  const tidy = (state, now) => ({ ...state, tasks: state.tasks.filter(t => !t.deleted || now - t.deleted < 30 * DAY) });

  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || b.pri - a.pri || a.created - b.created;

  // What the home screen widget is given: open tasks up to a week ahead, each with its
  // date, so it can move on to a new day by itself before the app is next opened. A
  // repeating task comes with each of its dates that week, so ticking one off on a
  // notification leaves the next. The widget shows a task once, by its earliest date.
  const WIDGET_DAYS = 7;
  function widgetItems(tasks, now) {
    const day = iso(now), until = addDays(day, WIDGET_DAYS);
    const out = [];
    for (const t of tasks.filter(x => isOpen(x) && x.due && x.due <= until).sort(byDue)) {
      if (!t.repeat) { out.push({ id: t.id, title: t.title, due: t.due }); continue; }
      const dates = [t.due, ...occurrences(t, WIDGET_DAYS + 1, day).filter(d => d > t.due && d <= until)];
      for (const due of dates) out.push({ id: t.id, title: t.title, due, repeat: true });
    }
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }

  function today(tasks, now) {
    const day = iso(now);
    const open = tasks.filter(isOpen);
    return {
      overdue: open.filter(t => t.due && t.due < day).sort(byDue),
      today: open.filter(t => t.due === day).sort(byDue),
    };
  }

  // Days ahead, each with its tasks, then what has no date.
  function upcoming(tasks, now) {
    const day = iso(now);
    const groups = new Map();
    for (const t of tasks.filter(x => isOpen(x) && x.due && x.due > day).sort(byDue)) {
      (groups.get(t.due) || groups.set(t.due, []).get(t.due)).push(t);
    }
    return { days: [...groups].map(([date, list]) => ({ date, tasks: list })), someday: tasks.filter(t => isOpen(t) && !t.due).sort(byDue) };
  }

  function search(tasks, text) {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const hits = tasks.filter(t => !t.deleted && (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.subs.some(s => s.title.toLowerCase().includes(q))));
    // What's still to do comes first. Done ones after, the latest first.
    return [...hits.filter(t => !t.done).sort(byDue), ...hits.filter(t => t.done).sort((a, b) => b.done - a.done)];
  }

  function dayText(day, now) {
    const gap = daysBetween(iso(now), day);
    if (gap === 0) return 'Today';
    if (gap === 1) return 'Tomorrow';
    if (gap === -1) return 'Yesterday';
    const d = parseDay(day);
    if (gap > 1 && gap < 7) return WEEKDAYS[d.getDay()][0].toUpperCase() + WEEKDAYS[d.getDay()].slice(1);
    const short = `${d.getDate()} ${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1, 3)}`;
    return d.getFullYear() === now.getFullYear() ? short : `${short} ${d.getFullYear()}`;
  }

  function timeText(time, use24) {
    if (!time) return '';
    if (use24) return time;
    const [h, m] = time.split(':').map(Number);
    return `${h % 12 || 12}${m ? `:${pad(m)}` : ''}${h < 12 ? 'am' : 'pm'}`;
  }

  // [time] is the task's. Without one there's no time to be before, so it says the
  // clock time it really rings at.
  function reminderText(r, now, use24, time) {
    if (r.at) { const d = new Date(r.at); return `${dayText(iso(d), now)}, ${timeText(`${pad(d.getHours())}:${pad(d.getMinutes())}`, use24)}`; }
    if (!time) {
      const [h, m] = NO_TIME.split(':').map(Number);
      const mins = h * 60 + m - r.before;
      const days = Math.max(0, Math.ceil(-mins / 1440));
      const at = mins + days * 1440;
      const clock = timeText(`${pad(Math.floor(at / 60))}:${pad(at % 60)}`, use24);
      return days ? `${days} ${days === 1 ? 'day' : 'days'} before, ${clock}` : clock;
    }
    if (r.before === 0) return 'At the time';
    if (r.before % 1440 === 0) return `${r.before / 1440} ${r.before === 1440 ? 'day' : 'days'} before`;
    if (r.before % 60 === 0) return `${r.before / 60} ${r.before === 60 ? 'hour' : 'hours'} before`;
    return `${r.before} min before`;
  }

  // Keeps a save usable whatever happened to it.
  function cleanState(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const hm = v => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
    const stamp = v => (Number.isFinite(v) ? v : null);
    const units = ['day', 'week', 'month', 'year', 'weekdays', 'days'];
    const lists = Array.isArray(s.lists) ? s.lists.filter(l => l && l.id && typeof l.name === 'string') : [];
    const tasks = (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && t.id && typeof t.title === 'string').map(t => ({
      ...t,
      notes: typeof t.notes === 'string' ? t.notes : '',
      list: typeof t.list === 'string' ? t.list : null,
      due: day(t.due),
      time: day(t.due) ? hm(t.time) : null,
      pri: [1, 2].includes(t.pri) ? t.pri : 0,
      repeat: day(t.due) && t.repeat && units.includes(t.repeat.unit) ? t.repeat : null,
      nag: Number.isFinite(t.nag) ? t.nag : 0,
      loud: t.loud === true,
      done: stamp(t.done),
      deleted: stamp(t.deleted),
      snooze: stamp(t.snooze),
      created: stamp(t.created) || 0,
      order: Number.isFinite(t.order) ? t.order : undefined,
      reminders: (Array.isArray(t.reminders) ? t.reminders : []).filter(r => r && (Number.isFinite(r.before) || typeof r.at === 'string')),
      subs: (Array.isArray(t.subs) ? t.subs : []).filter(x => x && typeof x.title === 'string'),
    }));
    return { lists, tasks, prefs: { summary: null, defaultReminder: 0, use24: false, ...(s.prefs || {}) } };
  }

  const lib = { edited, summaryText, reminderWarning, shouldAskExact, exactBlocker, loudBlocker, iso, parseDay, addDays, daysBetween, atTime, local, nextDate, repeatText, parseQuick, makeTask, newId, isOpen, complete, occurrences, firings, schedule, applyActions, today, upcoming, search, dayText, timeText, reminderText, cleanState, ensureRing, fitToDays, nagOf, LOUD_NAG, widgetItems, canMove, moveOverdue, doneToday, listOrder, tidy };
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.NudgeLib = lib;
})(this);
