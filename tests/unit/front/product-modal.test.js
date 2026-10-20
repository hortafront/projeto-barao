import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';
import { IDS, seedCategories, seedProducts } from '../../helpers/fakeDb.js';

const { secondFlavorOptions, splitAddons, readSelection, selectionCents } = await import('../../../public/js/product-modal.js');
const { formatBRL } = await import('/shared/money.js');

function buildMenu(mutate = (p) => p) {
  const products = seedProducts().map(mutate);
  return {
    categories: seedCategories().map((c) => ({ ...c, products: products.filter((p) => p.categoryId === c.id) })),
  };
}
const byId = (menu) => new Map(menu.categories.flatMap((c) => c.products).map((p) => [p.id, p]));
const form = (entries) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

test('secondFlavorOptions: 7 pizzas, sem o 1º sabor, sem bebidas/addons', () => {
  const options = secondFlavorOptions(buildMenu(), IDS.calabresa);
  assert.equal(options.length, 7);
  assert.ok(options.every((p) => p.kind === 'pizza' && p.id !== IDS.calabresa));
  assert.ok(options.some((p) => p.id === IDS.frango)); // mistura clássica com especial
});

test('secondFlavorOptions: ignora pizzas esgotadas', () => {
  const menu = buildMenu((p) => (p.id === IDS.bacon ? { ...p, available: false } : p));
  const options = secondFlavorOptions(menu, IDS.calabresa);
  assert.equal(options.length, 6);
  assert.ok(!options.some((p) => p.id === IDS.bacon));
});

test('splitAddons: grupo borda com 2 e Catupiry por cima livre', () => {
  const addons = seedProducts().filter((p) => p.kind === 'addon');
  const { groups, free } = splitAddons(addons);
  assert.deepEqual([...groups.keys()], ['borda']);
  assert.equal(groups.get('borda').length, 2);
  assert.deepEqual(free.map((p) => p.id), [IDS.catupiryCima]);
});

test('readSelection: meio a meio sem 2º sabor está incompleto', () => {
  const sel = readSelection(form([['mode', 'half'], ['quantity', '1']]), IDS.calabresa);
  assert.equal(sel.incomplete, true);
  assert.deepEqual(sel.flavorIds, [IDS.calabresa]);
});

test('readSelection: meio a meio com 2º sabor', () => {
  const sel = readSelection(form([['mode', 'half'], ['second', IDS.frango]]), IDS.calabresa);
  assert.equal(sel.incomplete, false);
  assert.deepEqual(sel.flavorIds, [IDS.calabresa, IDS.frango]);
});

test('readSelection: "Sem borda" não adiciona addon; inteira ignora 2º sabor', () => {
  const sel = readSelection(form([['mode', 'whole'], ['second', IDS.frango], ['addon-group:borda', '']]), IDS.calabresa);
  assert.deepEqual(sel.addonIds, []);
  assert.deepEqual(sel.flavorIds, [IDS.calabresa]);
  assert.equal(sel.kind, 'pizza');
});

test('readSelection: borda + Catupiry por cima = 2 addons', () => {
  const sel = readSelection(form([['addon-group:borda', IDS.bordaCatupiry], ['addon', IDS.catupiryCima]]), IDS.calabresa);
  assert.deepEqual(sel.addonIds, [IDS.bordaCatupiry, IDS.catupiryCima]);
});

test('readSelection: quantidade limitada a 1..20', () => {
  assert.equal(readSelection(form([['quantity', '0']]), IDS.calabresa).quantity, 1);
  assert.equal(readSelection(form([['quantity', '25']]), IDS.calabresa).quantity, 20);
  assert.equal(readSelection(form([['quantity', 'abc']]), IDS.calabresa).quantity, 1);
  assert.equal(readSelection(form([['quantity', '3']]), IDS.calabresa).quantity, 3);
});

test('readSelection: observação aparada em 140 caracteres', () => {
  const sel = readSelection(form([['notes', `  ${'a'.repeat(200)}`]]), IDS.calabresa);
  assert.equal(sel.notes.length, 140);
  assert.equal(readSelection(form([]), IDS.calabresa).notes, '');
});

test('preço ao vivo: Calabresa/Frango + borda Catupiry = R$ 39,49', () => {
  const productsById = byId(buildMenu());
  const sel = readSelection(form([
    ['mode', 'half'], ['second', IDS.frango], ['addon-group:borda', IDS.bordaCatupiry], ['quantity', '1'],
  ]), IDS.calabresa);
  assert.equal(selectionCents(sel, productsById), 3949);
  assert.equal(formatBRL(selectionCents(sel, productsById)), 'R$ 39,49');
});

test('preço ao vivo multiplica pela quantidade', () => {
  const productsById = byId(buildMenu());
  const sel = readSelection(form([['addon', IDS.catupiryCima], ['quantity', '2']]), IDS.calabresa);
  assert.equal(selectionCents(sel, productsById), (3049 + 450) * 2);
});
