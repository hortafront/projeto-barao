// STUB (Tarefa 16 substitui este arquivo): mesma assinatura, sem comportamento.
export function createCart({ storage = globalThis.localStorage } = {}) {
  void storage;
  return {
    add() {},
    reconcile() { return { removed: 0 }; },
  };
}
