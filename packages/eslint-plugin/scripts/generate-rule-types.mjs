import plugin from '@typescript-eslint/eslint-plugin';
// Public plugin schemas are the source of truth; no private TypeScript-ESLint imports.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const entries = Object.entries(plugin.rules).sort(([a], [b]) => a.localeCompare(b));
const schemas = Object.fromEntries(entries.map(([name, rule]) => [name, rule.meta.schema]));
export const schemaHash = createHash('sha256').update(JSON.stringify(schemas)).digest('hex');
const fallbacks = new Set();

function convert(schema, root, name) {
  if (schema === true || (schema && !Object.keys(schema).length)) return 'unknown';
  if (schema === false) return 'never';
  if (!schema || typeof schema !== 'object') { fallbacks.add(name); return 'unknown'; }
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) { fallbacks.add(name); return 'unknown'; }
    const target = schema.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1','/').replaceAll('~0','~')], root);
    return target ? convert(target, root, name) : (fallbacks.add(name), 'unknown');
  }
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const);
  if (schema.oneOf || schema.anyOf) return `(${(schema.oneOf ?? schema.anyOf).map((entry) => convert(entry, root, name)).join(' | ')})`;
  if (schema.allOf) return `(${schema.allOf.map((entry) => convert(entry, root, name)).join(' & ')})`;
  if (Array.isArray(schema.type)) return `(${schema.type.map((type) => convert({...schema,type},root,name)).join(' | ')})`;
  switch (schema.type) {
    case 'string': return 'string';
    case 'integer': case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'array': {
      if (Array.isArray(schema.items)) {
        const min = schema.minItems ?? 0;
        const items = schema.items.slice(0, schema.maxItems ?? schema.items.length).map((entry, index) => `(${convert(entry, root, name)})${index < min ? '' : '?'}`);
        if (schema.additionalItems && schema.maxItems === undefined) items.push(`...(${convert(schema.additionalItems, root, name)})[]`);
        return `[${items.join(', ')}]`;
      }
      return `(${convert(schema.items ?? {}, root, name)})[]`;
    }
    case 'object': {
      const properties = Object.entries(schema.properties ?? {}).map(([key, entry]) => `${JSON.stringify(key)}${schema.required?.includes(key) ? '' : '?'}: ${convert(entry, root, name)}`);
      if (schema.additionalProperties !== false || schema.patternProperties) {
        // JSON Schema pattern keys cannot be represented exactly in a TypeScript object.
        if (schema.patternProperties) fallbacks.add(name);
        properties.push(`[key: string]: ${schema.additionalProperties && typeof schema.additionalProperties === 'object' ? convert(schema.additionalProperties, root, name) : 'unknown'}`);
      }
      return `{ ${properties.join('; ')} }`;
    }
    default: fallbacks.add(name); return 'unknown';
  }
}

export function generatedTypes() {
  const rules = entries.map(([name, rule]) => {
    const schema = rule.meta.schema;
    const root = Array.isArray(schema) ? {type:'array',items:schema} : schema;
    const options = convert(root, root, name);
    return `  ${JSON.stringify(`@typescript-eslint/${name}`)}: Linter.RuleEntry<${options}>;`;
  });
  return [
    '// Generated from @typescript-eslint/eslint-plugin 8.72.1 public meta.schema. Run pnpm types:generate.',
    '// Types express schema shapes, not numeric bounds, regexp patterns or semantic combinations.',
    `// Schemas with a permissive fallback: ${[...fallbacks].sort().join(', ') || 'none'}.`,
    'import type { Linter } from "eslint";',
    `export const typeScriptRuleSchemaHash = ${JSON.stringify(schemaHash)};`,
    'export interface TypeScriptRules {', ...rules, '}', '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = new URL('../src/', import.meta.url);
  await mkdir(directory, {recursive:true});
  await writeFile(new URL('typescript-rules.generated.ts',directory), generatedTypes());
}
