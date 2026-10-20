// Efeito colateral: registra o hook que resolve '/shared/...' como no navegador.
import { register } from 'node:module';

register('./browserAliases.hooks.js', import.meta.url);
