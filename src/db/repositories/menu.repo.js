import { PRODUCT_COLUMNS, toProduct, dbError } from './mappers.js';

export function createMenuRepo(supabase) {
  return {
    async getMenu() {
      const { data, error } = await supabase
        .from('categories')
        .select(`id, slug, name, sort_order, products(${PRODUCT_COLUMNS})`)
        .order('sort_order', { ascending: true })
        .order('sort_order', { referencedTable: 'products', ascending: true })
        .order('name', { referencedTable: 'products', ascending: true });
      if (error) throw dbError('getMenu', error);
      return data.map((c) => ({
        id: c.id, slug: c.slug, name: c.name, sortOrder: c.sort_order,
        products: (c.products ?? []).map(toProduct),
      }));
    },

    async getProductsByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).in('id', ids);
      if (error) throw dbError('getProductsByIds', error);
      return data.map(toProduct); // ids inexistentes simplesmente não voltam
    },
  };
}
