import { ADMIN_PRODUCT_COLUMNS, toProduct, dbError } from './mappers.js';
import { AppError } from '../../errors/AppError.js';

const BUCKET = 'product-images';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const toRow = (p) => Object.fromEntries(Object.entries({
  category_id: p.categoryId, kind: p.kind, name: p.name, description: p.description,
  price_cents: p.priceCents, available: p.available, sort_order: p.sortOrder, addon_group: p.addonGroup,
}).filter(([, v]) => v !== undefined)); // PUT parcial: não sobrescreve com undefined

/** Caminho no bucket a partir da URL pública (parte após '/product-images/'); null se não for do bucket. */
function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  return path || null;
}

export function createProductsRepo(supabase) {
  async function update(id, row, op) {
    const { data, error } = await supabase.from('products').update(row).eq('id', id).select(ADMIN_PRODUCT_COLUMNS).maybeSingle();
    if (error) throw dbError(op, error);
    return data ? toProduct(data) : null;
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

  async function currentImageUrl(id) {
    const { data } = await supabase.from('products').select('image_url').eq('id', id).maybeSingle();
    return data?.image_url ?? null;
  }

  return {
    async listCategories() {
      const { data, error } = await supabase
        .from('categories').select('id, slug, name, sort_order').order('sort_order', { ascending: true });
      if (error) throw dbError('listCategories', error);
      return data.map((c) => ({ id: c.id, slug: c.slug, name: c.name, sortOrder: c.sort_order }));
    },

    /** Todos os produtos (inclusive esgotados), ordenados por categoria e depois sort_order. */
    async listProducts() {
      const { data, error } = await supabase
        .from('products').select(`${ADMIN_PRODUCT_COLUMNS}, categories(sort_order)`);
      if (error) throw dbError('listProducts', error);
      return data
        .sort((a, b) => (a.categories?.sort_order ?? 0) - (b.categories?.sort_order ?? 0)
          || a.sort_order - b.sort_order)
        .map(toProduct);
    },

    async getProductById(id) {
      const { data, error } = await supabase
        .from('products').select(ADMIN_PRODUCT_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw dbError('getProductById', error);
      return data ? toProduct(data) : null;
    },

    async createProduct(input) {
      const { data, error } = await supabase
        .from('products').insert(toRow(input)).select(ADMIN_PRODUCT_COLUMNS).single();
      if (error) throw dbError('createProduct', error);
      return toProduct(data);
    },

    /**
     * true = removido; false = não existe (rota → 404).
     * Lança AppError PRODUCT_HAS_ORDERS (409) se algum order_item referencia o id (product_ids @> array[id]).
     */
    async deleteProduct(id) {
      const { count, error: usedErr } = await supabase
        .from('order_items').select('id', { count: 'exact', head: true })
        .contains('product_ids', [id]); // product_ids @> array[id] (usa o índice GIN)
      if (usedErr) throw dbError('deleteProduct', usedErr);
      if (count > 0) {
        throw new AppError('PRODUCT_HAS_ORDERS', 409, 'Produto já tem pedidos; marque como esgotado em vez de excluir');
      }
      const { data, error } = await supabase.from('products').delete().eq('id', id).select('id, image_url');
      if (error) throw dbError('deleteProduct', error);
      if (data.length === 0) return false;
      await removeImage(data[0].image_url);
      return true;
    },

    updateProduct: (id, patch) => update(id, toRow(patch), 'updateProduct'),
    setProductAvailability: (id, available) => update(id, { available }, 'setProductAvailability'),

    /** Upload pelo servidor (service role). Retorna o produto com imageUrl pública. */
    async uploadProductImage(id, { buffer, contentType }) {
      const oldUrl = await currentImageUrl(id);
      const path = `products/${id}-${Date.now()}.${EXT[contentType]}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(path, buffer, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw dbError('uploadProductImage', error);
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path); // não faz request, não tem error
      const product = await update(id, { image_url: data.publicUrl }, 'uploadProductImage');
      if (product && oldUrl && oldUrl !== data.publicUrl) await removeImage(oldUrl);
      return product;
    },
  };
}
