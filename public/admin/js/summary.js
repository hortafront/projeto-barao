// Tela Resumo do painel: pedidos, faturamento bruto estimado e itens mais vendidos no período.
import { formatBRL } from '/shared/money.js';
import { el, render } from '../../js/dom.js';
import { presetRange, dateFilter } from './orders.js';

export async function mount(container, ctx) {
  const { adminApi } = ctx;
  let range = presetRange('hoje', new Date());
  let requestId = 0;

  const result = el('div', { 'aria-live': 'polite' });
  const refreshBtn = el('button', { type: 'button', class: 'btn btn--small', onclick: () => load() }, 'Atualizar');
  const filter = dateFilter({
    range,
    // Datas editáveis = "Personalizado"; atalhos: hoje, 7 dias, mês.
    presets: [['Hoje', 'hoje'], ['7 dias', '7dias'], ['Mês', 'mes']],
    onChange: (next) => { range = next; load(); },
  });

  render(container,
    el('h1', {}, 'Resumo'),
    filter,
    el('p', { class: 'form-help' }, 'Ou escolha um período personalizado nas datas acima.'),
    refreshBtn,
    result);

  async function load() {
    const mine = ++requestId;
    refreshBtn.disabled = true;
    render(result, el('div', { class: 'skeleton' }));
    try {
      const q = new URLSearchParams({ from: range.from, to: range.to });
      const data = await adminApi(`/api/admin/reports/summary?${q}`);
      if (mine !== requestId) return;
      const top = (data.topItems ?? []).slice(0, 10);
      render(result,
        el('div', { class: 'stat-block' },
          el('div', { class: 'stat-block__label' }, 'Pedidos'),
          el('div', { class: 'stat-block__value' }, String(data.ordersCount))),
        el('div', { class: 'stat-block' },
          el('div', { class: 'stat-block__label' }, 'Faturamento bruto estimado'),
          el('div', { class: 'stat-block__value' }, formatBRL(data.grossCents)),
          el('div', { class: 'stat-block__note' }, 'Sem taxa de entrega; exclui pedidos cancelados.')),
        el('div', { class: 'stat-block' },
          el('div', { class: 'stat-block__label' }, 'Itens mais vendidos'),
          top.length === 0
            ? el('p', { class: 'stat-block__note' }, 'Nenhuma venda no período.')
            : el('ol', { class: 'admin-list' }, top.map((item) =>
              el('li', { class: 'admin-list__row' },
                el('span', { class: 'admin-list__main' }, item.name),
                el('strong', {}, `× ${item.quantity}`))))));
    } catch (err) {
      if (mine !== requestId) return;
      render(result, el('p', { class: 'field-error', role: 'alert' }, err.message || 'Não foi possível carregar o resumo.'));
    } finally {
      if (mine === requestId) refreshBtn.disabled = false;
    }
  }

  await load();
}
