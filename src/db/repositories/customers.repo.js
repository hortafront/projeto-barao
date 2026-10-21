import { toAddress, ADDRESS_COLUMNS, dbError } from './mappers.js';

const fields = (d) => ({
  label: d.label || null, street: d.street, number: d.number, district: d.district, reference: d.reference || null,
});
const firstRow = (data) => (Array.isArray(data) ? (data[0] ?? null) : (data ?? null));

export function createCustomersRepo(supabase) {
  // set_default_address(p_user_id, p_address_id): desmarca o padrão atual e marca este, atomicamente.
  // Devolve a linha do endereço; 0 linhas = id não é deste cliente.
  async function rpcSetDefault(op, userId, addressId) {
    const { data, error } = await supabase.rpc('set_default_address', { p_user_id: userId, p_address_id: addressId });
    if (error) throw dbError(op, error);
    const row = firstRow(data);
    return row ? toAddress(row) : null;
  }

  return {
    async getCustomer(userId) {
      const { data, error } = await supabase
        .from('customers').select('name, phone').eq('user_id', userId).maybeSingle();
      if (error) throw dbError('getCustomer', error);
      return data ? { name: data.name, phone: data.phone } : null;
    },

    async upsertCustomer(userId, { name, phone }) {
      const { data, error } = await supabase
        .from('customers').upsert({ user_id: userId, name, phone }, { onConflict: 'user_id' })
        .select('name, phone').single();
      if (error) throw dbError('upsertCustomer', error);
      return { name: data.name, phone: data.phone };
    },

    async listAddresses(userId) {
      const { data, error } = await supabase
        .from('customer_addresses').select(ADDRESS_COLUMNS).eq('user_id', userId)
        .order('is_default', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw dbError('listAddresses', error);
      return data.map(toAddress);
    },

    async createAddress(userId, data) {
      const { data: row, error } = await supabase
        .from('customer_addresses').insert({ user_id: userId, ...fields(data) })
        .select(ADDRESS_COLUMNS).single();
      if (error) throw dbError('createAddress', error);
      if (data.isDefault === true) return (await rpcSetDefault('createAddress', userId, row.id)) ?? toAddress(row);
      return toAddress(row);
    },

    async updateAddress(userId, id, data) {
      const { data: row, error } = await supabase
        .from('customer_addresses').update(fields(data)).eq('id', id).eq('user_id', userId)
        .select(ADDRESS_COLUMNS).maybeSingle();
      if (error) throw dbError('updateAddress', error);
      if (!row) return null;
      if (data.isDefault === true) return (await rpcSetDefault('updateAddress', userId, id)) ?? toAddress(row);
      return toAddress(row);
    },

    async deleteAddress(userId, id) {
      const { data, error } = await supabase.rpc('delete_customer_address', { p_user_id: userId, p_address_id: id });
      if (error) throw dbError('deleteAddress', error);
      return data === true;
    },

    async setDefaultAddress(userId, id) {
      return rpcSetDefault('setDefaultAddress', userId, id);
    },

    /** Apaga o usuário no Supabase Auth; perfil/endereços saem por cascade e orders.customer_id vira null. */
    async deleteCustomerAccount(userId) {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw dbError('deleteCustomerAccount', error);
    },
  };
}
