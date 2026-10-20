import { createMenuRepo } from './menu.repo.js';
import { createOrdersRepo } from './orders.repo.js';
import { createStoreRepo } from './store.repo.js';
import { createProductsRepo } from './products.repo.js';
import { createAuthRepo } from './auth.repo.js';

export function createRepository(supabase) {
  return {
    ...createMenuRepo(supabase),
    ...createOrdersRepo(supabase),
    ...createStoreRepo(supabase),
    ...createProductsRepo(supabase),
    ...createAuthRepo(supabase),
  };
}
