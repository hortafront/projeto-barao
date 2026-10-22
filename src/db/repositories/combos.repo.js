import { COMBO_SELECT, toCombo, dbError, storagePathFromUrl, BUCKET, IMAGE_EXT } from './mappers.js';
import { AppError } from '../../errors/AppError.js';

const toPayload = (c) => ({
  name: c.name, description: c.description ?? '', price_cents: c.priceCents, weekdays: c.weekdays,
  slots: c.slots.map((s) => ({ label: s.label, kind: s.kind, product_ids: s.productIds })),
});

export function createCombosRepo(supabase) {
  const base = () => supabase.from('combos').select(COMBO_SELECT);
  const slotsOrder = { referencedTable: 'combo_slots' };

  async function read(id, op) {
    const { data, error } = await base().eq('id', id).order('position', slotsOrder).maybeSingle();
    if (error) throw dbError(op, error);
    return data ? toCombo(data) : null;
  }

  async function update(id, row, op) {
    const { data, error } = await supabase.from('combos').update(row).eq('id', id).select(COMBO_SELECT)
      .order('position', slotsOrder).maybeSingle();
    if (error) throw dbError(op, error);
    return data ? toCombo(data) : null;
  }

  /** Best effort: falha ao remover imagem nunca derruba a operação principal. */
  async function removeImage(url) {
    const path = storagePathFromUrl(url);
    if (!path) return;
    try {
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {
      // ignorado de propósito
    }
  }

  return {
    /** Primeiro combo (por created_at) cujo weekdays contém o dia — inclui esgotado. */
    async getTodayCombo(weekday) {
      const { data, error } = await base().contains('weekdays', [weekday])
        .order('created_at', { ascending: true }).order('position', slotsOrder).limit(1);
      if (error) throw dbError('getTodayCombo', error);
      return data.length ? toCombo(data[0]) : null;
    },

    async listCombos() {
      const { data, error } = await base().order('created_at', { ascending: true }).order('position', slotsOrder);
      if (error) throw dbError('listCombos', error);
      return data.map(toCombo);
    },

    getCombo: (id) => read(id, 'getCombo'),

    async getCombosByIds(ids) {
      const { data, error } = await base().in('id', ids).order('position', slotsOrder);
      if (error) throw dbError('getCombosByIds', error);
      return data.map(toCombo);
    },

    /** Combo + vagas numa transação (rpc save_combo); depois relê com as vagas. */
    async createCombo(input) {
      const { data: id, error } = await supabase.rpc('save_combo', { p_id: null, payload: toPayload(input) });
      if (error) throw dbError('createCombo', error);
      return read(id, 'createCombo');
    },

    async updateCombo(id, input) {
      if (!(await read(id, 'updateCombo'))) return null;
      const { error } = await supabase.rpc('save_combo', { p_id: id, payload: toPayload(input) });
      if (error) throw dbError('updateCombo', error);
      return read(id, 'updateCombo');
    },

    /** true = removido; false = não existe. Lança PRODUCT_HAS_ORDERS (409) se algum order_item referencia o combo. */
    async deleteCombo(id) {
      const { count, error: usedErr } = await supabase
        .from('order_items').select('id', { count: 'exact', head: true }).eq('combo_id', id);
      if (usedErr) throw dbError('deleteCombo', usedErr);
      if (count > 0) {
        throw new AppError('PRODUCT_HAS_ORDERS', 409, 'Combo já tem pedidos; marque como esgotado em vez de excluir');
      }
      const { data, error } = await supabase.from('combos').delete().eq('id', id).select('id, image_url');
      if (error) throw dbError('deleteCombo', error);
      if (data.length === 0) return false;
      await removeImage(data[0].image_url);
      return true;
    },

    setComboAvailability: (id, available) => update(id, { available }, 'setComboAvailability'),

    /** Upload pelo servidor (service role). Retorna o combo com imageUrl pública. */
    async uploadComboImage(id, { buffer, contentType }) {
      const { data: cur } = await supabase.from('combos').select('image_url').eq('id', id).maybeSingle();
      const oldUrl = cur?.image_url ?? null;
      const path = `combos/${id}-${Date.now()}.${IMAGE_EXT[contentType]}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(path, buffer, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw dbError('uploadComboImage', error);
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const combo = await update(id, { image_url: data.publicUrl }, 'uploadComboImage');
      if (combo && oldUrl && oldUrl !== data.publicUrl) await removeImage(oldUrl);
      return combo;
    },
  };
}
