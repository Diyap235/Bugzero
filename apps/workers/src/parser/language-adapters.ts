import { createHash } from 'node:crypto';

import ts from 'typescript';
import type { CodeEntity, CodeRelationship, ParseStatus } from '@bugzero/contracts';

import type { LanguageAdapter, ParseInput, ParsedFileResult, SupportedLanguage } from './types.js';

const parserVersion = 'bugzero-parser-v2';
const irVersion = 'bugzero-ir-v2';

export function normalizeLanguage(language: string): SupportedLanguage {
  switch (language.toLowerCase()) {
    case 'python':
      return 'Python';
    case 'javascript':
      return 'JavaScript';
    case 'typescript':
      return 'TypeScript';
    default:
      return 'UNKNOWN';
  }
}

export function buildCacheKey(input: ParseInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      language: input.language,
      contentHash: input.contentHash,
      parserVersion,
      irVersion,
    }))
    .digest('hex');
}

function stableId(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createEntity(
  input: ParseInput,
  name: string,
  kind: CodeEntity['kind'],
  qualifiedName: string,
  start: number,
  end: number,
): CodeEntity {
  const content = input.sourceContent;
  const beforeStart = content.slice(0, start);
  const beforeEnd = content.slice(0, end);
  const startLine = beforeStart.split(/\r\n|\r|\n/).length;
  const endLine = beforeEnd.split(/\r\n|\r|\n/).length;
  const startColumn = start - Math.max(beforeStart.lastIndexOf('\n'), beforeStart.lastIndexOf('\r')) - 1;
  const endColumn = end - Math.max(beforeEnd.lastIndexOf('\n'), beforeEnd.lastIndexOf('\r')) - 1;
  const normalizedPath = input.filePath.replace(/\\/g, '/');

  return {
    id: stableId(`${input.repositoryId}:${input.commitId}:${normalizedPath}:${kind}:${qualifiedName}`),
    repositoryId: input.repositoryId,
    commitId: input.commitId,
    filePath: normalizedPath,
    kind,
    name,
    qualifiedName,
    language: input.language,
    startLine,
    endLine,
    startColumn,
    endColumn,
    sourceFingerprint: input.contentHash,
    provenance: { parserVersion, sourceStart: start, sourceEnd: end },
  };
}

function createRelationship(
  source: CodeEntity,
  target: CodeEntity,
  kind: CodeRelationship['kind'],
  resolution: CodeRelationship['resolution'] = 'EXACT',
): CodeRelationship {
  return {
    id: stableId(`${source.id}:${kind}:${target.id}`),
    sourceEntityId: source.id,
    targetEntityId: target.id,
    kind,
    resolution,
    confidence: resolution === 'EXACT' ? 1 : 0.5,
    provenance: { parserVersion },
  };
}

interface CallReference {
  callerId: string;
  name: string;
  className?: string;
}

function parseTypeScript(input: ParseInput): ParsedFileResult {
  const started = Date.now();
  const scriptKind = input.filePath.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX
    : input.filePath.toLowerCase().endsWith('.jsx') ? ts.ScriptKind.JSX
      : input.language === 'TypeScript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(input.filePath, input.sourceContent, ts.ScriptTarget.Latest, true, scriptKind);
  const entities: CodeEntity[] = [];
  const relationships: CodeRelationship[] = [];
  const moduleEntity = createEntity(input, 'module', 'MODULE', `${input.filePath.replace(/\\/g, '/')}::module`, 0, input.sourceContent.length);
  entities.push(moduleEntity);
  const functionEntitiesByName = new Map<string, CodeEntity[]>();
  const methodEntitiesByClassAndName = new Map<string, CodeEntity[]>();
  const variableEntitiesByName = new Map<string, CodeEntity[]>();
  const callReferences: CallReference[] = [];
  const shadowedNamesByFunction = new Map<string, Set<string>>();
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  const sourceEnd = input.sourceContent.length;

  function visit(node: ts.Node, containingEntity: CodeEntity, className?: string): void {
    let currentEntity = containingEntity;
    let currentClass = className;

    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const classNameText = node.name?.text;
      if (classNameText) {
        const entity = createEntity(
          input,
          classNameText,
          'CLASS',
          `${containingEntity.qualifiedName}.${classNameText}`,
          node.getStart(source),
          node.end,
        );
        entities.push(entity);
        relationships.push(createRelationship(containingEntity, entity, 'DECLARES'));
        currentEntity = entity;
        currentClass = classNameText;
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && containingEntity !== moduleEntity) {
      const entity = createEntity(
        input,
        node.name.text,
        'VARIABLE',
        `${containingEntity.qualifiedName}.variable:${node.name.text}`,
        node.name.getStart(source),
        node.name.end,
      );
      entities.push(entity);
      relationships.push(createRelationship(containingEntity, entity, 'DECLARES'));
      const namedVariables = variableEntitiesByName.get(node.name.text) ?? [];
      namedVariables.push(entity);
      variableEntitiesByName.set(node.name.text, namedVariables);
    } else if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      if (node.body) {
        const name = getTypeScriptFunctionName(node);
        if (name) {
          const kind = ts.isMethodDeclaration(node) ? 'METHOD' : 'FUNCTION';
          const classPrefix = className ? `${className}.` : '';
          const entity = createEntity(
            input,
            name,
            kind,
            `${containingEntity.qualifiedName}.${classPrefix}${name}`,
            node.getStart(source),
            node.end,
          );
          entities.push(entity);
          relationships.push(createRelationship(containingEntity, entity, 'DECLARES'));
          currentEntity = entity;

          const nameIndex = functionEntitiesByName.get(name) ?? [];
          nameIndex.push(entity);
          functionEntitiesByName.set(name, nameIndex);
          if (className) {
            const key = `${className}.${name}`;
            const methodIndex = methodEntitiesByClassAndName.get(key) ?? [];
            methodIndex.push(entity);
            methodEntitiesByClassAndName.set(key, methodIndex);
          }

          for (const [index, parameter] of node.parameters.entries()) {
            const parameterName = parameter.name.getText(source);
            const parameterEntity = createEntity(
              input,
              parameterName,
              'PARAMETER',
              `${entity.qualifiedName}.parameter:${index}:${parameterName}`,
              parameter.getStart(source),
              parameter.end,
            );
            entities.push(parameterEntity);
            relationships.push(createRelationship(entity, parameterEntity, 'DECLARES'));
          }
          const shadowedNames = new Set(node.parameters.flatMap((parameter) =>
            ts.isIdentifier(parameter.name) ? [parameter.name.text] : []));
          functionLocalBindings(node).forEach((name) => shadowedNames.add(name));
          shadowedNamesByFunction.set(entity.id, shadowedNames);
        }
      }
    }

    if (ts.isIdentifier(node) && currentEntity !== moduleEntity && isIdentifierReference(node)) {
      const variables = variableEntitiesByName.get(node.text) ?? [];
      if (variables.length === 1) {
        relationships.push(createRelationship(currentEntity, variables[0], 'READS'));
      }
    }

    if (ts.isCallExpression(node) && currentEntity !== moduleEntity) {
      if (ts.isIdentifier(node.expression)) {
        callReferences.push({ callerId: currentEntity.id, name: node.expression.text });
      } else if (ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && currentClass) {
        callReferences.push({
          callerId: currentEntity.id,
          name: node.expression.name.text,
          className: currentClass,
        });
      }
    }

    ts.forEachChild(node, (child) => visit(child, currentEntity, currentClass));
  }

  function getTypeScriptFunctionName(node: ts.SignatureDeclaration): string | undefined {
    if (node.name) {
      return node.name.getText(source);
    }
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer === node) {
      return parent.name.text;
    }
    if (ts.isPropertyDeclaration(parent) && parent.name && parent.initializer === node) {
      return parent.name.getText(source);
    }
    return undefined;
  }

  function isIdentifierReference(node: ts.Identifier): boolean {
    const parent = node.parent;
    if ((ts.isVariableDeclaration(parent) && parent.name === node)
      || (ts.isParameter(parent) && parent.name === node)
      || ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)
        || ts.isMethodDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name === node)
      || ((ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name === node)
      || (ts.isPropertyAccessExpression(parent) && parent.name === node)
      || (ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.expression.kind === ts.SyntaxKind.ThisKeyword)) {
      return false;
    }
    return true;
  }

  function functionLocalBindings(node: ts.FunctionLikeDeclaration): string[] {
    const bindings = new Set<string>();
    if (!node.body) return [];
    const collect = (child: ts.Node): void => {
      if (child !== node.body && (ts.isFunctionDeclaration(child) || ts.isMethodDeclaration(child)
        || ts.isFunctionExpression(child) || ts.isArrowFunction(child))) return;
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) bindings.add(child.name.text);
      if (ts.isFunctionDeclaration(child) && child.name) bindings.add(child.name.text);
      ts.forEachChild(child, collect);
    };
    collect(node.body);
    return Array.from(bindings);
  }

  visit(source, moduleEntity);
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  for (const reference of callReferences) {
    const possible = reference.className
      ? methodEntitiesByClassAndName.get(`${reference.className}.${reference.name}`) ?? []
      : (functionEntitiesByName.get(reference.name) ?? []).filter((entity) => entity.kind === 'FUNCTION');
    if (possible.length !== 1) continue;
    const caller = entitiesById.get(reference.callerId);
    const target = possible[0];
    if (!reference.className && shadowedNamesByFunction.get(reference.callerId)?.has(reference.name)) continue;
    if (caller && target && caller.id !== target.id) {
      relationships.push(createRelationship(caller, target, 'CALLS'));
    }
  }

  const resultStatus: ParseStatus = diagnostics.length > 0 ? 'PARTIAL' : 'PARSED';
  return {
    status: resultStatus,
    language: input.language,
    parserVersion,
    irVersion,
    durationMs: Date.now() - started,
    entityCount: entities.length,
    relationshipCount: relationships.length,
    entities,
    relationships,
    diagnostics,
    cacheKey: buildCacheKey(input),
  };
}

