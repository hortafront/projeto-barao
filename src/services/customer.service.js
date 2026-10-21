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

export async function deleteAccount(db, userId) {
  await db.deleteCustomerAccount(userId);
}
