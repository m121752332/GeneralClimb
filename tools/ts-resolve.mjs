// Lets `node --test` run the pure TS modules that import each other without extensions
// (`from './I18n'`), as Cocos Creator resolves them: an unresolved relative specifier is retried
// with `.ts`. Loaded with `node --import ./tools/ts-resolve.mjs` (see package.json "test").
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);
