import { loadData } from '../data';
import { schedule } from '../store';
import type { Act } from '../types';

function tableRow(act: Act, opts?: { flag?: boolean }): string {
  const clash = opts?.flag ? ' clash' : '';
  return `<tr class="${clash}"><td class="t">${act.start}</td><td class="s">${act.stage}</td><td class="n">${act.name}</td></tr>`;
}

export async function renderPrint(which: 'program' | 'schedule'): Promise<void> {
  const { meta, acts } = await loadData();
  const root = document.getElementById('printRoot')!;
  root.innerHTML = '';
  document.body.classList.add('printing');

  const wrap = document.createElement('div');
  wrap.className = 'print-sheet';

  wrap.innerHTML = `
    <header class="print-head">
      <div class="print-brand">END OF THE ROAD <em>2026</em></div>
      <h1>${which === 'program' ? 'Full Programme' : 'My Day'}</h1>
      <p class="print-dates">${meta.dates} · ${meta.venue}</p>
    </header>`;

  if (which === 'program') {
    for (const day of meta.days) {
      const dayActs = acts
        .filter((a) => a.dayKey === day.key && !a.placeholder)
        .sort((a, b) => a.startMs - b.startMs);
      const section = document.createElement('section');
      section.className = 'print-day';
      section.innerHTML = `<h2>${day.label}</h2>`;
      const table = document.createElement('table');
      table.className = 'print-table';
      table.innerHTML = `<thead><tr><th>Time</th><th>Stage</th><th>Artist</th></tr></thead><tbody>${dayActs.map((a) => tableRow(a)).join('')}</tbody>`;
      section.appendChild(table);
      wrap.appendChild(section);
    }
  } else {
    const grouped = schedule.resolved(acts);
    for (const day of meta.days) {
      const list = grouped.get(day.key);
      if (!list?.length) continue;
      const section = document.createElement('section');
      section.className = 'print-day';
      section.innerHTML = `<h2>${day.label}</h2>`;
      const table = document.createElement('table');
      table.className = 'print-table';
      table.innerHTML = `<thead><tr><th>Time</th><th>Stage</th><th>Artist</th></tr></thead><tbody>${list.map((a) => tableRow(a)).join('')}</tbody>`;
      section.appendChild(table);
      wrap.appendChild(section);
    }
    if (!schedule.all().length) {
      wrap.innerHTML += '<p class="print-empty">No sets in My Day yet.</p>';
    }
  }

  wrap.innerHTML += `
    <footer class="print-foot">
      <p>Set times courtesy of <a href="${meta.clashfinderUrl}">clashfinder.com</a> — always confirm with official channels.</p>
      <p>Generated ${new Date(meta.generatedAt).toLocaleString()} · endoftheroadfestival.com</p>
    </footer>`;

  root.appendChild(wrap);

  const cleanup = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.setTimeout(() => window.print(), 80);
  window.setTimeout(cleanup, 120000); // safety net
}
