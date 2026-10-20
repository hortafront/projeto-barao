import { dbError } from './mappers.js';

const toHours = (r) => ({ weekday: r.weekday, opensAt: r.opens_at.slice(0, 5), closesAt: r.closes_at.slice(0, 5), isClosed: r.is_closed });
const toSettings = (r) => ({ storeOverride: r.store_override, whatsappNumber: r.whatsapp_number, updatedAt: r.updated_at });

export function createStoreRepo(supabase) {
  return {
    async getHours() {
      const { data, error } = await supabase.from('business_hours').select('*').order('weekday');
      if (error) throw dbError('getHours', error);
      return data.map(toHours);
    },
    async updateHours(days) { // array dos 7 dias já validado (hours.schema.js)
      const rows = days.map((d) => ({ weekday: d.weekday, opens_at: d.opensAt, closes_at: d.closesAt, is_closed: d.isClosed }));
      const { data, error } = await supabase.from('business_hours').upsert(rows, { onConflict: 'weekday' }).select('*').order('weekday');
      if (error) throw dbError('updateHours', error);
      return data.map(toHours);
    },
    async getSettings() {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
      if (error) throw dbError('getSettings', error);
      return toSettings(data);
    },
    /** Só os campos informados mudam: { storeOverride?, whatsappNumber? } (já validados pelo settingsSchema). */
    async updateSettings({ storeOverride, whatsappNumber } = {}) {
      const patch = {};
      if (storeOverride !== undefined) patch.store_override = storeOverride;
      if (whatsappNumber !== undefined) patch.whatsapp_number = whatsappNumber; // check SQL '^55[0-9]{10,11}$' (23514 se inválido)
      const { data, error } = await supabase.from('settings').update(patch).eq('id', 1).select('*').single();
      if (error) throw dbError('updateSettings', error);
      return toSettings(data);
    },
  };
}
