// Module resolve hook registered by tools/ts-resolve.mjs.
const RELATIVE = /^\.{1,2}\//;
const HAS_EXT = /\.[cm]?[jt]s$/;

export async function resolve(specifier, context, next) {
    try {
        return await next(specifier, context);
    } catch (err) {
        if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !RELATIVE.test(specifier) || HAS_EXT.test(specifier)) throw err;
        return next(`${specifier}.ts`, context);
    }
}
