import { toOrder, dbError, localDayRangeToIso } from './mappers.js';

export function createOrdersRepo(supabase) {
  return {
    /** draft: ver barao-pedido-whatsapp (order.service). Retorna { id, code, createdAt }. */
    async createOrder(draft) {
      const a = draft.address;
      const payload = {
        customer_name: draft.customer.name,
        customer_phone: draft.customer.phone,
        fulfillment: draft.fulfillment,
        address_street: a?.street ?? null,
        address_number: a?.number ?? null,
        address_district: a?.district ?? null,
        address_reference: a?.reference || null,
        payment_method: draft.payment.method,
        change_for_cents: draft.payment.changeForCents ?? null,
        notes: draft.notes ?? null,
        subtotal_cents: draft.subtotalCents,
        items: draft.items.map((i) => ({
          kind: i.kind, description: i.description, product_ids: i.productIds,
          flavor_names: i.flavorNames,
          addons: (i.addons ?? []).map((ad) => ({ name: ad.name, priceCents: ad.priceCents })), // jsonb snapshot
          base_unit_cents: i.baseUnitCents, unit_price_cents: i.unitPriceCents, quantity: i.quantity,
          notes: i.notes ?? null, line_total_cents: i.lineTotalCents,
        })),
      };
      const { data, error } = await supabase.rpc('create_order', { payload });
      if (error) throw dbError('createOrder', error);
      return { id: data.id, code: data.code, createdAt: data.created_at };
    },

    async listOrders({ from, to, page = 1, pageSize = 20 }) {
      const { fromIso, toIso } = localDayRangeToIso(from, to);
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await supabase
        .from('orders')
        .select('*, order_items(*)', { count: 'exact' })
        .gte('created_at', fromIso).lt('created_at', toIso)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw dbError('listOrders', error);
      return { orders: data.map(toOrder), total: count ?? 0, page, pageSize };
    },

    async getOrderById(id) {
      const { data, error } = await supabase
        .from('orders').select('*, order_items(*)').eq('id', id).maybeSingle();
      if (error) throw dbError('getOrderById', error);
      return data ? toOrder(data) : null;
    },

    async updateOrderStatus(id, status) {
      const { data, error } = await supabase
        .from('orders').update({ status }).eq('id', id).select('*, order_items(*)').maybeSingle();
      if (error) throw dbError('updateOrderStatus', error);
      return data ? toOrder(data) : null;
    },

    async getOrdersSummary({ from, to }) {
      const { fromIso, toIso } = localDayRangeToIso(from, to);
      const { data, error } = await supabase.rpc('orders_summary', { p_from: fromIso, p_to: toIso });
      if (error) throw dbError('getOrdersSummary', error);
      return { ordersCount: data.orders_count, grossCents: data.gross_cents, topItems: data.top_items };
    },
  };
}
