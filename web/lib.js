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
  const atTime = (day, time) => { const d = parseDay(day); const [h, m] = (time || '09:00').split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
  const local = d => `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const NAMES = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  WEEKDAYS.forEach((w, i) => { NAMES[w] = i; });
  const WEEKDAY = Object.keys(NAMES).sort((a, b) => b.length - a.length).join('|');
  const MONTH = [...MONTHS, ...MONTHS.map(m => m.slice(0, 3)), 'sept'].sort((a, b) => b.length - a.length).join('|');
  const monthOf = m => MONTHS.findIndex(x => x.startsWith(m.slice(0, 3)));

  // The next date a weekday falls on, today not included.
  function nextWeekday(from, day) {
    const d = parseDay(from);
    return addDays(from, ((day - d.getDay() + 7) % 7) || 7);
  }

  // ---- repeats ----
  // { every: n, unit: 'day'|'week'|'month'|'year'|'weekdays', dom: day of the month, until: day }
  function addMonths(day, n, dom) {
    const d = parseDay(day);
    const want = dom || d.getDate();
    const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(want, last));
    return iso(first);
  }
  function nextDate(day, repeat) {
    const n = repeat.every || 1;
    switch (repeat.unit) {
      case 'day': return addDays(day, n);
      case 'week': return addDays(day, 7 * n);
      case 'month': return addMonths(day, n, repeat.dom);
      case 'year': return addMonths(day, 12 * n, repeat.dom);
      case 'weekdays': {
        let next = addDays(day, 1);
        while ([0, 6].includes(parseDay(next).getDay())) next = addDays(next, 1);
        return next;
      }
      default: return addDays(day, 1);
    }
  }
  const repeatText = r => {
    if (!r) return '';
    if (r.unit === 'weekdays') return 'Weekdays';
    const n = r.every || 1;
    if (n === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[r.unit];
    return `Every ${n} ${r.unit}s`;
  };

  // ---- quick add ----
  // One line in, a task out. Each rule takes its words out of the line, and what's
  // left is the title.
  function parseQuick(text, now, lists = []) {
    const today = iso(now);
    let t = ` ${text.trim()} `;
    const out = { title: '', due: null, time: null, pri: 0, repeat: null, list: null, listName: null, remind: null };
    const take = (re, fn) => {
      const m = t.match(re);
      if (!m) return false;
      if (fn(m) === false) return false;
      t = t.replace(m[0], ' ');
      return true;
    };

    take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, m => {
      out.listName = m[1];
      const hit = lists.find(l => l.name.toLowerCase().replace(/\s+/g, '') === m[1].toLowerCase());
      out.list = hit ? hit.id : null;
    });
    take(/\s(!{1,2})(?=\s)/, m => { out.pri = m[1].length; });
    take(/\sremind(?: me)?\s+(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)\s+before(?=\s)/i, m => {
      out.remind = Number(m[1]) * ({ m: 1, h: 60, d: 1440 }[m[2][0].toLowerCase()]);
    });

    // Repeats.
    let onDay = null;
    take(new RegExp(`\\severy\\s+(${WEEKDAY})\\b`, 'i'), m => { out.repeat = { every: 1, unit: 'week' }; onDay = NAMES[m[1].toLowerCase()]; })
      || take(/\severy\s+(\d+)\s+(day|week|month|year)s?\b/i, m => { out.repeat = { every: Number(m[1]), unit: m[2].toLowerCase() }; })
      || take(/\severy\s+other\s+(day|week|month|year)\b/i, m => { out.repeat = { every: 2, unit: m[1].toLowerCase() }; })
      || take(/\severy\s+weekday\b/i, () => { out.repeat = { every: 1, unit: 'weekdays' }; })
      || take(/\severy\s+(day|week|month|year)\b/i, m => { out.repeat = { every: 1, unit: m[1].toLowerCase() }; })
      || take(/\s(daily|weekly|monthly|yearly|weekdays)\b/i, m => {
        const word = m[1].toLowerCase();
        out.repeat = word === 'weekdays' ? { every: 1, unit: 'weekdays' } : { every: 1, unit: { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[word] };
      });

    // Times.
    const clock = (h, m, half) => {
      let hour = Number(h);
      if (hour > 23 || Number(m || 0) > 59 || (half && hour > 12)) return false;
      if (half) hour = (hour % 12) + (half.toLowerCase() === 'pm' ? 12 : 0);
      out.time = `${pad(hour)}:${pad(Number(m || 0))}`;
      return true;
    };
    take(/\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i, m => clock(m[1], m[2], m[3]))
      || take(/\s(?:at\s+)?(\d{1,2}):(\d{2})\b/, m => clock(m[1], m[2]))
      || take(/\sat\s+(\d{1,2})\b/, m => { const h = Number(m[1]); return clock(h >= 1 && h <= 7 ? h + 12 : h, 0); })
      || take(/\s(?:at\s+)?noon\b/i, () => { out.time = '12:00'; })
      || take(/\s(?:at\s+)?midnight\b/i, () => { out.time = '00:00'; })
      || take(/\s(?:in the\s+)?morning\b/i, () => { out.time = '09:00'; })
      || take(/\s(?:in the\s+)?afternoon\b/i, () => { out.time = '15:00'; })
      || take(/\s(?:in the\s+)?evening\b/i, () => { out.time = '18:00'; });

    // Dates.
    const dayOfYear = (d, mo) => {
      let when = new Date(now.getFullYear(), mo, d);
      if (when.getMonth() !== mo) return false;
      if (iso(when) < today) when = new Date(now.getFullYear() + 1, mo, d);
      out.due = iso(when);
      return true;
    };
    take(/\s(?:today)\b/i, () => { out.due = today; })
      || take(/\syesterday\b/i, () => { out.due = addDays(today, -1); })
      || take(/\stonight\b/i, () => { out.due = today; out.time = out.time || '20:00'; })
      || take(/\s(?:the\s+)?day after tomorrow\b/i, () => { out.due = addDays(today, 2); })
      || take(/\s(?:tomorrow|tmrw|tmr)\b/i, () => { out.due = addDays(today, 1); })
      || take(/\snext week\b/i, () => { out.due = addDays(today, 7); })
      || take(/\snext month\b/i, () => { out.due = addMonths(today, 1); })
      || take(/\sin\s+(\d+)\s+(day|week|month)s?\b/i, m => {
        const n = Number(m[1]), unit = m[2].toLowerCase();
        out.due = unit === 'month' ? addMonths(today, n) : addDays(today, n * (unit === 'week' ? 7 : 1));
      })
      || take(new RegExp(`\\s(?:on\\s+)?(next\\s+)?(${WEEKDAY})\\b`, 'i'), m => {
        const next = nextWeekday(today, NAMES[m[2].toLowerCase()]);
        out.due = m[1] && daysBetween(today, next) < 7 ? addDays(next, 7) : next;
      })
      || take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\b`, 'i'), m => dayOfYear(Number(m[1]), monthOf(m[2].toLowerCase())))
      || take(new RegExp(`\\s(?:on\\s+)?(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), m => dayOfYear(Number(m[2]), monthOf(m[1].toLowerCase())))
      || take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})\b/, m => dayOfYear(Number(m[1]), Number(m[2]) - 1));

    if (onDay !== null && !out.due) out.due = parseDay(today).getDay() === onDay ? today : nextWeekday(today, onDay);
    if (out.repeat && !out.due) out.due = today;
    // A time alone means the next time that clock comes round.
    if (out.time && !out.due) out.due = atTime(today, out.time) > now ? today : addDays(today, 1);
    if (out.repeat && ['month', 'year'].includes(out.repeat.unit) && out.due) out.repeat.dom = parseDay(out.due).getDate();

    out.title = t.replace(/\s+/g, ' ').trim().replace(/\s+(on|at|by)$/i, '').replace(/^(on|at|by)\s+/i, '');
    return out;
  }

  // ---- tasks ----
  let idCount = 0;
  const newId = now => `${Math.floor(+now).toString(36)}${(idCount++ % 1296).toString(36)}`;

  function makeTask(fields, now, prefs = {}) {
    const reminders = fields.remind != null ? [{ before: fields.remind }]
      : fields.due && prefs.defaultReminder != null ? [{ before: prefs.defaultReminder }] : [];
    return {
      id: newId(now), title: fields.title, notes: '', list: fields.list || null, due: fields.due || null, time: fields.time || null,
      pri: fields.pri || 0, repeat: fields.repeat || null, reminders, nag: 0, subs: [], done: null, deleted: null, snooze: null, created: +now,
    };
  }

  const isOpen = t => !t.done && !t.deleted;

  // Ticking off: a repeating task moves to its next date, and anything else is done.
  function complete(task, now) {
    const today = iso(now);
    if (task.repeat && task.due) {
      let next = nextDate(task.due, task.repeat);
      while (next < today) next = nextDate(next, task.repeat);
      if (!task.repeat.until || next <= task.repeat.until) {
        return { ...task, due: next, snooze: null, subs: task.subs.map(s => ({ ...s, done: false })), reminders: task.reminders.filter(r => r.before != null) };
      }
    }
    return { ...task, done: +now, snooze: null };
  }

  // Dates a task falls on from its due date, for working out alarms.
  function occurrences(task, limit) {
    const out = [];
    let day = task.due;
    while (day && out.length < limit) {
      if (task.repeat?.until && day > task.repeat.until) break;
      out.push(day);
      if (!task.repeat) break;
      day = nextDate(day, task.repeat);
    }
    return out;
  }

  // Every alarm a task should raise from now on.
  function firings(task, now, limit = 30) {
    if (!isOpen(task)) return [];
    const out = [];
    const body = when => [dayText(iso(when), now), task.time ? timeText(task.time) : ''].filter(Boolean).join(', ');
    const add = (when, occ, due) => {
      if (when > now) out.push({ id: `${task.id}|${local(when)}`, task: task.id, occ, at: local(when), title: task.title, body: due ? body(due) : '', nag: task.nag || 0 });
    };
    for (const occ of occurrences(task, limit)) {
      const due = atTime(occ, task.time);
      for (const r of task.reminders) if (r.before != null) add(new Date(due - r.before * 6e4), occ, due);
    }
    for (const r of task.reminders) if (r.at) add(new Date(r.at), task.due || '', task.due ? atTime(task.due, task.time) : null);
    if (task.snooze) add(new Date(task.snooze), task.due || '', task.due ? atTime(task.due, task.time) : null);
    return out;
  }

  const onDay = (task, day) => occurrences(task, 40).includes(day);

  // The whole list the phone is given, soonest first. Two reminders can't share a
  // minute for one task, and a morning summary rides along for the next fortnight.
  function schedule(state, now) {
    const seen = new Set();
    const out = [];
    for (const task of state.tasks) for (const f of firings(task, now)) {
      if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
    }
    const time = state.prefs?.summary;
    if (time) {
      for (let i = 0; i < 14; i++) {
        const day = addDays(iso(now), i);
        const when = atTime(day, time);
        if (when <= now) continue;
        const open = state.tasks.filter(t => isOpen(t) && t.due && (onDay(t, day) || (i === 0 && t.due < day)));
        if (!open.length) continue;
        const names = open.slice(0, 3).map(t => t.title).join(', ');
        out.push({ id: `summary|${day}`, task: '', occ: '', at: local(when), title: `${open.length} ${open.length === 1 ? 'task' : 'tasks'} today`, body: names, nag: 0, summary: true });
      }
    }
    return out.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(0, 400);
  }

  // What was tapped on a notification while the app was closed.
  function applyActions(state, actions, now) {
    let tasks = state.tasks;
    for (const a of actions) {
      tasks = tasks.map(t => {
        if (t.id !== a.task || !isOpen(t)) return t;
        if (a.type === 'done' && (!t.repeat || t.due === a.occ)) return complete(t, new Date(a.when || now));
        if (a.type === 'snooze') return { ...t, snooze: a.until };
        return t;
      });
    }
    return { ...state, tasks };
  }

  // ---- what the screens show ----
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99') || b.pri - a.pri || a.created - b.created;

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
    return tasks.filter(t => !t.deleted && (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q) || t.subs.some(s => s.title.toLowerCase().includes(q)))).sort(byDue);
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

  function reminderText(r, now) {
    if (r.at) { const d = new Date(r.at); return `${dayText(iso(d), now)}, ${timeText(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`; }
    if (r.before === 0) return 'At the time';
    if (r.before % 1440 === 0) return `${r.before / 1440} ${r.before === 1440 ? 'day' : 'days'} before`;
    if (r.before % 60 === 0) return `${r.before / 60} ${r.before === 60 ? 'hour' : 'hours'} before`;
    return `${r.before} min before`;
  }

  // Keeps a save usable whatever happened to it.
  function cleanState(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const lists = Array.isArray(s.lists) ? s.lists.filter(l => l && l.id && typeof l.name === 'string') : [];
    const tasks = (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && t.id && typeof t.title === 'string')
      .map(t => ({ notes: '', list: null, due: null, time: null, pri: 0, repeat: null, nag: 0, done: null, deleted: null, snooze: null, created: 0, ...t, reminders: Array.isArray(t.reminders) ? t.reminders : [], subs: Array.isArray(t.subs) ? t.subs : [] }));
    return { lists, tasks, prefs: { summary: null, defaultReminder: 0, use24: false, ...(s.prefs || {}) } };
  }

  const lib = { iso, parseDay, addDays, daysBetween, atTime, local, nextDate, repeatText, parseQuick, makeTask, newId, isOpen, complete, occurrences, firings, schedule, applyActions, today, upcoming, search, dayText, timeText, reminderText, cleanState };
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.NudgeLib = lib;
})(this);
