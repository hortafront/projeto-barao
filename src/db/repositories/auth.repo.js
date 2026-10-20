import { dbError } from './mappers.js';

export function createAuthRepo(supabase) {
  return {
    /** Valida o access_token do admin. null = token inválido/expirado. */
    async getUserByAccessToken(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error) {
        if (error.status && error.status < 500) return null;
        throw dbError('getUserByAccessToken', error);
      }
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
  };
}