function maskPythonStringsAndComments(source: string): string {
  const output = source.split('');
  let quote: string | null = null;
  let triple = false;
  let escaped = false;
  let comment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextThree = source.slice(index, index + 3);
    if (comment) {
      if (character === '\n' || character === '\r') comment = false;
      else output[index] = ' ';
      continue;
    }
    if (quote) {
      if (character !== '\n' && character !== '\r') output[index] = ' ';
      if (triple && nextThree === quote.repeat(3) && !escaped) {
        output[index + 1] = ' ';
        output[index + 2] = ' ';
        index += 2;
        quote = null;
        triple = false;
      } else if (!triple && character === quote && !escaped) {
        quote = null;
      }
      escaped = character === '\\' && !escaped;
      if (character !== '\\') escaped = false;
      continue;
    }
    if (character === '#') {
      output[index] = ' ';
      comment = true;
      continue;
    }
    if (nextThree === "'''" || nextThree === '"""') {
      quote = character;
      triple = true;
      output[index] = output[index + 1] = output[index + 2] = ' ';
      index += 2;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output[index] = ' ';
    }
  }
  return output.join('');
}

function pythonIndent(line: string): number {
  let indent = 0;
  for (const character of line) {
    if (character === ' ') indent += 1;
    else if (character === '\t') indent += 8 - (indent % 8);
    else break;
  }
  return indent;
}

