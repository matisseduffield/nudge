(() => {
  const L = window.NudgeLib;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const app = window.nudgeApp || null;

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

  function save() {
    write('state', state);
    const open = state.tasks.filter(L.isOpen);
    const t = L.today(state.tasks, now());
    const items = [...t.overdue, ...t.today];
    toApp({ type: 'save', state: JSON.stringify(state), alarms: L.schedule(state, now()), widget: { day: L.iso(now()), items: items.map(x => ({ id: x.id, title: x.title })) } });
    if (app && open.some(x => x.reminders.length) && health && !health.notifications && !read('askedNotify')) {
      write('askedNotify', true);
      toApp({ type: 'askNotifications' });
    }
  }
  function commit() { save(); render(); }

  function setTask(id, change) {
    state.tasks = state.tasks.map(t => (t.id === id ? { ...t, ...change } : t));
    save();
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
    if (page) page.append($('toast')); else document.querySelector('footer').prepend($('toast'));
    toastTimer = setTimeout(() => { $('toast').hidden = true; undo = null; }, 5000);
  }
  $('toastUndo').addEventListener('click', () => {
    if (undo) undo();
    undo = null;
    $('toast').hidden = true;
  });

  // ---- drawing a task ----
  function subline(t, showList = true) {
    const sub = el('div', 'sub');
    const day = L.iso(now());
    if (t.due) {
      // Under Today, "Today" goes without saying.
      const plain = tab === 'today' && t.due === day && !$('listPage').open && !$('findPage').open;
      const when = [plain ? '' : L.dayText(t.due, now()), L.timeText(t.time, state.prefs.use24)].filter(Boolean).join(', ');
      if (when) sub.append(el('span', !t.done && t.due < day ? 'late' : '', when));
    }
    if (t.repeat) { const s = el('span'); s.innerHTML = ICON.repeat; s.append(L.repeatText(t.repeat)); sub.append(s); }
    if (t.reminders.length) {
      const s = el('span', t.loud ? 'loud' : '');
      s.innerHTML = ICON.bell;
      if (t.loud) s.append('Rings like a call');
      else if (t.nag) s.append('Keeps nudging');
      else if (t.reminders.length > 1) s.append(String(t.reminders.length));
      sub.append(s);
    }
    if (t.subs.length) sub.append(el('span', '', `${t.subs.filter(x => x.done).length}/${t.subs.length}`));
    const list = showList && listOf(t.list);
    if (list) { const s = el('span'); const d = el('i', 'dot'); d.style.background = list.colour; s.append(d, list.name); sub.append(s); }
    return sub;
  }

  function row(t, showList = true, sortable = false) {
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
    const sub = subline(t, showList);
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
  const taskList = (tasks, showList, sortable) => { const box = el('div', 'tasks'); box.append(...tasks.map(t => row(t, showList, sortable))); return box; };
  function head(text, extra, cls = '') {
    const h = el('p', `head ${cls}`, text);
    if (extra) h.append(typeof extra === 'string' ? el('span', '', extra) : extra);
    return h;
  }

  // ---- the three tabs ----
  let showDoneToday = false;
  function renderToday() {
    const { overdue, today } = L.today(state.tasks, now());
    const out = [];
    if (overdue.length) {
      const move = el('button', '', 'Move to today');
      move.type = 'button';
      move.dataset.moveOverdue = '1';
      const movable = overdue.some(t => L.canMove(t, now()));
      out.push(head(`Overdue (${overdue.length})`, movable ? move : '', 'late'), taskList(overdue));
    }
    if (today.length) out.push(head('Today', String(today.length)), taskList(today));
    const done = L.doneToday(state.tasks, now());
    if (!out.length) out.push(el('p', 'empty', state.tasks.length ? 'Nothing due today.' : 'Type a task below. Try: Call mum tomorrow 5pm #home'));
    if (done.length) {
      const b = el('button', 'done-toggle');
      b.type = 'button';
      b.dataset.doneToday = '1';
      b.append(el('span', '', `Done today (${done.length})`), el('span', '', showDoneToday ? 'Hide' : 'Show'));
      out.push(b);
      if (showDoneToday) out.push(taskList(done));
    }
    return out;
  }
  function renderUpcoming() {
    const { days, someday } = L.upcoming(state.tasks, now());
    const out = [];
    for (const d of days) out.push(head(L.dayText(d.date, now())), taskList(d.tasks));
    if (someday.length) out.push(head('No date', String(someday.length)), taskList(someday));
    if (!out.length) out.push(el('p', 'empty', 'Nothing coming up.'));
    return out;
  }
  function renderLists() {
    const box = el('div', 'rows');
    const count = id => state.tasks.filter(t => L.isOpen(t) && (t.list || null) === id).length;
    const line = (id, name, colour) => {
      const b = el('button', 'list-row');
      b.type = 'button';
      b.dataset.list = id || 'inbox';
      const d = el('i', 'dot');
      d.style.background = colour;
      b.append(d, el('b', '', name), el('span', '', String(count(id))));
      return b;
    };
    box.append(line(null, 'Inbox', 'var(--line-strong)'), ...state.lists.map(l => line(l.id, l.name, l.colour)));
    const add = el('button', 'new-list', 'New list');
    add.type = 'button';
    add.dataset.newList = '1';
    box.append(add);
    return [box];
  }

  function render() {
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const { overdue, today } = L.today(state.tasks, now());
    $('meta').textContent = overdue.length ? `${overdue.length} overdue` : new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).format(now());
    $('view').replaceChildren(...{ today: renderToday, upcoming: renderUpcoming, lists: renderLists }[tab]());
    if ($('listPage').open) renderListPage();
    if ($('findPage').open) renderFind();
    void today;
  }

  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    write('tab', tab);
    render();
    $('view').scrollTop = 0;
  });

  // Ticks and rows work the same everywhere they're drawn.
  function toggle(id) {
    const before = task(id);
    if (!before) return;
    haptic();
    if (before.done) { setTask(id, { done: null }); return render(); }
    const after = L.complete(before, now());
    state.tasks = state.tasks.map(t => (t.id === id ? after : t));
    commit();
    say(after.done ? 'Done' : `Next: ${L.dayText(after.due, now())}`, () => { state.tasks = state.tasks.map(t => (t.id === id ? before : t)); commit(); });
  }
  document.addEventListener('click', e => {
    const tick = e.target.closest('[data-tick]');
    if (tick) return toggle(tick.dataset.tick);
    const open = e.target.closest('[data-open]');
    if (open) return openTask(open.dataset.open);
    const list = e.target.closest('[data-list]');
    if (list) return openList(list.dataset.list === 'inbox' ? null : list.dataset.list);
    if (e.target.closest('[data-new-list]')) return askList(null);
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
  function previewText(q) {
    const bits = [];
    if (q.due) bits.push(L.dayText(q.due, now()));
    if (q.time) bits.push(L.timeText(q.time, state.prefs.use24));
    if (q.repeat) bits.push(L.repeatText(q.repeat));
    if (q.listName) bits.push(listOf(q.list)?.name || `New list: ${q.listName}`);
    if (q.pri) bits.push(q.pri === 2 ? 'Urgent' : 'High');
    if (q.remind != null) bits.push(L.reminderText({ before: q.remind }, now()));
    if (q.loud) bits.push('Rings like a call');
    return bits.join(' · ');
  }
  function addFrom(text, list) {
    const q = L.parseQuick(text, now(), state.lists);
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
  $('quickBox').addEventListener('input', () => {
    const text = previewText(L.parseQuick($('quickBox').value, now(), state.lists));
    $('preview').hidden = !text;
    $('preview').textContent = text;
  });
  $('quick').addEventListener('submit', e => {
    e.preventDefault();
    const t = addFrom($('quickBox').value);
    if (!t) return;
    $('quickBox').value = '';
    $('preview').hidden = true;
    // Show where it went, if that isn't on the tab in view.
    const here = tab === 'lists' || (tab === 'today' ? t.due && t.due <= L.iso(now()) : !t.due || t.due > L.iso(now()));
    if (!here) say(t.due ? `Added for ${L.dayText(t.due, now())}` : 'Added with no date');
  });

  // ---- one list ----
  let openListId;
  let showDone = false;
  function renderListPage() {
    const list = listOf(openListId);
    $('listTitle').textContent = list ? list.name : 'Inbox';
    $('listEdit').hidden = !list;
    const mine = state.tasks.filter(t => !t.deleted && (t.list || null) === openListId);
    const open = L.listOrder(mine.filter(t => !t.done));
    const done = mine.filter(t => t.done).sort((a, b) => b.done - a.done);
    const out = [];
    out.push(open.length ? taskList(open, false, true) : el('p', 'empty', 'Nothing here yet.'));
    if (done.length) {
      const b = el('button', 'done-toggle');
      b.type = 'button';
      b.dataset.doneToggle = '1';
      b.append(el('span', '', `Completed (${done.length})`), el('span', '', showDone ? 'Hide' : 'Show'));
      out.push(b);
      if (showDone) {
        out.push(taskList(done, false));
        const clear = el('button', 'done-toggle', 'Clear completed');
        clear.type = 'button';
        clear.dataset.clearDone = '1';
        out.push(clear);
      }
    }
    const body = $('listBody');
    body.replaceChildren(...out);
    if (out[0].classList.contains('tasks')) out[0].style.marginTop = '10px';
  }
  function openList(id) {
    openListId = id;
    showDone = false;
    renderListPage();
    show('listPage');
  }
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
    lifted = { id: e.pointerId, r, rows, from: rows.indexOf(r), to: rows.indexOf(r), y: e.clientY, h: r.getBoundingClientRect().height + 6, centres: rows.map(middle) };
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
    if (addFrom($('listBox').value, openListId)) $('listBox').value = '';
  });
  $('listEdit').addEventListener('click', () => askList(openListId));

  // New or edit: name, colour, and delete if it exists.
  let asking = null, askColour = COLOURS[0], sure = false;
  function askList(id) {
    asking = id;
    sure = false;
    const list = listOf(id);
    askColour = list?.colour || COLOURS[state.lists.length % COLOURS.length];
    $('askTitle').textContent = list ? 'Edit list' : 'New list';
    $('askName').value = list?.name || '';
    $('askDelete').hidden = !list;
    $('askDelete').textContent = 'Delete list';
    drawSwatches();
    show('listAsk');
  }
  function drawSwatches() {
    $('askColours').replaceChildren(...COLOURS.map(c => {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.style.background = c;
      b.dataset.colour = c;
      b.setAttribute('aria-pressed', String(c === askColour));
      b.setAttribute('aria-label', `Colour ${COLOURS.indexOf(c) + 1}`);
      return b;
    }));
  }
  $('askColours').addEventListener('click', e => {
    const b = e.target.closest('[data-colour]');
    if (!b) return;
    askColour = b.dataset.colour;
    drawSwatches();
  });
  $('askForm').addEventListener('submit', () => {
    const name = $('askName').value.trim();
    if (!name) return;
    if (asking) state.lists = state.lists.map(l => (l.id === asking ? { ...l, name, colour: askColour } : l));
    else state.lists = [...state.lists, { id: L.newId(now()), name, colour: askColour }];
    commit();
  });
  $('listAsk').addEventListener('click', e => { if (e.target.closest('[data-cancel]')) $('listAsk').close(); });
  // Its tasks go to the Inbox rather than vanish, and it takes two taps.
  $('askDelete').addEventListener('click', () => {
    if (!sure) { sure = true; $('askDelete').textContent = 'Tap again. Its tasks move to Inbox'; return; }
    const id = asking;
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
    // Quick add can make repeats the menu doesn't list, like every 3 days.
    const repeat = t.repeat ? `${t.repeat.every || 1} ${t.repeat.unit}` : '';
    if (repeat && ![...$('fRepeat').options].some(o => o.value === repeat)) {
      const o = el('option', '', L.repeatText(t.repeat));
      o.value = repeat;
      $('fRepeat').append(o);
    }
    $('fRepeat').value = repeat === '1 days' ? '1 days' : repeat;
    $('fUntil').value = t.repeat?.until || '';
    $('fNag').value = String(t.nag || 0);
    $('fLoud').checked = !!t.loud;
    $('fPri').value = String(t.pri);
    $('fList').replaceChildren(el('option', '', 'Inbox'), ...state.lists.map(l => { const o = el('option', '', l.name); o.value = l.id; return o; }));
    $('fList').firstChild.value = '';
    $('fList').value = t.list || '';
    $('fCustom').hidden = true;
    $('taskDelete').textContent = 'Delete';
    drawTaskExtras();
    show('taskPage');
  }
  function drawTaskExtras() {
    const t = task(editing);
    $('fUntilWrap').hidden = !t.repeat;
    $('fUntil').value = t.repeat?.until || '';
    $('fLoud').checked = !!t.loud && t.reminders.length > 0;
    renderLoudFix();
    $('fUntil').value = t.repeat?.until || '';
    const days = t.repeat?.unit === 'days' ? t.repeat.days || [] : null;
    $('fDays').hidden = !days;
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
      const b = el('button', 'chip', L.reminderText(r, now()));
      b.type = 'button';
      b.dataset.dropReminder = i;
      b.setAttribute('aria-label', `Remove reminder: ${L.reminderText(r, now())}`);
      b.insertAdjacentHTML('beforeend', ICON.cross);
      return b;
    }));
    $('fSubs').replaceChildren(...t.subs.map(s => {
      const r = el('div', s.done ? 'step done' : 'step');
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
  }
  const edit = change => { setTask(editing, change); drawTaskExtras(); };
  // Changes save as they're made, so there's no Save to miss.
  $('fTitle').addEventListener('input', () => { const v = $('fTitle').value.trim(); if (v) setTask(editing, { title: v }); });
  $('fNotes').addEventListener('input', () => setTask(editing, { notes: $('fNotes').value }));
  $('fDue').addEventListener('change', () => {
    const due = $('fDue').value || null;
    const t = task(editing);
    const change = { due, snooze: null };
    if (!due) {
      change.time = null;
      change.repeat = null;
      change.reminders = t.reminders.filter(r => r.before == null);   // nothing left to count back from
      $('fTime').value = '';
      $('fRepeat').value = '';
    } else if (t.repeat?.dom) change.repeat = { ...t.repeat, dom: L.parseDay(due).getDate() };
    if (due && t.repeat?.unit === 'days') { change.due = L.fitToDays(due, t.repeat); $('fDue').value = change.due; }
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
    const due = t.due || L.iso(now());
    $('fDue').value = due;
    const repeat = { every: Number(every), unit, dom: L.parseDay(due).getDate(), until: t.repeat?.until || undefined };
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
  $('fQuickDates').addEventListener('click', e => {
    const b = e.target.closest('[data-date]');
    if (!b) return;
    $('fDue').value = b.dataset.date === '' ? '' : L.addDays(L.iso(now()), Number(b.dataset.date));
    $('fDue').dispatchEvent(new Event('change'));
  });
  $('fUntil').addEventListener('change', () => {
    const t = task(editing);
    if (t.repeat) edit({ repeat: { ...t.repeat, until: $('fUntil').value || undefined } });
  });
  $('fAddReminder').addEventListener('change', () => {
    const v = $('fAddReminder').value;
    $('fAddReminder').value = '';
    if (!v) return;
    if (v === 'custom') { $('fCustom').hidden = false; return $('fCustom').focus(); }
    const t = task(editing);
    const before = Number(v);
    if (t.reminders.some(r => r.before === before)) return;
    // A reminder needs something to count back from.
    const change = { reminders: [...t.reminders, { before }] };
    if (!t.due) { change.due = L.iso(now()); $('fDue').value = change.due; }
    edit(change);
  });
  $('fCustom').addEventListener('change', () => {
    const at = $('fCustom').value;
    if (!at) return;
    const t = task(editing);
    $('fCustom').value = '';
    $('fCustom').hidden = true;
    edit({ reminders: [...t.reminders, { at }] });
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
    if (change.loud) change.reminders = L.ensureRing({ ...t, ...change }, now()).reminders;
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
    $('taskPage').close();
    render();
    say('Deleted', () => { setTask(id, { deleted: null }); render(); });
  });
  $('taskPage').addEventListener('close', render);

  // ---- search ----
  function renderFind() {
    const hits = L.search(state.tasks, $('findBox').value);
    $('findBody').replaceChildren(...(hits.length ? [taskList(hits)] : $('findBox').value.trim() ? [el('p', 'empty', 'Nothing matches.')] : []));
    if (hits.length) $('findBody').firstChild.style.marginTop = '10px';
  }
  $('searchBtn').addEventListener('click', () => {
    $('findBox').value = '';
    renderFind();
    show('findPage');
    $('findBox').focus();
  });
  $('findBox').addEventListener('input', renderFind);

  // ---- settings ----
  let health = null;
  function renderHealth() {
    $('healthBox').hidden = !health;
    const off = health && (!health.notifications || !health.exact);
    $('warn').hidden = !off || !state.tasks.some(t => L.isOpen(t) && t.reminders.length);
    $('warn').textContent = 'Reminders are switched off. Tap to fix.';
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
    $('health').replaceChildren(
      line('Notifications', health.notifications, 'notifications'),
      line('Exact alarms', health.exact, 'alarms'),
      line('No battery limits', health.battery, 'battery'),
      line('Full-screen alarms', health.fullScreen, 'fullscreen'),
      line('Show over other apps', health.overlay, 'overlay'),
    );
  }
  $('warn').addEventListener('click', () => openSettings());

  // What's stopping an urgent task taking over the screen, if anything.
  function loudBlocker() {
    if (!health) return null;
    if (!health.overlay) return { what: 'overlay', text: 'Allow Show over other apps, or this stays a banner while you’re using your phone. Tap to turn it on.' };
    if (!health.fullScreen) return { what: 'fullscreen', text: 'Allow full-screen alarms, or this won’t show on the lock screen. Tap to turn it on.' };
    return null;
  }
  function renderLoudFix() {
    const need = editing && task(editing)?.loud ? loudBlocker() : null;
    $('fLoudFix').hidden = !need;
    if (need) $('fLoudFix').textContent = need.text;
  }
  $('fLoudFix').addEventListener('click', () => {
    const need = loudBlocker();
    if (need) toApp({ type: 'openSettings', what: need.what });
  });
  for (const [id, loud] of [['testBtn', false], ['testLoudBtn', true]]) {
    $(id).addEventListener('click', () => {
      // A test that can't take over the screen would only look broken.
      const need = loud ? loudBlocker() : null;
      if (need) {
        say(need.what === 'overlay' ? 'Allow Show over other apps, then test again.' : 'Allow full-screen alarms, then test again.');
        return toApp({ type: 'openSettings', what: need.what });
      }
      toApp({ type: 'testAlarm', loud });
      say('It rings in about a minute. You can close the app.');
    });
  }
  function openSettings() {
    $('sDefault').value = state.prefs.defaultReminder == null ? '' : String(state.prefs.defaultReminder);
    $('sSummary').value = state.prefs.summary || '';
    $('s24').checked = !!state.prefs.use24;
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
  $('sDefault').addEventListener('change', () => pref({ defaultReminder: $('sDefault').value === '' ? null : Number($('sDefault').value) }));
  $('sSummary').addEventListener('change', () => pref({ summary: $('sSummary').value || null }));
  $('s24').addEventListener('change', () => pref({ use24: $('s24').checked }));

  // ---- Android app bridge (absent in a browser) ----
  const stack = [];
  function show(id) { if (!$(id).open) { $(id).showModal(); stack.push($(id)); } tellBack(); }
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
  // the store, so there the version is a plain label with nothing to tap.
  let appVersion = '', selfUpdates = false, updateReady = false, versionTimer = 0, updateVersion = '', updateSize = 0;
  function showVersion(text, st) {
    clearTimeout(versionTimer);
    $('version').hidden = false;
    $('version').textContent = text;
    $('version').dataset.state = st || '';
  }
  function showUpdate(m) {
    const setShown = (id, on) => { $(id).hidden = !on; };
    $('updateCard').hidden = false;
    if (m.state === 'available') {
      updateVersion = m.version || updateVersion;
      updateSize = m.size > 0 ? m.size : updateSize;
      const notes = Array.isArray(m.notes) ? m.notes.filter(n => typeof n === 'string' && n).slice(0, 5) : [];
      $('updateNotes').replaceChildren(...notes.map(n => el('li', '', n)));
      setShown('updateNotes', notes.length > 0);
    }
    const v = {
      available: { title: 'Update available', msg: '', actions: true, progress: false, go: 'Update' },
      downloading: { title: 'Downloading update', msg: '', actions: false, progress: true },
      installing: { title: 'Installing update', actions: false, progress: true, msg: 'Confirm on the next screen. The first time, Android asks you to allow installs from Nudge. Turn it on, then go back.' },
      failed: { title: 'Update didn’t finish', msg: m.message || 'Something went wrong. Try again.', actions: true, progress: false, go: 'Try again' },
    }[m.state];
    if (!v) return;
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
      } else if (m.type === 'open') {
        if (m.task) openTask(m.task);
      } else if (m.type === 'focusAdd') {
        while (window.nudgeBack());
        $('quickBox').focus();
      } else if (m.type === 'info') {
        appVersion = m.version;
        selfUpdates = m.updates === true;
        $('version').disabled = !selfUpdates;
        const seen = read('seenVersion');
        write('seenVersion', appVersion);
        if (selfUpdates && !updateReady && seen && seen !== appVersion) {
          showVersion(`Updated to v${appVersion}`, 'available');
          versionTimer = setTimeout(() => showVersion(`v${appVersion}`), 4000);
        } else if (!updateReady) showVersion(`v${appVersion}`);
      } else if (m.type === 'updateStatus' && selfUpdates) {
        if (m.state === 'available') { updateReady = true; return showVersion('Update available', 'available'); }
        showVersion(m.state === 'latest' ? 'Up to date' : 'Couldn’t check');
        versionTimer = setTimeout(() => showVersion(`v${appVersion}`), 2500);
      } else if (m.type === 'update' && selfUpdates) {
        if (m.state === 'available') { updateReady = true; showVersion('Update available', 'available'); }
        showUpdate(m);
      }
    };
    $('updateGo').addEventListener('click', () => { showUpdate({ state: 'downloading', progress: 0 }); toApp({ type: 'installUpdate' }); });
    $('updateLater').addEventListener('click', () => { $('updateCard').hidden = true; });
    $('version').addEventListener('click', () => {
      if (updateReady) { $('updateCard').hidden = false; return; }
      showVersion('Checking…');
      toApp({ type: 'checkUpdate' });
    });
  }

  // A new day while the app sits open.
  let shown = L.iso(now());
  function checkDay() {
    if (L.iso(now()) !== shown) { shown = L.iso(now()); commit(); }
  }
  setInterval(() => { if (!document.hidden) checkDay(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

  // ---- boot ----
  // Hello goes first, so a bad local copy can't stop the phone's good one arriving.
  if (app) toApp({ type: 'hello' }); else write('state', state);
  render();
})();
