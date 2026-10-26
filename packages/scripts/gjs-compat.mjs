// Lets the pure-module tests in tests/ run under Node: they only need gjs's `print` and the
// `system` module. Use with `node --import ./packages/scripts/gjs-compat.mjs <test>`.
import {register} from 'node:module';

globalThis.print = (...args) => console.log(...args);
globalThis.printerr = (...args) => console.error(...args);

const system = 'export default {exit: code => process.exit(code)};';
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
    if (specifier === 'system')
        return {url: 'data:text/javascript,${encodeURIComponent(system)}', shortCircuit: true};
    return next(specifier, context);
}`)}`);
