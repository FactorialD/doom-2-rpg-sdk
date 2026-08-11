import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execPath } from 'node:process';

const require = createRequire(import.meta.url);
const localTypeScript = fileURLToPath(new URL('../node_modules/typescript/lib/typescript.js', import.meta.url));
const globalTypeScript = resolve(dirname(execPath), '../lib/node_modules/typescript/lib/typescript.js');
const ts = require(existsSync(localTypeScript) ? localTypeScript : globalTypeScript);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@angular/core') return { url: 'test:angular-core', shortCircuit: true };
    if (specifier === 'three') return { url: 'test:three', shortCircuit: true };
    // Service unit tests construct their in-memory file-service doubles and do
    // not exercise archive I/O. Keep that transitive browser dependency from
    // making the unified test command depend on an installed JSZip package.
    if (specifier === 'jszip') return { url: 'test:jszip', shortCircuit: true };
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.match(/\.(?:[cm]?js|ts|json)$/i) && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    if (specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:angular-core') return {
      format: 'module',
      source: `
        export const Injectable = () => target => target;
        export const inject = () => undefined;
        export const effect = callback => callback();
        export const signal = initial => {
          let value = initial;
          return Object.assign(() => value, {
            set(next) { value = next; },
            update(update) { value = update(value); }
          });
        };
      `,
      shortCircuit: true
    };
    if (url === 'test:three') return {
      format: 'module',
      source: 'export class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x=x; this.y=y; this.z=z; } }',
      shortCircuit: true
    };
    if (url === 'test:jszip') return {
      format: 'module',
      source: 'export default class JSZip {}',
      shortCircuit: true
    };
    if (!url.endsWith('.ts')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        experimentalDecorators: true,
        useDefineForClassFields: false
      },
      fileName: fileURLToPath(url)
    });
    return { format: 'module', source: output.outputText, shortCircuit: true };
  }
});
