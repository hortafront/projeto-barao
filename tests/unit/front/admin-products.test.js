import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { kindForCategory, productPayload, groupByCategory } = await import('../../../public/admin/js/products.js');

const categories = [
  { id: 'c-cl', slug: 'classicas', name: 'Clássicas' },
  { id: 'c-es', slug: 'especiais', name: 'Especiais' },
  { id: 'c-be', slug: 'bebidas', name: 'Bebidas' },
  { id: 'c-ad', slug: 'adicionais', name: 'Adicionais' },
];
const base = { categoryId: 'c-cl', name: ' Calabresa ', description: '', price: '34,99', available: true, sortOrder: '3', addonGroup: null };

test('kindForCategory deriva o tipo do slug', () => {
  assert.equal(kindForCategory('classicas'), 'pizza');
  assert.equal(kindForCategory('especiais'), 'pizza');
  assert.equal(kindForCategory('bebidas'), 'drink');
  assert.equal(kindForCategory('adicionais'), 'addon');
});

test('productPayload converte reais em centavos e sempre envia kind', () => {
  const body = productPayload(base, categories);
  assert.equal(body.priceCents, 3499);
  assert.equal(body.kind, 'pizza');
  assert.equal(body.categoryId, 'c-cl');
  assert.equal(body.name, 'Calabresa');
  assert.equal(body.sortOrder, 3);
  assert.equal(body.available, true);
});

test('preço inválido lança { field, message }', () => {
  assert.throws(() => productPayload({ ...base, price: 'abc' }, categories),
    (err) => err.field === 'price' && err.message === 'Preço inválido. Ex.: 34,99');
});

test('adicional com grupo borda envia kind addon e addonGroup borda', () => {
  const body = productPayload({ ...base, categoryId: 'c-ad', addonGroup: 'borda' }, categories);
  assert.equal(body.kind, 'addon');
  assert.equal(body.addonGroup, 'borda');
});

test('grupo marcado em categoria que não é addon vira null', () => {
  const body = productPayload({ ...base, categoryId: 'c-cl', addonGroup: 'borda' }, categories);
  assert.equal(body.kind, 'pizza');
  assert.equal(body.addonGroup, null);
});

test('adicional sem grupo envia addonGroup null', () => {
  assert.equal(productPayload({ ...base, categoryId: 'c-ad', addonGroup: '' }, categories).addonGroup, null);
});

test('groupByCategory segue a ordem das categorias e ordena por sortOrder', () => {
  const products = [
    { id: '1', categoryId: 'c-be', name: 'Guaraná', sortOrder: 1 },
    { id: '2', categoryId: 'c-cl', name: 'B', sortOrder: 2 },
    { id: '3', categoryId: 'c-cl', name: 'A', sortOrder: 1 },
  ];
  const groups = groupByCategory(products, categories);
  assert.deepEqual(groups.map((g) => g.category.slug), ['classicas', 'bebidas']);
  assert.deepEqual(groups[0].products.map((p) => p.id), ['3', '2']);
});