function splitPythonParameters(signature: string): string[] {
  const parameters: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < signature.length; index += 1) {
    const character = signature[index];
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      parameters.push(signature.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = signature.slice(start).trim();
  if (last) parameters.push(last);
  return parameters.filter((parameter) => parameter !== '/' && parameter !== '*');
}

interface PythonDefinition {
  entity: CodeEntity;
  indent: number;
  lineIndex: number;
  bodyEndOffset: number;
  className?: string;
  parentFunction?: CodeEntity;
}

function parsePython(input: ParseInput): ParsedFileResult {
  const started = Date.now();
  const source = input.sourceContent;
  const masked = maskPythonStringsAndComments(source);
  const lines = source.split(/\r\n|\r|\n/);
  const maskedLines = masked.split(/\r\n|\r|\n/);
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const entities: CodeEntity[] = [];
  const relationships: CodeRelationship[] = [];
  const diagnostics: string[] = [];
  const moduleEntity = createEntity(input, 'module', 'MODULE', `${input.filePath.replace(/\\/g, '/')}::module`, 0, source.length);
  entities.push(moduleEntity);

  const classes: Array<{ entity: CodeEntity; indent: number; lineIndex: number }> = [];
  const definitions: PythonDefinition[] = [];
  const classPattern = /^([ \t]*)class\s+([A-Za-z_]\w*)\b/m;
  for (let index = 0; index < maskedLines.length; index += 1) {
    const match = classPattern.exec(maskedLines[index]);
    if (!match) continue;
    const classIndent = pythonIndent(match[1]);
    let endLine = index;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() && pythonIndent(lines[next]) <= classIndent) break;
      if (lines[next].trim()) endLine = next;
    }
    let startLine = index;
    while (startLine > 0 && /^\s*@/.test(maskedLines[startLine - 1])) startLine -= 1;
    const entity = createEntity(
      input,
      match[2],
      'CLASS',
      `${moduleEntity.qualifiedName}.${match[2]}`,
      lineOffsets[startLine] ?? 0,
      lineOffsets[endLine] + (lines[endLine]?.length ?? 0),
    );
    entities.push(entity);
    relationships.push(createRelationship(moduleEntity, entity, 'DECLARES'));
    classes.push({ entity, indent: classIndent, lineIndex: index });
  }

  const definitionPattern = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
  for (let index = 0; index < maskedLines.length; index += 1) {
    const match = definitionPattern.exec(maskedLines[index]);
    if (!match) continue;
    const indent = pythonIndent(match[1]);
    let parentFunction: PythonDefinition | undefined;
    for (const candidate of definitions) {
      if (candidate.lineIndex < index && candidate.indent < indent && candidate.bodyEndOffset >= (lineOffsets[index] ?? 0)
        && (!parentFunction || candidate.indent > parentFunction.indent)) {
        parentFunction = candidate;
      }
    }
    const parentClass = [...classes]
      .filter((candidate) => candidate.lineIndex < index && candidate.indent < indent)
      .sort((left, right) => right.indent - left.indent)[0];
    const className = parentFunction ? undefined : parentClass?.entity.name;
    let endLine = index;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() && pythonIndent(lines[next]) <= indent) break;
      if (lines[next].trim()) endLine = next;
    }
    let startLine = index;
    while (startLine > 0 && /^\s*@/.test(maskedLines[startLine - 1])) startLine -= 1;

    const qualifiedPrefix = parentFunction?.entity.qualifiedName
      ?? (className ? `${moduleEntity.qualifiedName}.${className}` : moduleEntity.qualifiedName);
    const kind = className ? 'METHOD' : 'FUNCTION';
    const entity = createEntity(
      input,
      match[2],
      kind,
      `${qualifiedPrefix}.${match[2]}`,
      lineOffsets[startLine] ?? 0,
      lineOffsets[endLine] + (lines[endLine]?.length ?? 0),
    );
    entities.push(entity);
    relationships.push(createRelationship(parentFunction?.entity ?? (className
      ? classes.find((candidate) => candidate.entity.name === className)?.entity ?? moduleEntity
      : moduleEntity), entity, 'DECLARES'));

    const signatureStart = lineOffsets[index] + (match[0].length - 1);
    let cursor = signatureStart;
    let depth = 0;
    let signatureEnd = -1;
    for (; cursor < masked.length; cursor += 1) {
      if (masked[cursor] === '(') depth += 1;
      else if (masked[cursor] === ')' && --depth === 0) {
        signatureEnd = cursor;
        break;
      }
    }
    if (signatureEnd < 0) {
      diagnostics.push(`Unable to parse parameter list for ${entity.qualifiedName}`);
    } else {
      const parameters = splitPythonParameters(source.slice(signatureStart + 1, signatureEnd));
      for (const [parameterIndex, rawParameter] of parameters.entries()) {
        const binding = rawParameter.split('=')[0].split(':')[0].trim();
        const parameterName = binding.replace(/^\*+/, '').trim();
        if (!parameterName) continue;
        const nameMatch = /^[A-Za-z_]\w*$/.exec(parameterName);
        const parameterOffset = nameMatch
          ? source.indexOf(nameMatch[0], signatureStart + 1)
          : signatureStart + 1;
        const parameterEntity = createEntity(
          input,
          parameterName,
          'PARAMETER',
          `${entity.qualifiedName}.parameter:${parameterIndex}:${parameterName}`,
          parameterOffset,
          parameterOffset + parameterName.length,
        );
        entities.push(parameterEntity);
        relationships.push(createRelationship(entity, parameterEntity, 'DECLARES'));
      }
    }

    definitions.push({
      entity,
      indent,
      lineIndex: index,
      bodyEndOffset: (lineOffsets[endLine] ?? 0) + (lines[endLine]?.length ?? 0),
      className,
      parentFunction: parentFunction?.entity,
    });
  }

  const definitionsByName = new Map<string, PythonDefinition[]>();
  for (const definition of definitions) {
    const matches = definitionsByName.get(definition.entity.name) ?? [];
    matches.push(definition);
    definitionsByName.set(definition.entity.name, matches);
  }
  const identifierCallPattern = /\b([A-Za-z_]\w*)\s*\(/g;
  for (const definition of definitions) {
    const body = masked.slice(
      lineOffsets[definition.lineIndex] ?? 0,
      definition.bodyEndOffset,
    );
    identifierCallPattern.lastIndex = 0;
    for (let match = identifierCallPattern.exec(body); match; match = identifierCallPattern.exec(body)) {
      if (match[1] === 'def' || match[1] === 'if' || match[1] === 'for' || match[1] === 'while'
        || match[1] === 'with' || match[1] === 'class' || match[1] === 'return') continue;
      const possible = definitionsByName.get(match[1]) ?? [];
      if (possible.length !== 1 || possible[0].entity.id === definition.entity.id) continue;
      relationships.push(createRelationship(definition.entity, possible[0].entity, 'CALLS'));
    }
  }

  return {
    status: diagnostics.length > 0 ? 'PARTIAL' : 'PARSED',
    language: input.language,
    parserVersion,
    irVersion,
    durationMs: Date.now() - started,
    entityCount: entities.length,
    relationshipCount: relationships.length,
    entities,
    relationships,
    diagnostics,
    cacheKey: buildCacheKey(input),
  };
}

