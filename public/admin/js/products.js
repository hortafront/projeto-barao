// Tela Produtos do painel: lista por categoria, criar/editar, toggle Esgotado, foto, excluir.
import { el, render } from '../../js/dom.js';
import { parseBRLToCents, formatBRL } from '/shared/money.js';
import { withSaving } from './admin-api.js';

const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PRICE_ERROR = 'Preço inválido. Ex.: 34,99';
const KIND_BY_SLUG = { classicas: 'pizza', especiais: 'pizza', bebidas: 'drink', adicionais: 'addon' };

// ---------------------------------------------------------------- puras
export function kindForCategory(slug) {
  return KIND_BY_SLUG[slug] ?? 'pizza';
}

/** Corpo de POST/PUT a partir dos campos do formulário. Lança { field, message } se o preço for inválido. */
export function productPayload(fields, categories) {
  const category = categories.find((c) => c.id === fields.categoryId);
  const kind = kindForCategory(category?.slug);
  const priceCents = parseBRLToCents(fields.price);
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw Object.assign(new Error(PRICE_ERROR), { field: 'price', message: PRICE_ERROR });
  }
  const sortOrder = Number.parseInt(String(fields.sortOrder ?? '0').trim() || '0', 10);
  return {
    categoryId: fields.categoryId,
    kind,
    name: String(fields.name ?? '').trim(),
    description: String(fields.description ?? '').trim(),
    priceCents,
    available: Boolean(fields.available),
    sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    addonGroup: kind === 'addon' && fields.addonGroup === 'borda' ? 'borda' : null,
  };
}

/** [{ category, products }] na ordem das categorias; produtos por sortOrder e nome. Categorias vazias ficam fora. */
export function groupByCategory(products, categories) {
  return categories
    .map((category) => ({
      category,
      products: products
        .filter((p) => p.categoryId === category.id)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'pt-BR')),
    }))
    .filter((group) => group.products.length > 0);
}

/**
 * Categorias com id: o id só vem dos produtos do admin (/api/menu não expõe id); nome/ordem vêm do /api/menu.
 * Categoria sem nenhum produto ainda não tem id conhecido e não aparece.
 */
export function buildCategories(products, menuCategories) {
  const idBySlug = new Map();
  for (const p of products) if (p.categorySlug && p.categoryId) idBySlug.set(p.categorySlug, p.categoryId);
  const ordered = menuCategories.filter((c) => idBySlug.has(c.slug));
  const known = new Set(ordered.map((c) => c.slug));
  const extra = [...idBySlug.keys()].filter((slug) => !known.has(slug)).map((slug) => ({ slug, name: slug }));
  return [...ordered, ...extra].map((c) => ({ id: idBySlug.get(c.slug), slug: c.slug, name: c.name }));
}

