// Rewrites the extension's ES modules into the module format GNOME Shell 42 to 44 loads.

const ME_LINE = 'const Me = imports.misc.extensionUtils.getCurrentExtension();';
const LEGACY_ROOT = "Me.imports['src-legacy']";
const IMPORT = /^import\s+([^;'"]*?)\s*from\s+'([^']+)';?[ \t]*$/gm;
const SHELL_EXTENSIONS = new RegExp(
    '^resource:///org/gnome/[Ss]hell/(?:[Ee]xtensions/js/)?extensions/(?:extension|prefs)\\.js$');
const SHIM_BINDINGS = ['Extension', 'ExtensionPreferences'];
const SHELL_MODULE = /^resource:\/\/\/org\/gnome\/shell\/(ui|misc)\/(\w+)\.js$/;

function accessor(segment) {
    return /^[A-Za-z_]\w*$/.test(segment) ? `.${segment}` : `['${segment}']`;
}

// Resolves a relative import to a path from the extension root.
function resolveRelative(file, specifier) {
    const parts = file.split('/').slice(0, -1);
    for (const part of specifier.split('/')) {
        if (part === '..')
            parts.pop();
        else if (part !== '.')
            parts.push(part);
    }
    return parts;
}

function legacyPath(file, specifier) {
    const parts = resolveRelative(file, specifier);
    if (parts[0] !== 'src')
        throw new Error(`${file}: cannot import '${specifier}' outside src/`);
    parts[parts.length - 1] = parts[parts.length - 1].replace(/\.js$/, '');
    return LEGACY_ROOT + parts.slice(1).map(accessor).join('');
}

// Joins a multi-line binding list onto one line: '{\n  A,\n  B,\n}' becomes '{A, B}'.
function tidyBraces(bindings) {
    return bindings.replace(/\s+/g, ' ').replace(/\{ /, '{').replace(/,? \}/, '}');
}

// Returns the replacement text for one import, or null when the form is not supported.
function convertImport(file, bindings, specifier) {
    const gi = specifier.match(/^gi:\/\/(\w+)(?:\?version=([\w.]+))?$/);
    if (gi) {
        const [, name, version] = gi;
        const line = `const ${bindings} = imports.gi.${name};`;
        return version ? `imports.gi.versions.${name} = '${version}';\n${line}` : line;
    }
    if (specifier === 'cairo' || specifier === 'system')
        return `const ${bindings} = imports.${specifier};`;
    const shell = specifier.match(SHELL_MODULE);
    if (shell && bindings.startsWith('* as '))
        return `const ${bindings.slice(5)} = imports.${shell[1]}.${shell[2]};`;
    const extensions = specifier.match(SHELL_EXTENSIONS);
    if (extensions) {
        const names = bindings.replace(/[{}]/g, '').split(',').map(name => name.trim())
            .filter(Boolean);
        const unknown = names.find(name => !SHIM_BINDINGS.includes(name));
        if (unknown)
            throw new Error(`${file}: the shim has no '${unknown}' to import from '${specifier}'`);
        return `const ${bindings} = ${LEGACY_ROOT}.shim;`;
    }
    if (specifier.startsWith('.') && bindings.startsWith('{')) {
        if (/\bas\b/.test(bindings))
            throw new Error(`${file}: cannot rename an import from '${specifier}'`);
        return `const ${tidyBraces(bindings)} = ${legacyPath(file, specifier)};`;
    }
    return null;
}

function entryPoint(file, className) {
    if (file === 'extension.js')
        return `function init(meta) { return new ${className}(meta.metadata); }`;
    return 'function init() {}\n' +
        'function fillPreferencesWindow(window) {\n' +
        `    new ${className}(Me.metadata).fillPreferencesWindow(window);\n` +
        '}';
}

/**
 * Converts one ES module to the pre-45 module format.
 *
 * Args:
 *   text: Source of the module.
 *   file: Path of the module relative to the extension root, such as 'prefs.js'.
 *
 * Returns:
 *   The converted source.
 *
 * Throws:
 *   Error: When an import or export statement has a form the converter does not handle.
 */
export function convertModule(text, file) {
    const isEntry = file === 'extension.js' || file === 'prefs.js';
    const className = text.match(/^export default class (\w+)/m)?.[1];
    if (isEntry && !className)
        throw new Error(`${file}: no default-exported class`);

    let out = text.replace(IMPORT, (statement, bindings, specifier) =>
        convertImport(file, bindings, specifier) ?? statement);
    out = out
        .replace(/^export default class /gm, 'class ')
        .replace(/^export ((?:async )?function\b)/gm, '$1')
        .replace(/^export (?:const|let) /gm, 'var ')
        .replace(/^export class (\w+)/gm, 'var $1 = class $1');

    const leftover = out.match(/^(?:import|export)\b.*$/m);
    if (leftover)
        throw new Error(`${file}: unsupported statement: ${leftover[0]}`);

    if (out.includes('Me.imports') || file === 'prefs.js')
        out = out.replace(/^(#!.*\n)?/, `$1${ME_LINE}\n`);
    return isEntry ? `${out.replace(/\n*$/, '\n')}\n${entryPoint(file, className)}\n` : out;
}
