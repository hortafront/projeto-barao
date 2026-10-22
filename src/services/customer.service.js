import { AppError } from '../errors/AppError.js';

export const MAX_ADDRESSES = 10;

const notFound = () => new AppError('NOT_FOUND', 404, 'Endereço não encontrado.');

export async function getAccount(db, { id, email }) {
  const profile = await db.getCustomer(id);
  if (!profile) return { email, profile: null, addresses: [] };
  return { email, profile, addresses: await db.listAddresses(id) };
}

export async function saveProfile(db, userId, { name, phone }) {
  const saved = await db.upsertCustomer(userId, { name, phone });
  return { name: saved.name, phone: saved.phone };
}

export async function addAddress(db, userId, data) {
  if (!(await db.getCustomer(userId))) {
    throw new AppError('VALIDATION_ERROR', 400, 'Complete seu perfil antes de salvar endereços.');
  }
  const count = (await db.listAddresses(userId)).length;
  if (count >= MAX_ADDRESSES) {
    throw new AppError('VALIDATION_ERROR', 400, `Você pode salvar até ${MAX_ADDRESSES} endereços.`);
  }
  return db.createAddress(userId, { ...data, isDefault: data.isDefault === true || count === 0 });
}

export async function editAddress(db, userId, id, data) {
  const updated = await db.updateAddress(userId, id, data);
  if (!updated) throw notFound();
  return updated;
}

export async function removeAddress(db, userId, id) {
  if (!(await db.deleteAddress(userId, id))) throw notFound();
}

export async function makeDefaultAddress(db, userId, id) {
  const address = await db.setDefaultAddress(userId, id);
  if (!address) throw notFound();
  return address;
}

/**
 * Recusa apagar o usuário do Auth se o e-mail é de administrador (mesma normalização do requireAdmin):
 * com cadastro aberto, qualquer um poderia recriar o e-mail e entrar no painel.
 */
export async function deleteAccount(db, { id, email }, adminEmails = []) {
  const normalized = (email ?? '').trim().toLowerCase();
  const isAdmin = adminEmails.some((e) => e.trim().toLowerCase() === normalized && normalized !== '');
  if (isAdmin) throw new AppError('FORBIDDEN', 403, 'A conta do administrador não pode ser excluída por aqui.');
  await db.deleteCustomerAccount(id);
}