// ---------------------------------------------------------------- tela
export async function mount(container, ctx) {
  const { adminApi, toast, confirmDialog } = ctx;
  let products = [];
  let categories = [];
  let previewUrl = null;

  const releasePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  };

  async function load() {
    render(container, el('p', { class: 'admin-note' }, 'Carregando produtos…'));
    try {
      const [{ products: list }, menu] = await Promise.all([
        adminApi('/api/admin/products'),
        fetch('/api/menu').then((r) => (r.ok ? r.json() : { categories: [] })).catch(() => ({ categories: [] })),
      ]);
      products = list ?? [];
      categories = buildCategories(products, menu?.categories ?? []);
      showList();
    } catch (err) {
      render(container,
        el('p', { class: 'form-notice', role: 'alert' }, err.message || 'Não foi possível carregar os produtos.'),
        el('button', { type: 'button', class: 'btn', onclick: load }, 'Tentar de novo'));
    }
  }

  // ------------------------------------------------------------ lista
  function showList() {
    releasePreview();
    const groups = groupByCategory(products, categories);
    render(container,
      el('button', { type: 'button', class: 'btn btn--primary btn--block', onclick: () => showForm(null) }, 'Novo produto'),
      groups.length === 0 ? el('p', { class: 'admin-note' }, 'Nenhum produto cadastrado.') : null,
      groups.map(({ category, products: items }) =>
        el('section', { 'aria-label': category.name },
          el('h2', {}, category.name),
          el('div', { class: 'admin-list' }, items.map(productRow)))));
  }

  function productRow(product) {
    const toggle = el('button', {
      type: 'button',
      class: 'switch',
      role: 'switch',
      'aria-checked': String(product.available),
      'aria-label': `${product.name}: ${product.available ? 'disponível' : 'esgotado'}`,
      onclick: () => toggleAvailability(product, toggle, status),
    });
    const status = el('span', { class: 'admin-list__meta' }, product.available ? 'Disponível' : 'Esgotado');
    return el('div', { class: 'admin-list__row' },
      thumb(product.imageUrl),
      el('button', { type: 'button', class: 'admin-list__main admin-card--clickable', onclick: () => showForm(product) },
        el('span', { class: 'admin-list__title' }, product.name, product.addonGroup === 'borda' ? ' ' : null,
          product.addonGroup === 'borda' ? el('span', { class: 'status-pill' }, 'Borda') : null),
        el('span', { class: 'admin-list__meta' }, ` ${formatBRL(product.priceCents)}`)),
      el('div', {}, toggle, status));
  }

  function thumb(url) {
    return url
      ? el('img', { class: 'admin-thumb', src: url, alt: '', width: 56, height: 56, loading: 'lazy' })
      : el('span', { class: 'admin-thumb', 'aria-hidden': 'true' });
  }

  async function setAvailability(product, next) {
    await adminApi(`/api/admin/products/${product.id}/availability`, { method: 'PATCH', body: { available: next } });
    product.available = next;
  }

  async function toggleAvailability(product, toggle, status) {
    const next = !product.available;
    toggle.setAttribute('aria-checked', String(next)); // otimista
    status.textContent = next ? 'Disponível' : 'Esgotado';
    toggle.disabled = true;
    try {
      await setAvailability(product, next);
      toggle.setAttribute('aria-label', `${product.name}: ${next ? 'disponível' : 'esgotado'}`);
      toast(next ? `${product.name} disponível` : `${product.name} marcado como esgotado`, 'success');
    } catch (err) {
      toggle.setAttribute('aria-checked', String(product.available)); // reverte
      status.textContent = product.available ? 'Disponível' : 'Esgotado';
      toast(err.message, 'error');
    } finally {
      toggle.disabled = false;
    }
  }

  // ------------------------------------------------------------ formulário
  function showForm(product) {
    releasePreview();
    const isNew = !product;
    if (categories.length === 0) {
      toast('Cadastre os produtos pelo seed antes: nenhuma categoria disponível.', 'error');
      return;
    }

    const category = el('select', { id: 'p-category', name: 'categoryId' },
      categories.map((c) => el('option', { value: c.id, selected: c.id === (product?.categoryId ?? categories[0].id) }, c.name)));
    const name = el('input', { id: 'p-name', name: 'name', type: 'text', maxlength: 80, required: true, value: product?.name ?? '' });
    const description = el('textarea', { id: 'p-desc', name: 'description', maxlength: 300, rows: 3 });
    description.value = product?.description ?? '';
    const price = el('input', {
      id: 'p-price', name: 'price', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true,
      value: product ? formatBRL(product.priceCents).replace(/^R\$\s?/, '') : '',
    });
    const priceError = el('p', { class: 'form-help', role: 'alert' });
    const sortOrder = el('input', { id: 'p-sort', name: 'sortOrder', type: 'number', min: 0, max: 9999, inputmode: 'numeric', value: product?.sortOrder ?? 0 });
    const available = el('input', { id: 'p-available', name: 'available', type: 'checkbox', checked: product ? product.available : true });
    const group = el('select', { id: 'p-group', name: 'addonGroup' },
      el('option', { value: '', selected: product?.addonGroup !== 'borda' }, 'nenhum'),
      el('option', { value: 'borda', selected: product?.addonGroup === 'borda' }, 'Borda'));
    const groupRow = el('div', { class: 'form-row' },
      el('label', { for: 'p-group' }, 'Grupo'),
      group,
      el('p', { class: 'form-help' }, 'Adicionais do grupo Borda são exclusivos: o cliente escolhe no máximo uma borda por pizza.'));

    const syncGroup = () => {
      const slug = categories.find((c) => c.id === category.value)?.slug;
      groupRow.hidden = kindForCategory(slug) !== 'addon';
    };
    category.addEventListener('change', syncGroup);
    syncGroup();

    // foto
    const preview = el('img', { class: 'admin-thumb', alt: 'Prévia da foto', width: 56, height: 56, src: product?.imageUrl ?? null, hidden: !product?.imageUrl });
    const fileError = el('p', { class: 'form-help', role: 'alert' });
    const file = el('input', { id: 'p-image', name: 'image', type: 'file', accept: IMAGE_TYPES.join(',') });
    file.addEventListener('change', () => {
      fileError.textContent = '';
      const chosen = file.files[0];
      if (!chosen) return;
      if (!IMAGE_TYPES.includes(chosen.type)) {
        fileError.textContent = 'Use foto JPG, PNG ou WEBP.';
        file.value = '';
        return;
      }
      if (chosen.size > MAX_BYTES) {
        fileError.textContent = 'A foto passa de 2 MB. Tire um print ou reduza a imagem.';
        file.value = '';
        return;
      }
      releasePreview();
      previewUrl = URL.createObjectURL(chosen);
      preview.src = previewUrl;
      preview.hidden = false;
    });

    const save = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, isNew ? 'Criar produto' : 'Salvar');
    const cancel = el('button', { type: 'button', class: 'btn btn--block', onclick: showList }, 'Voltar');
    const remove = isNew ? null
      : el('button', { type: 'button', class: 'btn btn--danger btn--block', onclick: () => removeProduct(product, remove) }, 'Excluir produto');
    const conflict = el('div', { hidden: true });

    const form = el('form', { class: 'admin-card', novalidate: true },
      el('h2', {}, isNew ? 'Novo produto' : 'Editar produto'),
      el('div', { class: 'form-row' }, el('label', { for: 'p-category' }, 'Categoria'), category),
      el('div', { class: 'form-row' }, el('label', { for: 'p-name' }, 'Nome'), name),
      el('div', { class: 'form-row' }, el('label', { for: 'p-desc' }, 'Descrição'), description),
      el('div', { class: 'form-row' }, el('label', { for: 'p-price' }, 'Preço (R$)'), price, priceError),
      el('div', { class: 'form-row' }, el('label', { for: 'p-sort' }, 'Ordem'), sortOrder),
      groupRow,
      el('div', { class: 'form-row form-row--inline' }, available, el('label', { for: 'p-available' }, 'Disponível')),
      el('div', { class: 'form-row' }, el('label', { for: 'p-image' }, 'Foto'), preview, file,
        el('p', { class: 'form-help' }, 'JPG, PNG ou WEBP, até 2 MB.'), fileError),
      save);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      priceError.textContent = '';
      price.removeAttribute('aria-invalid');
      let body;
      try {
        body = productPayload({
          categoryId: category.value, name: name.value, description: description.value, price: price.value,
          available: available.checked, sortOrder: sortOrder.value, addonGroup: group.value,
        }, categories);
      } catch (err) {
        if (err.field !== 'price') throw err;
        priceError.textContent = err.message;
        price.setAttribute('aria-invalid', 'true');
        price.focus();
        return;
      }
      if (!body.name) {
        toast('Informe o nome do produto.', 'error');
        name.focus();
        return;
      }
      let saved;
      try {
        saved = await withSaving(save, () => adminApi(
          isNew ? '/api/admin/products' : `/api/admin/products/${product.id}`,
          { method: isNew ? 'POST' : 'PUT', body },
        ), { toast });
      } catch {
        return; // withSaving já avisou
      }
      let finalProduct = saved?.product ?? { ...product, ...body };
      const chosen = file.files[0];
      if (chosen) {
        // upload só depois de o produto existir
        try {
          const data = new FormData();
          data.append('image', chosen);
          const uploaded = await withSaving(save, () => adminApi(`/api/admin/products/${finalProduct.id}/image`, { method: 'POST', body: data }), { toast });
          finalProduct = uploaded?.product ?? finalProduct;
        } catch {
          upsert(finalProduct);
          if (isNew) showForm(finalProduct); // produto já existe: segue em edição para tentar a foto de novo
          return;
        }
      }
      upsert(finalProduct);
      showList();
    });

    async function removeProduct(target, button) {
      const ok = await confirmDialog({
        title: `Excluir ${target.name}?`,
        body: 'O produto some do cardápio. Isso não pode ser desfeito.',
        confirmLabel: 'Excluir', danger: true,
      });
      if (!ok) return;
      try {
        await withSaving(button, () => adminApi(`/api/admin/products/${target.id}`, { method: 'DELETE' }), { toast });
        products = products.filter((p) => p.id !== target.id);
        showList();
      } catch (err) {
        if (err.code !== 'PRODUCT_HAS_ORDERS') return;
        const markSoldOut = el('button', { type: 'button', class: 'btn btn--primary btn--block' }, 'Marcar como esgotado');
        markSoldOut.addEventListener('click', async () => {
          try {
            await withSaving(markSoldOut, () => setAvailability(target, false), { toast });
            available.checked = false;
            conflict.hidden = true;
          } catch { /* withSaving já avisou */ }
        });
        render(conflict, el('p', { class: 'form-notice', role: 'alert' }, err.message), markSoldOut);
        conflict.hidden = false;
      }
    }

    render(container, form, conflict, remove, cancel);
    name.focus();
  }

  function upsert(product) {
    const index = products.findIndex((p) => p.id === product.id);
    if (index === -1) products.push(product);
    else products[index] = { ...products[index], ...product };
  }

  await load();
}
