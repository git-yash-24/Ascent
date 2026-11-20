import { logicalDay } from '../core/model/date';
import { checkSyncedStorage, runSyncChecks, type CheckResult } from './capabilities';

const STATUS_TEXT: Record<CheckResult['status'], string> = {
  yes: 'Ready',
  partial: 'Partly',
  no: 'Missing',
  pending: 'Checking',
};

function row(r: CheckResult): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'check';
  li.dataset.status = r.status;
  li.id = `check-${r.id}`;

  const pill = document.createElement('span');
  pill.className = 'pill';
  pill.textContent = STATUS_TEXT[r.status];

  const body = document.createElement('div');
  body.className = 'check-body';
  const label = document.createElement('div');
  label.className = 'check-label';
  label.textContent = r.label;
  const detail = document.createElement('div');
  detail.className = 'check-detail';
  detail.textContent = r.detail;
  body.append(label, detail);

  li.append(body, pill);
  return li;
}

function render(): void {
  const list = document.getElementById('checks');
  const build = document.getElementById('build');
  const today = document.getElementById('today');
  if (!list || !build || !today) return;

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = logicalDay(new Date(), zone, 240);
  today.textContent = `Today counts as ${day} (${zone}, day ends at 04:00)`;
  build.textContent = `Version ${__APP_VERSION__} · built ${__BUILD_TIME__.slice(0, 16).replace('T', ' ')} UTC`;

  list.replaceChildren(...runSyncChecks().map(row));
  const pending: CheckResult = { id: 'sync', label: 'Synced private storage', status: 'pending', detail: 'asking the viewer…' };
  const pendingRow = row(pending);
  list.append(pendingRow);

  void checkSyncedStorage().then((r) => pendingRow.replaceWith(row(r)));
}

render();
