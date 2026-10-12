/** First launch: who you are becoming, two habits, when a day ends. Under a minute. */
import type { Controller } from './controller';
import { h } from './dom';
import { HabitForm } from './setup/habitForm';

export function welcome(app: Controller): HTMLElement {
  const identity = h('textarea', { id: 'w-identity', rows: '2', maxlength: '200', placeholder: 'Someone who shows up, even on the cold days.' });
  const first = new HabitForm('First habit', {
    name: 'Qbank',
    version: { type: 'numeric', target: 50, minimum: 25, unit: 'questions', schedule: { kind: 'daily' } },
  });
  const second = new HabitForm('Second habit', {
    name: 'Review mistakes',
    version: { type: 'binary', target: 1, minimum: 1, schedule: { kind: 'daily' } },
  });
  const status = h('p', { class: 'hint', role: 'status' });
  const begin = h('button', { class: 'btn primary big', text: 'Begin the climb' });
  begin.addEventListener('click', () => {
    const habits = [];
    for (const f of [first, second]) {
      const r = f.read();
      if (!r.ok) {
        status.textContent = r.message;
        r.field.focus();
        return;
      }
      habits.push(r.draft);
    }
    const res = app.start({ identity: identity.value, habits });
    if (!res.ok) status.textContent = res.message;
  });
  return h(
    'main',
    { class: 'welcome' },
    h('h1', { text: 'A year on the mountain' }),
    h('p', { class: 'intro', text: 'Each day you show up, Ari climbs. Set two habits to start; you can change them later.' }),
    h('div', { class: 'field' }, h('label', { for: 'w-identity', text: 'Who you are becoming (optional)' }), identity),
    first.el,
    second.el,
    h('p', { class: 'hint', text: 'Water is built in for everyone: 8 glasses a day, on its own bar. A day ends at 4:00 in the morning. Change either in Setup.' }),
    h('div', { class: 'row-actions' }, begin),
    status,
  );
}
