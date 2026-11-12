(() => {
  const L = window.NudgeLib;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const app = window.nudgeApp || null;
  // The iPhone app says so before the page runs. It has its own notifications and
  // nothing to set up but those, and it keeps the keyboard down until a field is tapped.
  const ios = window.nudgePlatform === 'ios';
  if (ios) document.documentElement.dataset.platform = 'ios';

  const COLOURS = ['#2C53C4', '#1D7548', '#B0392D', '#C08A14', '#7A4FB5', '#5B6861'];
  const ICON = {
    tick: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.5 7 3 3 5-6.5"/></svg>',
    bell: '<svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 1a3.6 3.6 0 0 0-3.6 3.6c0 2.6-1 3.6-1.4 4h10c-.4-.4-1.4-1.4-1.4-4A3.6 3.6 0 0 0 6 1Zm-1.3 9a1.4 1.4 0 0 0 2.6 0z"/></svg>',
    repeat: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5A3.5 3.5 0 0 1 5.5 2H9M7.5.5 9 2 7.5 3.5M10 6.5A3.5 3.5 0 0 1 6.5 10H3M4.5 11.5 3 10l1.5-1.5"/></svg>',
    grip: '<svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M1 1h14M1 5h14M1 9h14"/></svg>',
    cross: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m2.5 2.5 7 7M9.5 2.5l-7 7"/></svg>',
  };

  // ---- the data ----
  // The phone's copy wins when there is one: it's the one that travels in Android's
  // backup, and it's where taps on notifications go. localStorage just gives the
  // first screen something to draw straight away.
  const read = k => { try { return JSON.parse(localStorage.getItem('nudge.' + k)); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem('nudge.' + k, JSON.stringify(v)); } catch {} };
  let state = L.tidy(L.cleanState(read('state')), Date.now());
  if (!read('state')) state.lists = [{ id: 'home', name: 'Home', colour: COLOURS[1] }, { id: 'work', name: 'Work', colour: COLOURS[0] }];
  let tab = ['today', 'upcoming', 'lists'].includes(read('tab')) ? read('tab') : 'today';

  const now = () => new Date();
  const listOf = id => state.lists.find(l => l.id === id);

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    write('state', state);
    const open = state.tasks.filter(L.isOpen);
    toApp({ type: 'save', state: JSON.stringify(state), alarms: L.schedule(state, now(), ios), widget: { day: L.iso(now()), items: L.widgetItems(state.tasks, now()) } });
    if (app && open.some(x => x.reminders.length) && health && !health.notifications && !read('askedNotify')) {
      write('askedNotify', true);
      toApp({ type: 'askNotifications' });
    }
    askForExact();
  }
  function commit() { save(); render(); }
  // Typing saves once it pauses, not on every key: each save sets every reminder again.
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  function saveNow() { if (saveTimer) save(); }
  window.nudgeFlush = saveNow;
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);

  function setTask(id, change, soon) {
    state.tasks = state.tasks.map(t => (t.id === id ? { ...t, ...change } : t));
    if (soon) saveSoon(); else save();
  }
  const task = id => state.tasks.find(t => t.id === id);

  // ---- undo ----
  let toastTimer = 0, undo = null;
  function say(text, restore) {
    clearTimeout(toastTimer);
    undo = restore || null;
    $('toastText').textContent = text;
    $('toastUndo').hidden = !restore;
    $('toast').hidden = false;
    // Over a page, the footer can't be reached, so the message goes on the page.
    const page = openDialog();
    // On iPhone it sits above the page's add box, clear of the home bar.
    const quick = ios && page ? page.querySelector('.page-quick') : null;
    if (quick) quick.before($('toast')); else if (page) page.append($('toast')); else document.querySelector('footer').prepend($('toast'));
    toastTimer = setTimeout(() => { $('toast').hidden = true; undo = null; }, 5000);
  }
  $('toastUndo').addEventListener('click', () => {
    if (undo) undo();
    undo = null;
    $('toast').hidden = true;
  });

  // ---- drawing a task ----
  // Under a heading that already says the day, the row leaves it out.
  function subline(t, showList = true, headed = null) {
    const sub = el('div', 'sub');
    const day = L.iso(now());
    if (t.due) {
      const when = [t.due === headed ? '' : L.dayText(t.due, now()), L.timeText(t.time, state.prefs.use24)].filter(Boolean).join(', ');
      if (when) sub.append(el('span', !t.done && t.due < day ? 'late' : '', when));
    }
    if (t.repeat) { const s = el('span'); s.innerHTML = ICON.repeat; s.append(L.repeatText(t.repeat)); sub.append(s); }
    if (t.reminders.length) {
      const s = el('span', t.loud ? 'loud' : '');
      s.innerHTML = ICON.bell;
      if (t.loud) s.append('Rings like a call');
      else if (t.nag) s.append('Keeps nudging');
      else if (t.reminders.length > 1) s.append(String(t.reminders.length), el('span', 'vh', 'reminders'));
      else s.append(el('span', 'vh', 'Reminder'));
      sub.append(s);
    }
    if (t.subs.length) sub.append(el('span', '', `${t.subs.filter(x => x.done).length}/${t.subs.length}`));
    const list = showList && listOf(t.list);
    if (list) { const s = el('span'); const d = el('i', 'dot'); d.style.background = list.colour; s.append(d, list.name); sub.append(s); }
    return sub;
  }

  function row(t, showList = true, sortable = false, headed = null) {
    const r = el('div', `${t.done ? 'task done' : 'task'}${sortable ? ' sortable' : ''}`);
    r.dataset.id = t.id;
    const tick = el('button', `tick pri${t.pri}`);
    tick.type = 'button';
    tick.dataset.tick = t.id;
    tick.setAttribute('aria-label', t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`);
    tick.innerHTML = `<i>${ICON.tick}</i>`;
    const main = el('button', 'task-main');
    main.type = 'button';
    main.dataset.open = t.id;
    main.append(el('b', '', t.title));
    const sub = subline(t, showList, headed);
    if (sub.childElementCount) main.append(sub);
    r.append(tick, main);
    if (sortable) {
      const grip = el('button', 'grip');
      grip.type = 'button';
      grip.setAttribute('aria-label', `Move ${t.title}. Use the up and down arrow keys.`);
      grip.innerHTML = ICON.grip;
      r.append(grip);
    }
    return r;
  }
  const taskList = (tasks, showList, sortable, headed) => { const box = el('div', 'tasks'); box.append(...tasks.map(t => row(t, showList, sortable, headed))); return box; };
  // A section heading. A count only where the rows themselves are hidden.
  function head(text, actions = [], cls = '') {
    const h = el('div', `head ${cls}`);
    const name = el('span', '', text);
    name.setAttribute('role', 'heading');
    name.setAttribute('aria-level', '2');
    h.append(name);
    const acts = actions.filter(Boolean);
    if (acts.length) { const box = el('span', 'acts'); box.append(...acts); h.append(box); }
    return h;
  }
  // A heading's button. Its label says what it acts on, as "Hide" alone doesn't.
  function action(text, key, label, expanded) {
    const b = el('button', '', text);
    b.type = 'button';
    b.dataset[key] = '1';
    b.setAttribute('aria-label', label);
    if (expanded != null) b.setAttribute('aria-expanded', String(expanded));
    return b;
  }
  // Done today and Completed: shown, or folded away behind their count.
  const folded = (name, count, open, key, what, extra = []) =>
    head(open ? name : `${name} (${count})`, [...(open ? extra : []), action(open ? 'Hide' : 'Show', key, `${open ? 'Hide' : 'Show'} ${what}`, open)]);

  // ---- the three tabs ----
  let showDoneToday = false;
  // The day, and how far through it you are.
  function dayHead(left, done) {
    const h = el('div', 'day');
    const words = el('div');
    const name = el('span', 'day-name', new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(now()));
    name.setAttribute('role', 'heading');
    name.setAttribute('aria-level', '2');
    const all = left + done;
    words.append(name, el('p', 'day-sub', [new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long' }).format(now()), !all ? '' : left ? `${left} to do` : 'All done'].filter(Boolean).join(' \u00b7 ')));
    h.append(words);
    if (all) {
      const ring = el('div', left ? 'ring' : 'ring full');
      ring.setAttribute('role', 'img');
      ring.setAttribute('aria-label', `${done} of ${all} done today`);
      const C = 2 * Math.PI * 23;
      ring.innerHTML = `<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="23"/><circle class="arc" cx="28" cy="28" r="23" stroke-dasharray="${(C * done / all).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 28 28)"/></svg><span aria-hidden="true">${left ? left : ICON.tick}</span>`;
      h.append(ring);
    }
    return h;
  }
  // First run: what you type, and the task it turns into.
  function howTo() {
    const box = el('div', 'how');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', 'Type Call mum tomorrow 5pm #home and Nudge makes a task, Call mum, for tomorrow at 5 pm in Home.');
    const home = state.lists.find(l => l.name.toLowerCase() === 'home');
    box.innerHTML = `<p class="how-type" aria-hidden="true">Call mum <em>tomorrow 5pm</em> <em>#home</em></p>
      <div class="how-task" aria-hidden="true"><i></i><span><b>Call mum</b><small>Tomorrow, ${L.timeText('17:00', state.prefs.use24)}<u style="background:${home ? home.colour : 'var(--pos)'}"></u>Home</small></span></div>`;
    return box;
  }
  function renderToday() {
    const { overdue, today } = L.today(state.tasks, now());
    const out = [dayHead(overdue.length + today.length, L.doneToday(state.tasks, now()).length)];
    if (overdue.length) {
      const movable = overdue.some(t => L.canMove(t, now()));
      out.push(head('Overdue', [movable && action('Move to today', 'moveOverdue', 'Move overdue tasks to today')], 'late'), taskList(overdue));
    }
    const day = L.iso(now());
    // Without Overdue above it, the tab already says Today.
    if (today.length) out.push(...(overdue.length ? [head('Today')] : []), taskList(today, true, false, day));
    const done = L.doneToday(state.tasks, now());
    if (out.length === 1) {
      // Nothing for today: the next things due, so the day isn't a blank page.
      const next = L.upcoming(state.tasks, now()).days.flatMap(d => d.tasks).slice(0, 3);
      if (!state.tasks.some(t => !t.deleted)) out.push(howTo(), el('p', 'empty', 'Type a task below.'));
      else if (next.length && !done.length) out.push(head('Next up'), taskList(next));
      else if (!done.length) out.push(el('p', 'empty', 'Nothing due today.'));
    }
    if (done.length) {
      out.push(folded('Done today', done.length, showDoneToday, 'doneToday', 'tasks done today'));
      if (showDoneToday) out.push(taskList(done, true, false, day));
    }
    return out;
  }
  function renderUpcoming() {
    const { days, someday } = L.upcoming(state.tasks, now());
    // The week ahead: a dot under a day with something due, and a tap goes to it.
    const week = el('div', 'week');
    const due = new Map(days.map(d => [d.date, d.tasks.length]));
    const first = L.iso(now());
    for (let i = 0; i < 7; i++) {
      const date = L.addDays(first, i), n = due.get(date) || 0;
      const at = new Date(date + 'T12:00');
      const c = el(n ? 'button' : 'div', `wd${i ? '' : ' now'}${n ? ' has' : ''}`);
      if (n) { c.type = 'button'; c.dataset.day = date; c.setAttribute('aria-label', `${L.dayText(date, now())}, ${n} due`); }
      else c.setAttribute('aria-hidden', 'true');
      c.append(el('span', '', new Intl.DateTimeFormat('en-AU', { weekday: 'narrow' }).format(at)), el('b', '', String(at.getDate())), el('i'));
      week.append(c);
    }
    const out = [week];
    for (const d of days) { const h = head(L.dayText(d.date, now())); h.dataset.at = d.date; out.push(h, taskList(d.tasks, true, false, d.date)); }
    if (someday.length) out.push(head('No date'), taskList(someday));
    if (out.length === 1) out.push(el('p', 'empty', 'Nothing coming up.'));
    return out;
  }
  function renderLists() {
    const box = el('div', 'tiles');
    const count = id => state.tasks.filter(t => L.isOpen(t) && (t.list || null) === id).length;
    const line = (id, name, colour) => {
      const b = el('button', 'tile');
      b.type = 'button';
      b.dataset.list = id || 'inbox';
      const n = count(id);
      b.setAttribute('aria-label', `${name}, ${n} to do`);
      const d = el('i', 'dot');
      d.style.background = colour;
      const top = el('span', 'tile-top');
      top.append(d, el('span', n ? 'tile-n' : 'tile-n none', String(n)));
      b.append(top, el('span', 'tile-k', name));
      return b;
    };
    const add = el('button', 'tile adder');
    add.type = 'button';
    add.dataset.newList = '1';
    add.innerHTML = '<span class="tile-top"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg></span>';
    add.append(el('span', 'tile-k', 'New list'));
    box.append(line(null, 'Inbox', 'var(--line-strong)'), ...state.lists.map(l => line(l.id, l.name, l.colour)), add);
    return [box];
  }

  function render() {
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // Overdue has its own heading, so this always says the day.
    $('meta').textContent = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).format(now());
    fitMeta();
    $('view').replaceChildren(...{ today: renderToday, upcoming: renderUpcoming, lists: renderLists }[tab]());
    if ($('listPage').open) renderListPage();
    if ($('findPage').open) renderFind();
  }

  // With large text the date can't fit beside the tabs. Cut to "M…" it says nothing, so it goes.
  function fitMeta() {
    const m = $('meta');
    m.hidden = false;
    // Today says the day itself, in full.
    m.hidden = tab === 'today' || m.scrollWidth > m.clientWidth + 1;
  }
  window.addEventListener('resize', fitMeta);
  document.fonts?.ready.then(fitMeta);

  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    write('tab', tab);
    render();
    $('view').scrollTop = 0;
  });

  // Drawing again replaces the rows, and focus goes with them. It comes back to the
  // row, or the one that took its place, and only if it was on a row to begin with.
  function placeOf(r) {
    const region = r?.closest('#view, #listBody, #findBody');
    if (!region) return null;
    const ids = [...region.querySelectorAll('.task')].map(x => x.dataset.id);
    const i = ids.indexOf(r.dataset.id);
    return { region, id: r.dataset.id, done: r.classList.contains('done'), next: [ids[i + 1], ids[i - 1]].filter(Boolean) };
  }
  // [same] says whether the row itself counts if it's still there, given whether it's done now.
  function refocus(place, key, same = () => true) {
    if (!place) return;
    const find = id => place.region.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
    const here = find(place.id);
    const r = here && same(here.classList.contains('done')) ? here : place.next.map(find).find(Boolean);
    r?.querySelector(`[data-${key}]`)?.focus();
  }

  // Ticks and rows work the same everywhere they're drawn.
  function toggle(id) {
    const before = task(id);
    if (!before) return;
    haptic();
    // A row that's moved to Done or back isn't where the list was going: the next one is.
    const place = placeOf(document.activeElement?.closest('.task'));
    const back = () => refocus(place, 'tick', done => done === place.done);
    if (before.done) { setTask(id, { done: null }); render(); return back(); }
    const after = L.complete(before, now());
    state.tasks = state.tasks.map(t => (t.id === id ? after : t));
    commit();
    back();
    say(after.done ? 'Done' : `Next: ${L.dayText(after.due, now())}`, () => { state.tasks = state.tasks.map(t => (t.id === id ? before : t)); commit(); });
  }
  document.addEventListener('click', e => {
    const tick = e.target.closest('[data-tick]');
    if (tick) return toggle(tick.dataset.tick);
    const open = e.target.closest('[data-open]');
    if (open) return openTask(open.dataset.open);
    const day = e.target.closest('[data-day]');
    if (day) return $('view').querySelector(`[data-at="${day.dataset.day}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const list = e.target.closest('[data-list]');
    if (list) return openList(list.dataset.list === 'inbox' ? null : list.dataset.list);
    if (e.target.closest('[data-new-list]')) return newList();
    if (e.target.closest('[data-done-today]')) { showDoneToday = !showDoneToday; return render(); }
    if (e.target.closest('[data-move-overdue]')) {
      // Undo puts back only these dates, not anything done since.
      const day = L.iso(now());
      const was = new Map(state.tasks.filter(t => L.canMove(t, now())).map(t => [t.id, t.due]));
      state.tasks = L.moveOverdue(state.tasks, now());
      commit();
      return say('Moved to today', () => {
        state.tasks = state.tasks.map(t => (was.has(t.id) && t.due === day ? { ...t, due: was.get(t.id) } : t));
        commit();
      });
    }
    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  });

  // ---- quick add ----
  // The iPhone can't ring like a call, so three marks there mean urgent and no more.
  function parseQuick(text) {
    const q = L.parseQuick(text, now(), state.lists, { use24: state.prefs.use24 });
    if (ios) q.loud = false;
    return q;
  }
  function previewText(q) {
    const bits = [];
    if (q.due) bits.push(L.dayText(q.due, now()));
    if (q.time) bits.push(L.timeText(q.time, state.prefs.use24));
    if (q.repeat) bits.push(L.repeatText(q.repeat));
    if (q.listName) bits.push(listOf(q.list)?.name || `New list: ${q.listName}`);
    if (q.pri) bits.push(q.pri === 2 ? 'Urgent' : 'High');
    if (q.remind != null) bits.push(L.reminderText({ before: q.remind }, now(), state.prefs.use24, q.time));
    if (q.loud) bits.push('Rings like a call');
    return bits.join(' · ');
  }
  function addFrom(text, list) {
    const q = parseQuick(text);
    if (!q.title) return null;
    if (q.listName && !q.list) {
      const made = { id: L.newId(now()), name: q.listName[0].toUpperCase() + q.listName.slice(1), colour: COLOURS[state.lists.length % COLOURS.length] };
      state.lists = [...state.lists, made];
      q.list = made.id;
    }
    const t = L.makeTask({ ...q, list: q.list || list || null }, now(), state.prefs);
    state.tasks = [...state.tasks, t];
    commit();
    return t;
  }
  function preview() {
    const text = previewText(parseQuick($('quickBox').value));
    $('preview').hidden = !text;
    $('preview').textContent = text;
  }
  // Half typed, it's still there if the app is closed or reloaded.
  $('quickBox').value = read('draft') || '';
  if ($('quickBox').value) preview();
  $('quickBox').addEventListener('input', () => { write('draft', $('quickBox').value); preview(); });
  $('quick').addEventListener('submit', e => {
    e.preventDefault();
    const t = addFrom($('quickBox').value);
    if (!t) return;
    $('quickBox').value = '';
    write('draft', '');
    $('preview').hidden = true;
    // Show where it went, if that isn't on the tab in view.
    const here = tab === 'lists' || (tab === 'today' ? t.due && t.due <= L.iso(now()) : !t.due || t.due > L.iso(now()));
    if (!here) say(t.due ? `Added for ${L.dayText(t.due, now())}` : 'Added with no date');
  });

  // ---- one list ----
  // Edit mode brings the name, the colours, Delete and the drag handles.
  let openListId;
  let showDone = false, listEditing = false, draft = null, editName = '';
  // New list's list is only saved once it's named, coloured, given a task or kept with
  // Done, so backing out, or the app closing, leaves nothing behind.
  const pageList = () => listOf(openListId) || (draft?.id === openListId ? draft : null);
  function keepDraft() {
    if (!draft) return;
    state.lists = [...state.lists, draft];
    draft = null;
  }
  function renderListPage() {
    const list = pageList();
    $('listTitle').textContent = list ? list.name : 'Inbox';
    const mine = state.tasks.filter(t => !t.deleted && (t.list || null) === openListId);
    const open = L.listOrder(mine.filter(t => !t.done));
    const done = mine.filter(t => t.done).sort((a, b) => b.done - a.done);
    listEditing = listEditing && !!list;
    $('listEdit').hidden = !list;
    $('listEdit').textContent = listEditing ? 'Done' : 'Edit';
    $('listShare').hidden = listEditing || !open.length;
    $('listDelete').hidden = !listEditing || !!draft;
    $('listForm').hidden = !listEditing;
    if (listEditing) drawSwatches(list.colour);
    const out = [];
    out.push(open.length ? taskList(open, false, listEditing) : el('p', 'empty', 'Nothing here yet.'));
    if (done.length) {
      out.push(folded('Completed', done.length, showDone, 'doneToggle', 'completed tasks', [action('Clear', 'clearDone', 'Clear completed tasks')]));
      if (showDone) out.push(taskList(done, false));
    }
    $('listBody').replaceChildren(...out);
  }
  function openList(id, editing = false) {
    openListId = id;
    showDone = false;
    listEditing = editing;
    editName = pageList()?.name || '';
    $('listName').value = editName;
    renderListPage();
    show('listPage');
  }
  // It opens ready to name, the name selected to type over.
  function newList() {
    draft = { id: L.newId(now()), name: 'New list', colour: COLOURS[state.lists.length % COLOURS.length] };
    openList(draft.id, true);
    if (ios) return;
    $('listName').focus();
    $('listName').select();
  }
  function setList(change) {
    if (draft) { draft = { ...draft, ...change }; keepDraft(); return; }
    state.lists = state.lists.map(l => (l.id === openListId ? { ...l, ...change } : l));
  }
  $('listEdit').addEventListener('click', () => {
    if (listEditing) keepDraft();   // Done keeps a new list, even unnamed
    listEditing = !listEditing;
    editName = pageList()?.name || '';
    $('listName').value = editName;
    commit();
  });
  // Changes save as they're made. Emptied, the name goes back to what it was.
  $('listName').addEventListener('input', () => {
    const name = $('listName').value.trim() || editName;
    $('listTitle').textContent = name;
    if (pageList()?.name === name) return;
    setList({ name });
    saveSoon();
  });
  $('listNameForm').addEventListener('submit', e => { e.preventDefault(); $('listName').blur(); });
  function drawSwatches(current) {
    $('listColours').replaceChildren(...COLOURS.map((c, i) => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.style.background = c;
      b.dataset.colour = c;
      b.setAttribute('aria-pressed', String(c === current));
      b.setAttribute('aria-label', `Colour ${i + 1}`);
      return b;
    }));
  }
  $('listColours').addEventListener('click', e => {
    const b = e.target.closest('[data-colour]');
    if (!b) return;
    setList({ colour: b.dataset.colour });
    save();
    drawSwatches(b.dataset.colour);
  });
  $('listPage').addEventListener('close', () => {
    draft = null;
    listEditing = false;
    commit();
  });
  $('listBody').addEventListener('click', e => {
    if (e.target.closest('[data-clear-done]')) {
      const stamp = +now();
      state.tasks = state.tasks.map(t => (t.done && !t.deleted && (t.list || null) === openListId ? { ...t, deleted: stamp } : t));
      commit();
      return say('Cleared', () => { state.tasks = state.tasks.map(t => (t.deleted === stamp ? { ...t, deleted: null } : t)); commit(); });
    }
    if (!e.target.closest('[data-done-toggle]')) return;
    showDone = !showDone;
    renderListPage();
  });

  // Rows move by the grip, or by the arrow keys on it.
  let lifted = null;
  const openRows = () => [...$('listBody').querySelectorAll('.task.sortable')];
  function placeRow(ids) {
    const order = new Map(ids.map((id, i) => [id, i]));
    state.tasks = state.tasks.map(t => (order.has(t.id) ? { ...t, order: order.get(t.id) } : t));
    // An Undo from before the drag would put a task back in an old place.
    undo = null;
    $('toast').hidden = true;
    save();
    renderListPage();
  }
  $('listBody').addEventListener('pointerdown', e => {
    const grip = e.target.closest('.grip');
    if (!grip) return;
    const r = grip.closest('.task');
    const rows = openRows();
    grip.setPointerCapture(e.pointerId);
    r.classList.add('lifted');
    const middle = x => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; };
    lifted = { id: e.pointerId, r, rows, from: rows.indexOf(r), to: rows.indexOf(r), y: e.clientY, h: r.getBoundingClientRect().height, centres: rows.map(middle) };
  });
  $('listBody').addEventListener('pointermove', e => {
    if (!lifted || e.pointerId !== lifted.id) return;
    const { r, rows, from, h, centres } = lifted;
    const dy = e.clientY - lifted.y;
    r.style.transform = `translateY(${dy}px)`;
    // Its place is however many rows it has passed, whatever their heights.
    lifted.to = centres.filter((c, i) => i !== from && c < centres[from] + dy).length;
    rows.forEach((x, i) => {
      if (x === r) return;
      const shift = i > from && i <= lifted.to ? -h : i < from && i >= lifted.to ? h : 0;
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });
  function dropRow(e) {
    if (!lifted || e.pointerId !== lifted.id) return;
    const { rows, from, to } = lifted;
    lifted = null;
    const ids = rows.map(x => x.dataset.id);
    if (e.type === 'pointerup' && to !== from) { ids.splice(to, 0, ...ids.splice(from, 1)); haptic(); placeRow(ids); } else renderListPage();
  }
  $('listBody').addEventListener('pointerup', dropRow);
  $('listBody').addEventListener('pointercancel', dropRow);
  $('listBody').addEventListener('keydown', e => {
    const grip = e.target.closest('.grip');
    const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!grip || !step) return;
    e.preventDefault();
    const ids = openRows().map(x => x.dataset.id);
    const from = ids.indexOf(grip.closest('.task').dataset.id);
    const to = Math.max(0, Math.min(ids.length - 1, from + step));
    ids.splice(to, 0, ...ids.splice(from, 1));
    placeRow(ids);
    openRows()[to].querySelector('.grip').focus();
  });

  $('listShare').addEventListener('click', () => {
    const list = listOf(openListId);
    const name = list ? list.name : 'Inbox';
    const lines = L.listOrder(state.tasks.filter(t => L.isOpen(t) && (t.list || null) === openListId)).map(t => `- ${t.title}`);
    const text = [name, ...lines].join('\n');
    if (app) return toApp({ type: 'share', title: name, text });
    if (navigator.share) return navigator.share({ text }).catch(() => {});
    navigator.clipboard?.writeText(text).then(() => say('Copied'), () => {});
  });
  $('listQuick').addEventListener('submit', e => {
    e.preventDefault();
    if (!$('listBox').value.trim()) return;
    keepDraft();
    if (addFrom($('listBox').value, openListId)) $('listBox').value = '';
  });
  // Its tasks go to the Inbox rather than vanish, and it asks first, saying so.
  $('listDelete').addEventListener('click', () => {
    const list = listOf(openListId);
    if (!list) return;
    const n = state.tasks.filter(t => !t.deleted && t.list === list.id).length;
    $('askTitle').textContent = `Delete ${list.name}?`;
    $('askText').textContent = n ? `Its ${n === 1 ? 'task moves' : `${n} tasks move`} to Inbox.` : 'It has no tasks.';
    show('listAsk');
  });
  $('listAsk').addEventListener('click', e => { if (e.target.closest('[data-cancel]')) $('listAsk').close(); });
  $('askDelete').addEventListener('click', () => {
    const id = openListId;
    state.lists = state.lists.filter(l => l.id !== id);
    state.tasks = state.tasks.map(t => (t.list === id ? { ...t, list: null, order: undefined } : t));
    $('listAsk').close();
    $('listPage').close();
    commit();
  });

  // ---- one task ----
  let editing = null;
  function openTask(id) {
    const t = task(id);
    if (!t) return;
    editing = id;
    $('fTitle').value = t.title;
    $('fNotes').value = t.notes;
    $('fDue').value = t.due || '';
    $('fTime').value = t.time || '';
    // Quick add can make repeats the menu doesn't list, like every 3 days. One
    // added for another task goes, so it isn't offered here.
    const repeat = t.repeat ? `${t.repeat.every || 1} ${t.repeat.unit}` : '';
    for (const o of $('fRepeat').querySelectorAll('[data-extra]')) if (o.value !== repeat) o.remove();
    if (repeat && ![...$('fRepeat').options].some(o => o.value === repeat)) {
      const o = el('option', '', L.repeatText(t.repeat));
      o.value = repeat;
      o.dataset.extra = '1';
      $('fRepeat').append(o);
    }
    $('fRepeat').value = repeat === '1 days' ? '1 days' : repeat;
    $('fUntil').value = t.repeat?.until || '';
    $('fLoud').checked = !!t.loud;
    $('fPri').value = String(t.pri);
    $('fList').replaceChildren(el('option', '', 'Inbox'), ...state.lists.map(l => { const o = el('option', '', l.name); o.value = l.id; return o; }));
    $('fList').firstChild.value = '';
    $('fList').value = t.list || '';
    $('fCustomRow').hidden = true;
    $('taskDelete').textContent = 'Delete';
    drawTaskExtras();
    $('taskPage').querySelector('.page-body').scrollTop = 0;   // each task opens at its title
    show('taskPage');
    // Sized once the page is showing; hidden, it measures nothing.
    requestAnimationFrame(fitNotes);
  }
  function drawTaskExtras() {
    const t = task(editing);
    $('fUntilWrap').hidden = !t.repeat;
    $('fUntil').value = t.repeat?.until || '';
    $('fUntil').min = t.due || '';
    // With no reminder there's nothing to ring like a call, so both read as off.
    const loud = !!t.loud && t.reminders.length > 0;
    $('fLoud').checked = loud;
    // Ringing like a call nudges by itself, so this shows what it will really do.
    $('fNag').value = String(L.nagOf({ ...t, loud }));
    $('fNag').disabled = loud;
    renderLoudFix();
    $('fUntil').value = t.repeat?.until || '';
    const days = t.repeat?.unit === 'days' ? t.repeat.days || [] : null;
    $('fDaysRow').hidden = !days;
    if (days) {
      $('fDays').replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map(d => {
        const b = el('button', '', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]);
        b.type = 'button';
        b.dataset.day = d;
        b.setAttribute('aria-pressed', String(days.includes(d)));
        return b;
      }));
    }
    $('fReminders').replaceChildren(...t.reminders.map((r, i) => {
      const text = L.reminderText(r, now(), state.prefs.use24, t.time);
      const row = el('div', 'row');
      const b = el('button', 'row-x');
      b.type = 'button';
      b.dataset.dropReminder = i;
      b.setAttribute('aria-label', `Remove reminder: ${text}`);
      b.innerHTML = ICON.cross;
      row.append(el('span', 'row-k', text), b);
      return row;
    }));
    $('fSubs').replaceChildren(...t.subs.map(s => {
      const r = el('div', s.done ? 'row step done' : 'row step');
      const tick = el('button', 'tick');
      tick.type = 'button';
      tick.dataset.stepTick = s.id;
      tick.setAttribute('aria-label', `Mark ${s.title} ${s.done ? 'not done' : 'done'}`);
      tick.innerHTML = `<i>${ICON.tick}</i>`;
      const x = el('button', 'step-x');
      x.type = 'button';
      x.dataset.stepDrop = s.id;
      x.setAttribute('aria-label', `Remove ${s.title}`);
      x.innerHTML = ICON.cross;
      r.append(tick, el('span', '', s.title), x);
      return r;
    }));
    rowValues(t);
  }
  // Each row shows its value on the right, or a quiet None.
  const chosen = sel => sel.selectedOptions[0]?.textContent || '';
  function value(id, text, set = !!text) {
    $(id).textContent = text || 'None';
    $(id).classList.toggle('set', set);
  }
  function rowValues(t) {
    value('vDue', t.due ? L.dayText(t.due, now()) : '');
    value('vTime', L.timeText(t.time, state.prefs.use24));
    value('vRepeat', chosen($('fRepeat')), !!t.repeat);
    value('vUntil', t.repeat?.until ? L.dayText(t.repeat.until, now()) : 'Never', !!t.repeat?.until);
    value('vNag', chosen($('fNag')), $('fNag').value !== '0');
    value('vList', chosen($('fList')), true);
    value('vPri', chosen($('fPri')), t.pri > 0);
    $('xDue').hidden = !t.due;
    $('xTime').hidden = !t.time;
    $('xUntil').hidden = !t.repeat?.until;
  }
  function fitNotes() { $('fNotes').style.height = ''; $('fNotes').style.height = `${$('fNotes').scrollHeight}px`; }
  // A clear button empties its field as if it had been cleared by hand.
  for (const [x, field] of [['xDue', 'fDue'], ['xTime', 'fTime'], ['xUntil', 'fUntil']]) {
    // Focus stays on the row, as the button that was pressed goes away.
    $(x).addEventListener('click', () => { $(field).value = ''; $(field).dispatchEvent(new Event('change')); if (!ios) $(field).focus(); });
  }
  // Tapping anywhere on a date or time row opens its picker, on a computer too.
  for (const input of document.querySelectorAll('input.over')) {
    input.addEventListener('click', () => { try { input.showPicker(); } catch {} });
  }
  $('fNotes').addEventListener('input', fitNotes);
  const edit = change => {
    const t = L.edited(task(editing), change);
    // Ringing like a call goes with the last reminder, or adding one later would bring it back unseen.
    if (t.loud && !t.reminders.length) t.loud = false;
    setTask(editing, t);
    drawTaskExtras();
  };
  // Changes save as they're made, so there's no Save to miss.
  $('fTitle').addEventListener('input', () => { const v = $('fTitle').value.trim(); if (v) setTask(editing, { title: v }, true); });
  $('fNotes').addEventListener('input', () => setTask(editing, { notes: $('fNotes').value }, true));
  $('fDue').addEventListener('change', () => {
    const due = $('fDue').value || null;
    const t = task(editing);
    const change = { due };
    if (!due) {
      change.time = null;
      change.repeat = null;
      change.reminders = t.reminders.filter(r => r.before == null);   // nothing left to count back from
      $('fTime').value = '';
      $('fRepeat').value = '';
    } else if (t.repeat?.dom) change.repeat = { ...t.repeat, dom: L.parseDay(due).getDate() };
    if (due && t.repeat) { change.due = L.fitToDays(due, t.repeat); $('fDue').value = change.due; }
    if (due && !t.due && !t.reminders.length && state.prefs.defaultReminder != null) change.reminders = [{ before: state.prefs.defaultReminder }];
    edit(change);
  });
  $('fTime').addEventListener('change', () => {
    const time = $('fTime').value || null;
    const t = task(editing);
    const change = { time };
    if (time && !t.due) { change.due = L.iso(now()); $('fDue').value = change.due; }
    edit(change);
  });
  $('fRepeat').addEventListener('change', () => {
    const v = $('fRepeat').value;
    const t = task(editing);
    if (!v) return edit({ repeat: null });
    const [every, unit] = v.split(' ');
    const repeat = { every: Number(every), unit, until: t.repeat?.until || undefined };
    const due = L.fitToDays(t.due || L.iso(now()), repeat);
    $('fDue').value = due;
    repeat.dom = L.parseDay(due).getDate();
    if (unit === 'days') repeat.days = [L.parseDay(due).getDay()];
    edit({ due, repeat });
  });
  $('fDays').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const t = task(editing), day = Number(b.dataset.day), days = t.repeat.days || [];
    const next = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    if (!next.length) return;   // a repeat needs at least one day
    const repeat = { ...t.repeat, days: next };
    const due = L.fitToDays(t.due, repeat);
    $('fDue').value = due;
    edit({ repeat, due });
  });
  $('fUntil').addEventListener('change', () => {
    const t = task(editing);
    if (t.repeat) edit({ repeat: { ...t.repeat, until: $('fUntil').value || undefined } });
  });
  $('fAddReminder').addEventListener('change', () => {
    const v = $('fAddReminder').value;
    $('fAddReminder').value = '';
    if (!v) return;
    if (v === 'custom') { $('fCustomRow').hidden = false; $('fCustom').focus(); try { $('fCustom').showPicker(); } catch {} return; }
    const t = task(editing);
    const before = Number(v);
    if (t.reminders.some(r => r.before === before)) return;
    // A reminder needs something to count back from.
    const change = { reminders: [...t.reminders, { before }] };
    if (!t.due) { change.due = L.iso(now()); $('fDue').value = change.due; }
    edit(change);
  });
  // An iPhone's picker says it has changed at every touch of it, so there the
  // reminder is added once the picker is put away.
  $('fCustom').addEventListener(ios ? 'blur' : 'change', () => {
    const at = $('fCustom').value;
    const t = task(editing);
    if (!at || !t) return;
    $('fCustom').value = '';
    $('fCustomRow').hidden = true;
    edit({ reminders: [...t.reminders, { at }] });
    // Put away by leaving the task: its row is already drawn, so it's drawn again.
    if (!$('taskPage').open) render();
  });
  $('fReminders').addEventListener('click', e => {
    const b = e.target.closest('[data-drop-reminder]');
    if (!b) return;
    const t = task(editing);
    edit({ reminders: t.reminders.filter((_, i) => i !== Number(b.dataset.dropReminder)) });
  });
  $('fNag').addEventListener('change', () => edit({ nag: Number($('fNag').value) }));
  $('fLoud').addEventListener('change', () => {
    const t = task(editing);
    const change = { loud: $('fLoud').checked };
    // It needs a moment to ring at.
    if (change.loud && !t.reminders.length) {
      change.reminders = [{ before: 0 }];
      if (!t.due) { change.due = L.iso(now()); $('fDue').value = change.due; }
    }
    // If its time has gone by, it rings in 5 minutes, as its nudging would.
    if (change.loud) change.reminders = L.ensureRing({ ...t, ...change }, now(), L.LOUD_NAG).reminders;
    edit(change);
  });
  $('fPri').addEventListener('change', () => edit({ pri: Number($('fPri').value) }));
  // Its place in the old list means nothing in the new one.
  $('fList').addEventListener('change', () => edit({ list: $('fList').value || null, order: undefined }));
  $('fSubForm').addEventListener('submit', e => {
    e.preventDefault();
    const title = $('fSubBox').value.trim();
    if (!title) return;
    $('fSubBox').value = '';
    edit({ subs: [...task(editing).subs, { id: L.newId(now()), title, done: false }] });
  });
  $('fSubs').addEventListener('click', e => {
    const tick = e.target.closest('[data-step-tick]'), drop = e.target.closest('[data-step-drop]');
    const t = task(editing);
    if (tick) edit({ subs: t.subs.map(s => (s.id === tick.dataset.stepTick ? { ...s, done: !s.done } : s)) });
    if (drop) edit({ subs: t.subs.filter(s => s.id !== drop.dataset.stepDrop) });
  });
  $('taskDelete').addEventListener('click', () => {
    const id = editing;
    setTask(id, { deleted: +now() });
    $('taskPage').close();   // which draws the screen again
    say('Deleted', () => { setTask(id, { deleted: null }); render(); });
  });
  $('taskPage').addEventListener('close', () => {
    // Back to its row, unless focus has gone somewhere else, like the add box.
    const a = document.activeElement;
    const fromList = !a || a === document.body || $('taskPage').contains(a) || a.closest('.task');
    const top = openDialog();
    const region = top ? top.querySelector('#listBody, #findBody') : $('view');
    const place = fromList ? placeOf(region?.querySelector(`.task[data-id="${CSS.escape(editing)}"]`)) : null;
    saveNow();
    render();
    refocus(place, 'open');
  });

  // ---- search ----
  function renderFind() {
    const hits = L.search(state.tasks, $('findBox').value);
    $('findBody').replaceChildren(...(hits.length ? [taskList(hits)] : $('findBox').value.trim() ? [el('p', 'empty', 'Nothing matches.')] : []));
  }
  $('searchBtn').addEventListener('click', () => {
    $('findBox').value = '';
    renderFind();
    show('findPage');
    if (!ios) $('findBox').focus();
  });
  $('findBox').addEventListener('input', renderFind);

  // ---- settings ----
  let health = null, askExact = false;
  function renderHealth() {
    $('healthBox').hidden = !health;
    const warning = L.reminderWarning(health, askExact);
    // While Ring on time? asks, the banner would only say it again.
    $('warn').hidden = !warning || $('exactAsk').open || !state.tasks.some(t => L.isOpen(t) && t.reminders.length);
    $('warn').textContent = warning || '';
    if (!health) return;
    const line = (name, ok, what) => {
      const r = el('div', 'check');
      r.append(el('span', '', name));
      if (ok) r.append(el('b', '', 'On'));
      else {
        const b = el('button', 'tool', 'Turn on');
        b.type = 'button';
        b.addEventListener('click', () => toApp({ type: 'openSettings', what }));
        r.append(b);
      }
      return r;
    };
    if (ios) return $('health').replaceChildren(line('Notifications', health.notifications, 'notifications'));
    $('health').replaceChildren(
      line('Notifications', health.notifications, 'notifications'),
      line('Exact alarms', health.exact, 'alarms'),
      line('No battery limits', health.battery, 'battery'),
      line('Full-screen alarms', health.fullScreen, 'fullscreen'),
      line('Show over other apps', health.overlay, 'overlay'),
    );
  }
  $('warn').addEventListener('click', () => openSettings());

  // Says why before Android's settings page opens, and takes no for an answer.
  function askForExact() {
    const hasReminders = state.tasks.some(t => L.isOpen(t) && t.reminders.length);
    if (!L.shouldAskExact(health, askExact, hasReminders, read('askedExact'))) return;
    write('askedExact', true);
    show('exactAsk');
    renderHealth();
  }
  $('exactAsk').addEventListener('close', renderHealth);
  $('exactLater').addEventListener('click', () => $('exactAsk').close());
  $('exactGo').addEventListener('click', () => { $('exactAsk').close(); toApp({ type: 'openSettings', what: 'alarms' }); });

  function renderLoudFix() {
    const need = editing && task(editing)?.loud ? L.loudBlocker(health, askExact) : null;
    $('fLoudFix').hidden = !need;
    if (need) $('fLoudFix').textContent = need.text;
  }
  $('fLoudFix').addEventListener('click', () => {
    const need = L.loudBlocker(health, askExact);
    if (need) toApp({ type: 'openSettings', what: need.what });
  });
  function openSettings() {
    $('sDefault').value = state.prefs.defaultReminder == null ? '' : String(state.prefs.defaultReminder);
    $('sSummary').value = state.prefs.summary || '';
    $('s24').checked = !!state.prefs.use24;
    settingsValues();
    renderTrash();
    renderHealth();
    show('settingsPage');
  }
  function renderTrash() {
    const gone = state.tasks.filter(t => t.deleted).sort((a, b) => b.deleted - a.deleted).slice(0, 30);
    $('trashBox').hidden = !gone.length;
    $('trash').replaceChildren(...gone.map(t => {
      const r = el('div', 'check');
      r.append(el('span', '', t.title));
      const b = el('button', 'tool', 'Restore');
      b.type = 'button';
      b.addEventListener('click', () => { setTask(t.id, { deleted: null }); renderTrash(); render(); });
      r.append(b);
      return r;
    }));
  }
  $('settingsBtn').addEventListener('click', openSettings);
  const pref = change => { state.prefs = { ...state.prefs, ...change }; commit(); };
  function settingsValues() {
    value('vDefault', chosen($('sDefault')), $('sDefault').value !== '');
    value('vSummary', chosen($('sSummary')), $('sSummary').value !== '');
  }
  $('sDefault').addEventListener('change', () => { pref({ defaultReminder: $('sDefault').value === '' ? null : Number($('sDefault').value) }); settingsValues(); });
  $('sSummary').addEventListener('change', () => { pref({ summary: $('sSummary').value || null }); settingsValues(); });
  $('s24').addEventListener('change', () => pref({ use24: $('s24').checked }));

  // ---- Android app bridge (absent in a browser) ----
  const stack = [];
  // A dialog opens with its first button focused, which a phone then rings in
  // the accent colour as if a keyboard had found it. On touch the page itself
  // takes the focus instead.
  const touch = matchMedia('(hover: none)');
  function show(id) {
    const d = $(id);
    if (!d.open) {
      d.showModal(); stack.push(d);
      if (touch.matches) { d.tabIndex = -1; d.focus({ preventScroll: true }); }
    }
    tellBack();
  }
  // The one on top, whichever order they sit in the page.
  function openDialog() {
    while (stack.length && !stack[stack.length - 1].open) stack.pop();
    return stack[stack.length - 1];
  }
  function toApp(msg) {
    if (!app) return;
    try { app.postMessage(JSON.stringify(msg)); } catch {}
  }
  function haptic() { toApp({ type: 'haptic' }); }
  window.nudgeBack = () => {
    const d = openDialog();
    if (d) { d.close(); return true; }
    return false;
  };
  function tellBack() { toApp({ type: 'back', enabled: !!openDialog() }); }
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', tellBack);

  // selfUpdates is off until the app says otherwise: Play builds update through
  // the store, so there About has no row to check for one.
  let selfUpdates = false, updateReady = false, versionTimer = 0, updateVersion = '', updateSize = 0;
  // Top right says About, or that an update is waiting; the About page has the rest.
  function showLabel() {
    $('version').textContent = updateReady ? 'Update available' : 'About';
    $('version').dataset.state = updateReady ? 'available' : '';
    if (updateReady) showNote('Available');
  }
  function showNote(text) {
    clearTimeout(versionTimer);
    $('aboutNote').textContent = text;
  }
  function showUpdate(m) {
    const setShown = (id, on) => { $(id).hidden = !on; };
    $('updateCard').hidden = false;
    if (m.state === 'available') {
      updateVersion = m.version || updateVersion;
      updateSize = m.size > 0 ? m.size : updateSize;
      const notes = Array.isArray(m.notes) ? m.notes.filter(n => typeof n === 'string' && n).slice(0, 5) : [];
      $('updateNotes').replaceChildren(...notes.map(n => el('li', '', n)));
    }
    const v = {
      available: { title: 'Update available', msg: '', actions: true, progress: false, go: 'Update' },
      downloading: { title: 'Downloading update', msg: '', actions: false, progress: true },
      installing: { title: 'Installing update', actions: false, progress: false, msg: 'Confirm on the next screen. The first time, allow installs from Nudge, then go back.' },
      failed: { title: 'Update didn’t finish', msg: m.message || 'Something went wrong. Try again.', actions: true, progress: false, go: 'Try again' },
    }[m.state];
    if (!v) return;
    // What's new and its size help decide; once it's under way they're just in the way.
    setShown('updateSub', m.state === 'available');
    setShown('updateNotes', m.state === 'available' && $('updateNotes').childElementCount > 0);
    $('updateTitle').textContent = v.title;
    $('updateSub').textContent = [`Nudge ${updateVersion}`, updateSize ? `${(updateSize / 1e6).toFixed(1)} MB` : ''].filter(Boolean).join(' · ');
    $('updateMsg').textContent = v.msg;
    setShown('updateMsg', !!v.msg);
    setShown('updateActions', v.actions);
    setShown('updateProgress', v.progress);
    if (v.go) $('updateGo').textContent = v.go;
    if (v.progress) {
      const p = m.state === 'installing' ? 100 : Math.round(Math.max(0, Math.min(1, m.progress || 0)) * 100);
      $('updateBar').style.width = p + '%';
      $('updatePct').textContent = p + '%';
    }
  }
  function takeActions(actions) {
    if (!Array.isArray(actions) || !actions.length) return;
    state = L.applyActions(state, actions, now());
    commit();
  }
  if (app) {
    app.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'state') {
        if (m.state) { try { state = L.tidy(L.cleanState(JSON.parse(m.state)), Date.now()); } catch {} }
        takeActions(m.actions);
        save();
        render();
      } else if (m.type === 'actions') takeActions(m.actions);
      else if (m.type === 'health') {
        health = m;
        renderHealth();
        renderLoudFix();
        askForExact();
      } else if (m.type === 'open') {
        if (m.task) openTask(m.task);
      } else if (m.type === 'focusAdd') {
        while (window.nudgeBack());
        $('quickBox').focus();
      } else if (m.type === 'info') {
        selfUpdates = m.updates === true;
        askExact = m.askExact === true;
        $('aboutVer').textContent = m.version ? 'Version ' + m.version : '';
        $('aboutVer').hidden = !m.version;
        $('aboutApp').hidden = !selfUpdates;
        showLabel();
      } else if (m.type === 'updateStatus' && selfUpdates) {
        if (m.state === 'available') { updateReady = true; return showLabel(); }
        showNote(m.state === 'latest' ? 'Up to date' : 'Couldn’t check');
        versionTimer = setTimeout(() => showNote(''), 4000);
      } else if (m.type === 'update' && selfUpdates) {
        if (m.state === 'available') { updateReady = true; showLabel(); }
        showUpdate(m);
      }
    };
    $('updateGo').addEventListener('click', () => { showUpdate({ state: 'downloading', progress: 0 }); toApp({ type: 'installUpdate' }); });
    $('updateLater').addEventListener('click', () => { $('updateCard').hidden = true; });
    $('aboutCheck').addEventListener('click', () => {
      if (updateReady) { $('aboutPage').close(); $('updateCard').hidden = false; return; }
      showNote('Checking…');
      toApp({ type: 'checkUpdate' });
    });
  }
  $('version').addEventListener('click', () => show('aboutPage'));

  // A new day while the app sits open.
  let shown = L.iso(now());
  function checkDay() {
    if (L.iso(now()) !== shown) { shown = L.iso(now()); commit(); }
  }
  setInterval(() => { if (!document.hidden) checkDay(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

  // ---- boot ----
  // An iPhone can't hand its screen to a reminder, so the switch for it isn't offered.
  if (ios) $('fLoud').closest('.row').hidden = true;
  // A phone lets a reminder ring only so many times unanswered.
  if (ios) $('fNag').setAttribute('aria-label', 'Keep nudging');
  if (ios) for (const o of $('fNag').options) if (o.value !== '0') o.textContent += ', 3 more times';
  // Hello goes first, so a bad local copy can't stop the phone's good one arriving.
  if (app) toApp({ type: 'hello' }); else write('state', state);
  render();
})();
