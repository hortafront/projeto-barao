import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('/shared/')) {
    return nextResolve(pathToFileURL(path.join(root, specifier)).href, context);
  }
  return nextResolve(specifier, context);
}
