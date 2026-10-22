import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';
import { IDS, seedProducts } from '../../helpers/fakeDb.js';

const { comboSelectionComplete, comboSelectionCents, describeComboSlots } = await import('../../../public/js/combo-modal.js');

const products = new Map(seedProducts().map((p) => [p.id, p]));
const combo = {
  id: 'combo-1', kind: 'combo', name: 'Combo Família', description: '', priceCents: 5990, imageUrl: null, available: true,
  slots: [
    { id: 's1', position: 0, label: 'Pizza', kind: 'pizza', productIds: [IDS.calabresa, IDS.frango, IDS.bacon] },
    { id: 's2', position: 1, label: 'Bebida', kind: 'drink', productIds: [IDS.coca1l, IDS.guarana1l] },
  ],
};
const pizzaSlot = (flavorIds, addonIds = []) => ({ kind: 'pizza', flavorIds, addonIds });
const drinkSlot = (productId) => ({ kind: 'drink', productId });

test('comboSelectionComplete: só com todas as vagas preenchidas e permitidas', () => {
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa]), drinkSlot(IDS.coca1l)]), true);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa], [IDS.bordaCatupiry]), drinkSlot(IDS.guarana1l)]), true);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa])]), false);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa]), null]), false);
  assert.equal(comboSelectionComplete(combo, [null, drinkSlot(IDS.coca1l)]), false);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([]), drinkSlot(IDS.coca1l)]), false);
  assert.equal(comboSelectionComplete(combo, [drinkSlot(IDS.coca1l), pizzaSlot([IDS.calabresa])]), false);
});

test('comboSelectionComplete: sabor ou bebida fora da vaga não vale; meio a meio precisa de 2 distintos', () => {
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.mista]), drinkSlot(IDS.coca1l)]), false);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa]), drinkSlot(IDS.coca600)]), false);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa, IDS.frango]), drinkSlot(IDS.coca1l)]), true);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa, IDS.calabresa]), drinkSlot(IDS.coca1l)]), false);
  assert.equal(comboSelectionComplete(combo, [pizzaSlot([IDS.calabresa, IDS.frango, IDS.bacon]), drinkSlot(IDS.coca1l)]), false);
});

test('comboSelectionCents: preço do combo + adicionais, vezes a quantidade; sabor não altera preço', () => {
  const plain = [pizzaSlot([IDS.calabresa]), drinkSlot(IDS.coca1l)];
  assert.equal(comboSelectionCents(combo, plain, products), 5990);
  assert.equal(comboSelectionCents(combo, [pizzaSlot([IDS.bacon, IDS.calabresa]), drinkSlot(IDS.coca1l)], products), 5990);
  const withAddons = [pizzaSlot([IDS.calabresa, IDS.frango], [IDS.bordaCatupiry, IDS.catupiryCima]), drinkSlot(IDS.coca1l)];
  assert.equal(comboSelectionCents(combo, withAddons, products, 2), (5990 + 450 + 450) * 2);
  assert.equal(comboSelectionCents(combo, [null, null], products), 5990);
});

test('describeComboSlots: mesmas descrições do servidor', () => {
  assert.deepEqual(
    describeComboSlots(combo, [pizzaSlot([IDS.calabresa]), drinkSlot(IDS.coca1l)], products),
    ['Pizza Calabresa', 'Coca-Cola 1 Litro'],
  );
  assert.deepEqual(
    describeComboSlots(combo, [pizzaSlot([IDS.calabresa, IDS.frango]), drinkSlot(IDS.guarana1l)], products),
    ['Pizza meio a meio: Calabresa / Frango', 'Guaraná 1 Litro'],
  );
});