export class PythonLanguageAdapter implements LanguageAdapter {
  language: SupportedLanguage = 'Python';
  canParse(input: ParseInput): boolean { return input.language === this.language; }
  parse(input: ParseInput): ParsedFileResult { return parsePython(input); }
}

export class JavaScriptLanguageAdapter implements LanguageAdapter {
  language: SupportedLanguage = 'JavaScript';
  canParse(input: ParseInput): boolean { return input.language === this.language; }
  parse(input: ParseInput): ParsedFileResult { return parseTypeScript(input); }
}

export class TypeScriptLanguageAdapter implements LanguageAdapter {
  language: SupportedLanguage = 'TypeScript';
  canParse(input: ParseInput): boolean { return input.language === this.language; }
  parse(input: ParseInput): ParsedFileResult { return parseTypeScript(input); }
}

export class UnsupportedLanguageAdapter implements LanguageAdapter {
  language: SupportedLanguage = 'UNKNOWN';
  canParse(input: ParseInput): boolean { return input.language === this.language; }
  parse(input: ParseInput): ParsedFileResult {
    return {
      status: 'UNSUPPORTED',
      language: input.language,
      parserVersion,
      irVersion,
      durationMs: 0,
      entityCount: 0,
      relationshipCount: 0,
      entities: [],
      relationships: [],
      diagnostics: [`Language unsupported for parsing: ${input.language}`],
      cacheKey: buildCacheKey(input),
    };
  }
}

export function getLanguageAdapters(): LanguageAdapter[] {
  return [
    new PythonLanguageAdapter(),
    new JavaScriptLanguageAdapter(),
    new TypeScriptLanguageAdapter(),
    new UnsupportedLanguageAdapter(),
  ];
}

export function parseWithLanguageAdapter(input: ParseInput): ParsedFileResult {
  const adapter = getLanguageAdapters().find((candidate) => candidate.canParse(input));
  return adapter ? adapter.parse(input) : new UnsupportedLanguageAdapter().parse(input);
}

export const parserAdapters = getLanguageAdapters();
