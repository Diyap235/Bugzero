import { createHash } from 'node:crypto';
import path from 'node:path';

import ts from 'typescript';
import type { CodeEntityRecord, CodeRelationshipRecord } from '@bugzero/database';

import { AnalyzerContext } from '../analyzer-context.js';
import type {
  Analyzer,
  AnalyzerResult,
  CandidateEvidenceEdge,
  CandidateEvidenceGraph,
  CandidateEvidenceNode,
  FindingCandidate,
} from '../types.js';
import {
  classifySqlInjectionConfidence,
  sqlInjectionRule,
  sqlInjectionSinkPatterns,
  sqlInjectionSourcePatterns,
} from './rules/sql-injection.js';
import { securityRuleRegistry } from './rule-registry.js';

const SECURITY_LIMITS = {
  maxTaintNodes: 500,
  maxTaintEdges: 1_000,
  maxPaths: 100,
  maxDepth: 16,
} as const;

interface FlowPath {
  nodes: CandidateEvidenceNode[];
  edges: CandidateEvidenceEdge[];
}

interface FlowValue {
  tainted: boolean;
  dynamicSql: boolean;
  sqlLiteral: boolean;
  path: FlowPath | null;
  unknown: boolean;
  requestPath?: string | null;
  literalValue?: string;
}

interface FunctionUnit {
  entity: CodeEntityRecord;
  node: ts.FunctionLikeDeclaration;
  localBindings: Set<string>;
}

interface ResolvedFunctionCall {
  analyzer: SqlInjectionFileAnalyzer;
  unit: FunctionUnit;
  relationshipId: string;
}

interface FileAnalysisState {
  filePath: string;
  source: ts.SourceFile;
  functionEntitiesByName: Map<string, FunctionUnit[]>;
  exactCalls: Map<string, CodeRelationshipRecord>;
  importedFunctions: Map<string, ResolvedFunctionCall>;
  knownExternalCallers: Set<string>
  localBindingsByEntityId: Map<string, Set<string>>;
  diagnostics: string[];
  findings: FindingCandidate[];
  taintNodes: number;
  taintEdges: number;
  paths: number;
  limits: SecurityLimits;
  startedAt: number;
  budgetExhausted: boolean;
  seenSinks: Set<string>;
}

interface TypeScriptModuleAnalysis {
  filePath: string;
  source: ts.SourceFile;
  moduleEntity?: CodeEntityRecord;
  functionsById: Map<string, FunctionUnit>;
  exportedFunctions: Map<string, FunctionUnit[]>;
  importedBindings: Map<string, { importedName: string; moduleSpecifier: string }>;
  state: FileAnalysisState;
  analyzer: SqlInjectionFileAnalyzer;
}

interface SecurityLimits {
  maxTaintNodes: number;
  maxTaintEdges: number;
  maxPaths: number;
  maxDepth: number;
  maxDurationMs: number;
}

const cleanValue: FlowValue = {
  tainted: false,
  dynamicSql: false,
  sqlLiteral: false,
  path: null,
  unknown: false,
  requestPath: null,
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeRepositoryPath(filePath: string): string | null {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/').replace(/^\.\/+/, ''));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    return null;
  }
  return normalized;
}

export function resolveRelativeImportPath(
  importingFile: string,
  moduleSpecifier: string,
  availableFiles: Iterable<string>,
): string | null {
  const normalizedImporter = normalizeRepositoryPath(importingFile);
  const specifier = moduleSpecifier.replace(/\\/g, '/');
  if (!normalizedImporter || (!specifier.startsWith('./') && !specifier.startsWith('../'))) return null;

  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(normalizedImporter), specifier));
  if (basePath === '..' || basePath.startsWith('../') || basePath.startsWith('/')) return null;

  const candidates = path.posix.extname(basePath)
    ? [basePath]
    : [
      basePath,
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
      path.posix.join(basePath, 'index.ts'),
      path.posix.join(basePath, 'index.js'),
    ];
  const repositoryFiles = new Set(Array.from(availableFiles, normalizeRepositoryPath).filter((file): file is string => file !== null));
  return candidates.find((candidate) => repositoryFiles.has(candidate)) ?? null;
}

function lineAt(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function collectLocalBindings(node: ts.FunctionLikeDeclaration): Set<string> {
  const bindings = new Set<string>();
  for (const parameter of node.parameters) {
    if (ts.isIdentifier(parameter.name)) bindings.add(parameter.name.text);
  }
  if (!node.body) return bindings;
  const collect = (child: ts.Node): void => {
    if (child !== node.body && isFunctionLike(child)) return;
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) bindings.add(child.name.text);
    if (ts.isFunctionDeclaration(child) && child.name) bindings.add(child.name.text);
    ts.forEachChild(child, collect);
  };
  collect(node.body);
  return bindings;
}

function functionExportNames(node: ts.Node, name: string): string[] {
  let declaration = node;
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const variable = node.parent;
    const declarationList = ts.isVariableDeclaration(variable) ? variable.parent : undefined;
    const statement = declarationList && ts.isVariableDeclarationList(declarationList)
      ? declarationList.parent
      : undefined;
    declaration = statement ?? node;
  }
  if (!ts.canHaveModifiers(declaration)) return [];
  const modifiers = ts.getModifiers(declaration) ?? [];
  if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? ['default'] : [name];
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function createImportRelationshipId(sourceEntityId: string, targetEntityId: string, importerPath: string, importedName: string): string {
  return stableId(`${sourceEntityId}:IMPORT_CALL:${targetEntityId}:${importerPath}:${importedName}`);
}

function statementLooksSql(value: string): boolean {
  let candidate = value.trimStart();
  while (candidate.startsWith('/*') || candidate.startsWith('--')) {
    if (candidate.startsWith('/*')) {
      const end = candidate.indexOf('*/', 2);
      if (end < 0) return false;
      candidate = candidate.slice(end + 2).trimStart();
    } else {
      const end = candidate.search(/[\r\n]/);
      if (end < 0) return false;
      candidate = candidate.slice(end).trimStart();
    }
  }
  return /^(?:SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE|MERGE|CREATE|ALTER|DROP|TRUNCATE|CALL|EXEC|EXECUTE|COPY|PRAGMA|DO|GRANT|REVOKE|COMMENT|ANALYZE|VACUUM|EXPLAIN|PREPARE|DEALLOCATE|REFRESH|LOCK|BEGIN|COMMIT|ROLLBACK|SET|RESET|SHOW|START|END|DISCARD|LISTEN|NOTIFY|UNLISTEN|CHECKPOINT|REINDEX|DECLARE|FETCH|CLOSE|SAVEPOINT|RELEASE)\b/i.test(candidate);
}

function pythonParenthesisDelta(source: string): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let comment = false;
  for (const character of source) {
    if (comment) {
      if (character === '\n' || character === '\r') comment = false;
      continue;
    }
    if (quote) {
      if (character === quote && !escaped) quote = null;
      escaped = character === '\\' && !escaped;
      if (character !== '\\') escaped = false;
      continue;
    }
    if (character === '#') {
      comment = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
  }
  return depth;
}

function splitPythonCallArguments(source: string): string[] | null {
  const open = source.indexOf('(');
  const close = source.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const argumentsText = source.slice(open + 1, close);
  const arguments_: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let comment = false;
  for (let index = 0; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];
    if (comment) {
      if (character === '\n' || character === '\r') comment = false;
      continue;
    }
    if (quote) {
      if (character === quote && !escaped) quote = null;
      if (character === '\\' && !escaped) escaped = true;
      else escaped = false;
      continue;
    }
    if (character === '#') {
      comment = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      arguments_.push(argumentsText.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) return null;
  }
  if (quote || depth !== 0) return null;
  arguments_.push(argumentsText.slice(start).trim());
  return arguments_;
}

function isPythonTupleBinding(expression: string): boolean {
  const value = expression.trim();
  if (!value.startsWith('(') || !value.endsWith(')')) return false;
  const elements = splitPythonCallArguments(`tuple${value}`);
  return elements !== null && elements.length > 1 && elements.some((element) => element.length > 0);
}

type PythonExpressionPart =
  | { kind: 'literal'; text: string }
  | { kind: 'variable'; name: string };

function pythonVariableExpression(expression: string): string | null {
  const value = expression.trim();
  return /^str\(\s*([A-Za-z_]\w*)\s*\)$/.exec(value)?.[1]
    ?? /^([A-Za-z_]\w*)$/.exec(value)?.[1]
    ?? null;
}

function parsePythonStringLiteral(expression: string): string | null {
  const value = expression.trim();
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) return null;
  let escaped = false;
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character === quote && !escaped) return null;
    if (character === '\\' && !escaped) escaped = true;
    else escaped = false;
  }
  return value.slice(1, -1);
}

function pythonStringExpression(expression: string): PythonExpressionPart[] | null {
  const value = expression.trim();
  const fString = /^[fF](['"])/.exec(value);
  if (fString) {
    const quote = fString[1];
    if (value[value.length - 1] !== quote) return null;
    const content = value.slice(2, -1);
    const parts: PythonExpressionPart[] = [];
    let literal = '';
    for (let index = 0; index < content.length; index += 1) {
      const character = content[index];
      if (character === '{' && content[index + 1] === '{') {
        literal += '{';
        index += 1;
      } else if (character === '}' && content[index + 1] === '}') {
        literal += '}';
        index += 1;
      } else if (character === '{') {
        const end = content.indexOf('}', index + 1);
        if (end < 0) return null;
        const interpolation = content.slice(index + 1, end).trim();
        const variable = pythonVariableExpression(interpolation);
        if (!variable) return null;
        if (literal) parts.push({ kind: 'literal', text: literal });
        parts.push({ kind: 'variable', name: variable });
        literal = '';
        index = end;
      } else if (character === '}') {
        return null;
      } else {
        literal += character;
      }
    }
    if (literal) parts.push({ kind: 'literal', text: literal });
    return parts.length > 0 ? parts : null;
  }

  let valueWithoutOuterParentheses = value;
  while (valueWithoutOuterParentheses.startsWith('(') && valueWithoutOuterParentheses.endsWith(')')) {
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    let wrapsExpression = true;
    for (let index = 0; index < valueWithoutOuterParentheses.length; index += 1) {
      const character = valueWithoutOuterParentheses[index];
      if (quote) {
        if (character === quote && !escaped) quote = null;
        if (character === '\\' && !escaped) escaped = true;
        else escaped = false;
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        continue;
      }
      if (character === '(') depth += 1;
      else if (character === ')') {
        depth -= 1;
        if (depth === 0 && index !== valueWithoutOuterParentheses.length - 1) {
          wrapsExpression = false;
          break;
        }
      }
    }
    if (!wrapsExpression) break;
    valueWithoutOuterParentheses = valueWithoutOuterParentheses.slice(1, -1).trim();
  }

  const terms: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < valueWithoutOuterParentheses.length; index += 1) {
    const character = valueWithoutOuterParentheses[index];
    if (quote) {
      if (character === quote && !escaped) quote = null;
      if (character === '\\' && !escaped) escaped = true;
      else escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === '+' && depth === 0) {
      terms.push(valueWithoutOuterParentheses.slice(start, index).trim());
      start = index + 1;
    }
  }
  terms.push(valueWithoutOuterParentheses.slice(start).trim());
  const parts: PythonExpressionPart[] = [];
  for (const term of terms) {
    const literal = parsePythonStringLiteral(term);
    if (literal !== null) {
      parts.push({ kind: 'literal', text: literal });
      continue;
    }
    const variable = pythonVariableExpression(term);
    if (!variable) return null;
    parts.push({ kind: 'variable', name: variable });
  }
  return parts;
}

function getFunctionName(node: ts.FunctionLikeDeclaration): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.name) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
      return node.name.text;
    }
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) {
    return parent.name.text;
  }
  return null;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node))
    && node.body !== undefined;
}

function getParameterNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionLike(current)) {
      for (const parameter of current.parameters) {
        if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text);
      }
    }
    current = current.parent;
  }
  return names;
}

function sourcePattern(node: ts.Node): string | null {
  const accessNames: string[] = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      accessNames.unshift(current.name.text);
      current = current.expression;
    } else {
      const argument = current.argumentExpression;
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        accessNames.unshift(argument.text);
      } else {
        accessNames.unshift('*');
      }
      current = current.expression;
    }
  }
  if (!ts.isIdentifier(current)) return null;
  const root = current.text;
  const patterns = sqlInjectionSourcePatterns.javascript;
  if (!patterns.requestRoots.includes(root as typeof patterns.requestRoots[number])
    || !getParameterNames(current).has(root)) return null;
  if (accessNames.length < 1 || !patterns.inputProperties.includes(accessNames[0] as typeof patterns.inputProperties[number])) return null;
  if (accessNames[1] === '*') return `${root}.${accessNames[0]}`;
  return `${root}.${accessNames.slice(0, Math.min(2, accessNames.length)).join('.')}`;
}

function requestSourcePattern(node: ts.Node, environment: ReadonlyMap<string, FlowValue>): string | null {
  const accessNames: string[] = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      accessNames.unshift(current.name.text);
      current = current.expression;
    } else {
      const argument = current.argumentExpression;
      accessNames.unshift(argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
        ? argument.text
        : '*');
      current = current.expression;
    }
  }
  if (!ts.isIdentifier(current)) return null;
  const requestPath = environment.get(current.text)?.requestPath;
  if (!requestPath) return null;
  const pathParts = [...requestPath.split('.'), ...accessNames];
  const patterns = sqlInjectionSourcePatterns.javascript;
  if (!patterns.requestRoots.includes(pathParts[0] as typeof patterns.requestRoots[number])
    || !patterns.inputProperties.includes(pathParts[1] as typeof patterns.inputProperties[number])) return null;
  if (pathParts[2] === '*') return pathParts.slice(0, 2).join('.');
  return pathParts.slice(0, Math.min(3, pathParts.length)).join('.');
}

function staticSqlLiteralText(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) return node.head.text;
  return null;
}

function expressionContainsSqlLiteral(node: ts.Node): boolean {
  let containsSql = false;
  const visit = (child: ts.Node): void => {
    if (containsSql) return;
    if ((ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child))
      && statementLooksSql(child.text)) {
      containsSql = true;
      return;
    }
    if (ts.isTemplateExpression(child)
      && (statementLooksSql(child.head.text)
        || child.templateSpans.some((span) => statementLooksSql(span.literal.text)))) {
      containsSql = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return containsSql;
}

function isRecognizedSqlSink(node: ts.CallExpression): { receiver: string; method: string } | null {
  if (!ts.isPropertyAccessExpression(node.expression) || !ts.isIdentifier(node.expression.expression)) return null;
  const receiver = node.expression.expression.text;
  const method = node.expression.name.text;
  const allowed = sqlInjectionSinkPatterns.receiverMethods[receiver as keyof typeof sqlInjectionSinkPatterns.receiverMethods] as readonly string[] | undefined;
  return allowed?.includes(method) ? { receiver, method } : null;
}

function sqlQueryExpression(node: ts.Expression | undefined): ts.Expression | null {
  if (!node) return null;
  if (!ts.isObjectLiteralExpression(node)) return node;
  const textProperty = node.properties.find((property) =>
    (ts.isPropertyAssignment(property) && staticPropertyName(property.name) === 'text')
    || (ts.isShorthandPropertyAssignment(property) && property.name.text === 'text'));
  if (textProperty && ts.isPropertyAssignment(textProperty)) return textProperty.initializer;
  if (textProperty && ts.isShorthandPropertyAssignment(textProperty)) return textProperty.name;
  return null;
}

function isRecognizedParameterizedCall(node: ts.CallExpression): boolean {
  const query = node.arguments[0];
  const bindings = node.arguments[1];
  const queryText = staticSqlLiteralText(query);
  if (!bindings || !queryText) return false;
  return /(?:\?|%\w|\$\d+|:[A-Za-z_]\w*)/.test(queryText) && statementLooksSql(queryText);
}

function expressionContainsRelevantSecuritySyntax(
  node: ts.Node,
  environment?: ReadonlyMap<string, FlowValue>,
): boolean {
  let relevant = false;
  let hasUnknownIdentifier = false;
  let hasSqlLiteral = false;
  const visit = (child: ts.Node): void => {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
      hasSqlLiteral ||= statementLooksSql(child.text);
    } else if (ts.isTemplateExpression(child)) {
      hasSqlLiteral ||= statementLooksSql(child.head.text)
        || child.templateSpans.some((span) => statementLooksSql(span.literal.text));
    }
    if (environment && ts.isIdentifier(child)) {
      const value = environment.get(child.text);
      if (value?.tainted) relevant = true;
      if (value?.unknown) hasUnknownIdentifier = true;
    }
    if ((environment ? requestSourcePattern(child, environment) : sourcePattern(child))
      || (ts.isCallExpression(child) && isRecognizedSqlSink(child))) relevant = true;
    if (!relevant) ts.forEachChild(child, visit);
  };
  visit(node);
  return relevant || (hasUnknownIdentifier && hasSqlLiteral);
}

function emptyFlowValue(unknown = false): FlowValue {
  return { ...cleanValue, unknown };
}

class SqlInjectionFileAnalyzer {
  private readonly callStack: string[] = [];

  constructor(private readonly state: FileAnalysisState) {}

  analyzeModule(moduleEntity: CodeEntityRecord, statements: readonly ts.Statement[]): void {
    this.executeStatements(statements, new Map(), moduleEntity, 0);
  }

  analyzeFunction(unit: FunctionUnit): void {
    this.executeFunction(unit, [], 0);
  }

  private makeNode(
    nodeType: CandidateEvidenceNode['nodeType'],
    label: string,
    node: ts.Node,
    attributes: Record<string, unknown> = {},
  ): CandidateEvidenceNode {
    const start = node.getStart(this.state.source);
    return {
      nodeKey: `${nodeType.toLowerCase()}:${hash(`${this.state.filePath}:${start}:${label}`).slice(0, 20)}`,
      nodeType,
      label,
      filePath: this.state.filePath,
      line: lineAt(this.state.source, node),
      endLine: this.state.source.getLineAndCharacterOfPosition(node.end).line + 1,
      attributes: {
        provenance: 'SECURITY_ANALYZER',
        authority: 'AUTHORITATIVE',
        confidence: 'HIGH',
        sourceStart: start,
        sourceEnd: node.end,
        ...attributes,
      },
    };
  }

  private appendNode(value: FlowValue, evidenceNode: CandidateEvidenceNode, relation: string): FlowValue {
    const path = value.path ?? { nodes: [], edges: [] };
    const previous = path.nodes[path.nodes.length - 1];
    const nodes = [...path.nodes, evidenceNode];
    const edges = previous ? [...path.edges, {
      edgeKey: `flow:${hash(`${previous.nodeKey}:${relation}:${evidenceNode.nodeKey}`).slice(0, 24)}`,
      fromNodeKey: previous.nodeKey,
      toNodeKey: evidenceNode.nodeKey,
      relation,
      resolution: 'EXACT' as const,
      confidence: 'HIGH' as const,
      attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
    }] : path.edges;
    return { ...value, path: { nodes, edges } };
  }

  private combine(left: FlowValue, right: FlowValue): FlowValue {
    const tainted = left.tainted || right.tainted;
    const path = left.tainted ? left.path : right.path;
    return {
      tainted,
      dynamicSql: left.dynamicSql || right.dynamicSql,
      sqlLiteral: left.sqlLiteral || right.sqlLiteral,
      path,
      unknown: left.unknown || right.unknown,
      requestPath: left.requestPath ?? right.requestPath ?? null,
    };
  }

  private evaluateExpression(
    node: ts.Expression,
    environment: Map<string, FlowValue>,
    caller: CodeEntityRecord,
    depth: number,
  ): FlowValue {
    if (this.checkTimeBudget()) return emptyFlowValue(true);
    if (this.state.budgetExhausted) return emptyFlowValue(true);
    if (depth > this.state.limits.maxDepth) {
      this.state.diagnostics.push(`Exceeded maxDepth budget (${this.state.limits.maxDepth}) at ${this.state.filePath}:${lineAt(this.state.source, node)}`);
      this.state.budgetExhausted = true;
      return emptyFlowValue(true);
    }
    const source = requestSourcePattern(node, environment);
    if (source) {
      const evidenceNode = this.makeNode('SOURCE', source, node, {
        sourcePattern: source,
        sourceEntityId: caller.id,
      });
      return {
        tainted: true,
        dynamicSql: false,
        sqlLiteral: false,
        path: { nodes: [evidenceNode], edges: [] },
        unknown: false,
      };
    }
    if (ts.isIdentifier(node)) return environment.get(node.text) ?? emptyFlowValue(true);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { ...cleanValue, sqlLiteral: statementLooksSql(node.text) };
    }
    if (ts.isBinaryExpression(node)
      && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      const left = this.evaluateExpression(node.left, environment, caller, depth + 1);
      const right = this.evaluateExpression(node.right, environment, caller, depth + 1);
      return this.combine(left, right);
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node)) {
      return this.evaluateExpression(node.expression, environment, caller, depth + 1);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.evaluateExpression(node.left, environment, caller, depth + 1);
      const right = this.evaluateExpression(node.right, environment, caller, depth + 1);
      const combined = this.combine(left, right);
      const dynamicSql = combined.tainted && (left.sqlLiteral || right.sqlLiteral || combined.dynamicSql);
      if (!dynamicSql) return { ...combined, dynamicSql: false, requestPath: null };
      const transformation = this.makeNode('TRANSFORMATION', 'Dynamic SQL construction', node, { operation: 'STRING_CONCATENATION' });
      return {
        ...this.appendNode(combined, transformation, 'CONTRIBUTES_TO_SQL'),
        dynamicSql: true,
        sqlLiteral: true,
        requestPath: null,
      };
    }
    if (ts.isBinaryExpression(node)
      && (node.operatorToken.kind === ts.SyntaxKind.EqualsToken || node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
      && ts.isIdentifier(node.left)) {
      const right = this.evaluateExpression(node.right, environment, caller, depth + 1);
      const previous = node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
        ? environment.get(node.left.text) ?? cleanValue
        : cleanValue;
      let value = this.combine(previous, right);
      if (node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
        && value.tainted
        && (previous.sqlLiteral || right.sqlLiteral || previous.dynamicSql || right.dynamicSql)) {
        value = {
          ...this.appendNode(value, this.makeNode('TRANSFORMATION', 'Dynamic SQL construction', node, {
            operation: 'STRING_CONCATENATION',
          }), 'CONTRIBUTES_TO_SQL'),
          dynamicSql: true,
          sqlLiteral: true,
        };
      }
      value = {
        ...value,
        requestPath: node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? right.requestPath ?? null : null,
      };
      if (value.tainted) {
        value = this.appendNode(value, this.makeNode('VARIABLE', node.left.text, node.left, { sourceEntityId: caller.id }), 'ASSIGNED_TO');
      }
      environment.set(node.left.text, value);
      return value;
    }
    if (ts.isTemplateExpression(node)) {
      const expressionValues = node.templateSpans.map((span) =>
        this.evaluateExpression(span.expression, environment, caller, depth + 1));
      const combined = expressionValues.reduce((value, next) => this.combine(value, next), cleanValue);
      const sqlLiteral = statementLooksSql(node.head.text)
        || node.templateSpans.some((span) => statementLooksSql(span.literal.text));
      if (!combined.tainted || !sqlLiteral) return { ...combined, sqlLiteral, requestPath: null };
      const transformation = this.makeNode('TRANSFORMATION', 'Interpolated SQL construction', node, { operation: 'TEMPLATE_INTERPOLATION' });
      return {
        ...this.appendNode(combined, transformation, 'INTERPOLATED_INTO_SQL'),
        dynamicSql: true,
        sqlLiteral: true,
        requestPath: null,
      };
    }
    if (ts.isCallExpression(node)) return this.evaluateCall(node, environment, caller, depth + 1);
    if (ts.isPropertyAccessExpression(node)) {
      const base = this.evaluateExpression(node.expression, environment, caller, depth + 1);
      if (!base.tainted) return { ...base, requestPath: null };
      return this.appendNode(base, this.makeNode('VARIABLE', node.getText(this.state.source), node, {
        sourceEntityId: caller.id,
        operation: 'PROPERTY_READ',
      }), 'READS_PROPERTY');
    }
    if (ts.isElementAccessExpression(node)) {
      const base = this.evaluateExpression(node.expression, environment, caller, depth + 1);
      if (!base.tainted) return { ...base, requestPath: null };
      return this.appendNode(base, this.makeNode('VARIABLE', node.getText(this.state.source), node, {
        sourceEntityId: caller.id,
        operation: 'ELEMENT_READ',
      }), 'READS_PROPERTY');
    }
    if (ts.isConditionalExpression(node)) {
      this.evaluateExpression(node.condition, environment, caller, depth + 1);
      const whenTrue = this.evaluateExpression(node.whenTrue, environment, caller, depth + 1);
      const whenFalse = this.evaluateExpression(node.whenFalse, environment, caller, depth + 1);
      return this.combine(whenTrue, whenFalse);
    }
    if (ts.isAwaitExpression(node)) {
      const value = this.evaluateExpression(node.expression, environment, caller, depth + 1);
      if (value.tainted) {
        this.state.diagnostics.push(`Unsupported control/data-flow expression at ${this.state.filePath}:${lineAt(this.state.source, node)}`);
        return { ...value, unknown: true };
      }
      return value;
    }
    return expressionContainsRelevantSecuritySyntax(node, environment) ? emptyFlowValue(true) : emptyFlowValue();
  }

  private evaluateCall(
    call: ts.CallExpression,
    environment: Map<string, FlowValue>,
    caller: CodeEntityRecord,
    depth: number,
  ): FlowValue {
    const sink = isRecognizedSqlSink(call);
    const args = call.arguments.map((argument) => this.evaluateExpression(argument, environment, caller, depth + 1));
    if (sink) {
      if (isRecognizedParameterizedCall(call)) return cleanValue;
      const queryExpression = sqlQueryExpression(call.arguments[0]);
      const query = queryExpression
        ? queryExpression === call.arguments[0]
          ? args[0] ?? cleanValue
          : this.evaluateExpression(queryExpression, environment, caller, depth + 1)
        : emptyFlowValue(true);
      if (query.tainted && query.dynamicSql && !query.unknown && query.path) {
        this.addFinding(sink, query, call, caller);
      } else if (query.tainted && (query.unknown || !query.dynamicSql)) {
        this.state.diagnostics.push(query.unknown
          ? `UNRESOLVED_REFERENCE: tainted SQL input reaches a sink through an unresolved call at ${this.state.filePath}:${lineAt(this.state.source, call)}`
          : `SQL sink has tainted or unresolved input without a fully proven dynamic SQL path at ${this.state.filePath}:${lineAt(this.state.source, call)}`);
      } else if (query.unknown) {
        this.state.diagnostics.push(
          `UNRESOLVED_SOURCE: SQL input could not be resolved to a proven-safe value at ${this.state.filePath}:${lineAt(this.state.source, call)}`,
        );
      }
      return cleanValue;
    }

    const target = this.resolveExactCall(call, caller);
    if (!target) {
      const unresolved = args.reduce((value, argument) => this.combine(value, argument), cleanValue);
      if (ts.isIdentifier(call.expression)
        && call.expression.text === 'String'
        && args.length === 1
        && !this.state.localBindingsByEntityId.get(caller.id)?.has('String')) {
        const value = args[0] ?? cleanValue;
        return value.tainted
          ? this.appendNode(value, this.makeNode('TRANSFORMATION', 'String conversion', call, {
            sourceEntityId: caller.id,
            operation: 'STRING_CONVERSION',
          }), 'TRANSFORMS')
          : value;
      }
      if (unresolved.tainted && unresolved.dynamicSql && unresolved.sqlLiteral) {
        this.state.diagnostics.push(`UNRESOLVED_REFERENCE: tainted argument reaches an unresolved call at ${this.state.filePath}:${lineAt(this.state.source, call)}`);
      }
      if (unresolved.tainted || unresolved.unknown) return { ...unresolved, unknown: true };
      return emptyFlowValue(true);
    }
    if (target.analyzer.callStack.includes(target.unit.entity.id)) {
      if (args.some((argument) => argument.tainted)) {
        this.state.diagnostics.push(`Taint call cycle could not be resolved at ${this.state.filePath}:${lineAt(this.state.source, call)}`);
        return emptyFlowValue(true);
      }
      return cleanValue;
    }
    const calledArgs = args.map((argument) => argument.tainted
      ? this.appendNode(argument, this.makeNode('CALL', target.unit.entity.qualified_name ?? target.unit.entity.name, call, {
        sourceEntityId: caller.id,
        targetEntityId: target.unit.entity.id,
        sourceRelationshipId: target.relationshipId,
      }), 'CALLS')
      : argument);
    const returned = target.analyzer.executeFunction(target.unit, calledArgs, depth + 1, call);
    if (!returned.tainted) return returned;
    return this.appendNode(returned, this.makeNode('CALL', `${target.unit.entity.name} return`, call, {
      sourceEntityId: caller.id,
      targetEntityId: target.unit.entity.id,
      sourceRelationshipId: target.relationshipId,
    }), 'RETURNED_FROM_CALL');
  }

  private resolveExactCall(call: ts.CallExpression, caller: CodeEntityRecord): ResolvedFunctionCall | null {
    let targetName: string | null = null;
    let importedOnly = false;
    if (ts.isIdentifier(call.expression)) targetName = call.expression.text;
    else if (ts.isPropertyAccessExpression(call.expression)) {
      if (call.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        targetName = call.expression.name.text;
      } else if (ts.isIdentifier(call.expression.expression)) {
        targetName = `${call.expression.expression.text}.${call.expression.name.text}`;
        importedOnly = true;
      }
    }
    if (!targetName) return null;
    if (importedOnly) return this.state.importedFunctions.get(targetName) ?? null;
    const candidates = this.state.functionEntitiesByName.get(targetName) ?? [];
    if (candidates.length > 0) {
      if (candidates.length !== 1) return null;
      const target = candidates[0];
      const relationship = target && this.state.exactCalls.get(`${caller.id}:${target.entity.id}`);
      return target && relationship
        ? { analyzer: this, unit: target, relationshipId: relationship.id }
        : null;
    }
    if (!ts.isIdentifier(call.expression)) return null;
    if (this.state.localBindingsByEntityId.get(caller.id)?.has(targetName)) return null;
    return this.state.importedFunctions.get(targetName) ?? null;
  }

  private hasDirectCallSite(unit: FunctionUnit): boolean {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (node !== unit.node && ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === unit.entity.name) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(this.state.source);
    return found;
  }

  private executeFunction(
    unit: FunctionUnit,
    arguments_: FlowValue[],
    depth: number,
    callNode?: ts.CallExpression,
  ): FlowValue {
    if (depth > this.state.limits.maxDepth || this.callStack.includes(unit.entity.id)) {
      this.state.diagnostics.push(`Exceeded maxDepth or detected a call cycle at ${unit.entity.qualified_name ?? unit.entity.name}`);
      return emptyFlowValue(true);
    }
    this.callStack.push(unit.entity.id);
    try {
      const environment = new Map<string, FlowValue>();
      const parameterNames = unit.node.parameters;
      const hasKnownCallers = [...this.state.exactCalls.keys()]
        .some((key) => key.endsWith(`:${unit.entity.id}`))
        || this.state.knownExternalCallers.has(unit.entity.id)
        || [...this.state.importedFunctions.values()]
          .some((call) => call.unit.entity.id === unit.entity.id)
        || this.hasDirectCallSite(unit);
      for (let index = 0; index < parameterNames.length; index += 1) {
        const parameter = parameterNames[index];
        if (!parameter || !ts.isIdentifier(parameter.name)) {
          this.state.diagnostics.push(`Unsupported parameter binding in ${unit.entity.qualified_name ?? unit.entity.name}`);
          continue;
        }
        let value = arguments_[index]
          ?? (callNode || hasKnownCallers ? cleanValue : emptyFlowValue(true));
        if (sqlInjectionSourcePatterns.javascript.requestRoots.includes(
          parameter.name.text as typeof sqlInjectionSourcePatterns.javascript.requestRoots[number],
        )) {
          value = { ...value, requestPath: value.requestPath ?? parameter.name.text };
        }
        if (callNode && value.tainted) {
          value = this.appendNode(value, this.makeNode('PARAMETER', `${unit.entity.name}.${parameter.name.text}`, parameter, {
            sourceEntityId: unit.entity.id,
          }), 'PASSES_ARGUMENT');
        }
        environment.set(parameter.name.text, value);
      }
      const body = unit.node.body;
      if (!body) return cleanValue;
      if (ts.isBlock(body)) {
        return this.executeStatements(body.statements, environment, unit.entity, depth + 1);
      }
      return this.evaluateExpression(body, environment, unit.entity, depth + 1);
    } finally {
      this.callStack.pop();
    }
  }

  private executeStatements(
    statements: readonly ts.Statement[],
    environment: Map<string, FlowValue>,
    caller: CodeEntityRecord,
    depth: number,
  ): FlowValue {
    for (const statement of statements) {
      if (this.checkTimeBudget() || this.state.budgetExhausted) return emptyFlowValue(true);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!declaration.initializer) continue;
          if (ts.isObjectBindingPattern(declaration.name)) {
            const base = this.evaluateExpression(declaration.initializer, environment, caller, depth + 1);
            for (const element of declaration.name.elements) {
              const property = element.propertyName
                ? staticPropertyName(element.propertyName)
                : ts.isIdentifier(element.name) ? element.name.text : null;
              if (!property || element.dotDotDotToken || !ts.isIdentifier(element.name)) {
                if (base.tainted || base.requestPath
                  || expressionContainsRelevantSecuritySyntax(declaration.initializer, environment)) {
                  this.state.diagnostics.push(`Unsupported variable binding may affect security data flow at ${this.state.filePath}:${lineAt(this.state.source, declaration)}`);
                }
                continue;
              }
              if (base.tainted) {
                const variable = this.makeNode('VARIABLE', element.name.text, element.name, {
                  sourceEntityId: caller.id,
                  operation: 'DESTRUCTURING',
                });
                environment.set(element.name.text, this.appendNode(base, variable, 'READS_PROPERTY'));
                continue;
              }
              const requestParts = base.requestPath?.split('.') ?? [];
              if (requestParts.length === 1
                && sqlInjectionSourcePatterns.javascript.requestRoots.includes(
                  requestParts[0] as typeof sqlInjectionSourcePatterns.javascript.requestRoots[number],
                )
                && sqlInjectionSourcePatterns.javascript.inputProperties.includes(
                  property as typeof sqlInjectionSourcePatterns.javascript.inputProperties[number],
                )) {
                environment.set(element.name.text, { ...cleanValue, requestPath: `${base.requestPath}.${property}` });
                continue;
              }
              if (requestParts.length >= 2
                && sqlInjectionSourcePatterns.javascript.requestRoots.includes(
                  requestParts[0] as typeof sqlInjectionSourcePatterns.javascript.requestRoots[number],
                )
                && sqlInjectionSourcePatterns.javascript.inputProperties.includes(
                  requestParts[1] as typeof sqlInjectionSourcePatterns.javascript.inputProperties[number],
                )) {
                const sourceLabel = `${base.requestPath}.${property}`;
                const source = this.makeNode('SOURCE', sourceLabel, declaration.initializer, {
                  sourcePattern: sourceLabel,
                  sourceEntityId: caller.id,
                });
                const variable = this.makeNode('VARIABLE', element.name.text, element.name, {
                  sourceEntityId: caller.id,
                  operation: 'DESTRUCTURING',
                });
                const sourceValue: FlowValue = {
                  ...cleanValue,
                  tainted: true,
                  path: { nodes: [source], edges: [] },
                };
                environment.set(element.name.text, this.appendNode(sourceValue, variable, 'READS_PROPERTY'));
                continue;
              }
              environment.set(element.name.text, cleanValue);
            }
            continue;
          }
          if (!ts.isIdentifier(declaration.name)) {
            if (expressionContainsRelevantSecuritySyntax(declaration.initializer, environment)) {
              this.state.diagnostics.push(`Unsupported variable binding may affect security data flow at ${this.state.filePath}:${lineAt(this.state.source, declaration)}`);
            }
            continue;
          }
          let value = this.evaluateExpression(declaration.initializer, environment, caller, depth + 1);
          if (value.tainted) {
            const variable = this.makeNode('VARIABLE', declaration.name.text, declaration, { sourceEntityId: caller.id });
            value = this.appendNode(value, variable, 'ASSIGNED_TO');
          }
          environment.set(declaration.name.text, value);
        }
        continue;
      }
      if (ts.isExpressionStatement(statement)) {
        const value = this.evaluateExpression(statement.expression, environment, caller, depth + 1);
        if (value.unknown && expressionContainsSqlLiteral(statement.expression)) {
          this.state.diagnostics.push(`Unsupported expression may affect SQL security flow at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
        }
        continue;
      }
      if (ts.isReturnStatement(statement)) {
        if (!statement.expression) return cleanValue;
        const value = this.evaluateExpression(statement.expression, environment, caller, depth + 1);
        return value.tainted
          ? this.appendNode(value, this.makeNode('TRANSFORMATION', 'Function return', statement, { sourceEntityId: caller.id }), 'RETURNS')
          : value;
      }
      if (ts.isIfStatement(statement)) {
        const relevant = expressionContainsRelevantSecuritySyntax(statement, environment);
        const thenEnvironment = new Map(environment);
        const thenStatements = ts.isBlock(statement.thenStatement)
          ? statement.thenStatement.statements
          : [statement.thenStatement];
        const thenResult = this.executeStatements(thenStatements, thenEnvironment, caller, depth + 1);
        const elseEnvironment = new Map(environment);
        let elseResult = cleanValue;
        if (statement.elseStatement) {
          const elseStatements = ts.isBlock(statement.elseStatement)
            ? statement.elseStatement.statements
            : [statement.elseStatement];
          elseResult = this.executeStatements(elseStatements, elseEnvironment, caller, depth + 1);
        }
        this.mergeEnvironments(environment, [thenEnvironment, elseEnvironment]);
        if (relevant) {
          this.state.diagnostics.push(`Conditional control flow may affect SQL taint at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
        }
        if (thenResult.tainted || thenResult.unknown || elseResult.tainted || elseResult.unknown) {
          return this.combine(thenResult, elseResult);
        }
        continue;
      }
      if (ts.isIterationStatement(statement, false)) {
        const relevant = expressionContainsRelevantSecuritySyntax(statement, environment);
        const bodyEnvironment = new Map(environment);
        const bodyStatements = ts.isBlock(statement.statement)
          ? statement.statement.statements
          : [statement.statement];
        const bodyResult = this.executeStatements(bodyStatements, bodyEnvironment, caller, depth + 1);
        this.mergeEnvironments(environment, [environment, bodyEnvironment]);
        if (relevant) {
          this.state.diagnostics.push(`Loop control flow may affect SQL taint at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
        }
        if (bodyResult.tainted || bodyResult.unknown) return bodyResult;
        continue;
      }
      if (ts.isSwitchStatement(statement)) {
        const relevant = expressionContainsRelevantSecuritySyntax(statement, environment);
        const clauses = statement.caseBlock.clauses;
        const branchEnvironments: Map<string, FlowValue>[] = [];
        const branchResults: FlowValue[] = [];
        for (let start = 0; start < clauses.length; start += 1) {
          const branchStatements: ts.Statement[] = [];
          for (let index = start; index < clauses.length; index += 1) {
            const clause = clauses[index];
            if (!clause) continue;
            const breakIndex = clause.statements.findIndex(ts.isBreakStatement);
            branchStatements.push(...clause.statements.slice(0, breakIndex < 0 ? undefined : breakIndex + 1));
            if (breakIndex >= 0) break;
          }
          const branchEnvironment = new Map(environment);
          branchResults.push(this.executeStatements(branchStatements, branchEnvironment, caller, depth + 1));
          branchEnvironments.push(branchEnvironment);
        }
        if (!clauses.some(ts.isDefaultClause)) branchEnvironments.push(new Map(environment));
        if (branchEnvironments.length > 0) this.mergeEnvironments(environment, branchEnvironments);
        if (relevant) {
          this.state.diagnostics.push(`Switch control flow may affect SQL taint at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
        }
        const branchResult = branchResults.reduce((value, next) => this.combine(value, next), cleanValue);
        if (branchResult.tainted || branchResult.unknown) return branchResult;
        continue;
      }
      if (ts.isTryStatement(statement)) {
        const relevant = expressionContainsRelevantSecuritySyntax(statement, environment);
        const branchEnvironments: Map<string, FlowValue>[] = [];
        const branchResults: FlowValue[] = [];
        for (const body of [statement.tryBlock, ...(statement.catchClause ? [statement.catchClause.block] : [])]) {
          const branchEnvironment = new Map(environment);
          branchResults.push(this.executeStatements(body.statements, branchEnvironment, caller, depth + 1));
          branchEnvironments.push(branchEnvironment);
        }
        this.mergeEnvironments(environment, branchEnvironments);
        if (statement.finallyBlock) {
          const finallyResult = this.executeStatements(statement.finallyBlock.statements, environment, caller, depth + 1);
          branchResults.push(finallyResult);
        }
        if (relevant) {
          this.state.diagnostics.push(`Exception control flow may affect SQL taint at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
        }
        const branchResult = branchResults.reduce((value, next) => this.combine(value, next), cleanValue);
        if (branchResult.tainted || branchResult.unknown) return branchResult;
        continue;
      }
      if (ts.isLabeledStatement(statement)) {
        const relevant = expressionContainsRelevantSecuritySyntax(statement, environment);
        const bodyEnvironment = new Map(environment);
        const bodyResult = this.executeStatements([statement.statement], bodyEnvironment, caller, depth + 1);
        this.mergeEnvironments(environment, [environment, bodyEnvironment]);
        if (relevant) {
          this.state.diagnostics.push(`Labeled control flow may affect SQL taint at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
        }
        if (bodyResult.tainted || bodyResult.unknown) return bodyResult;
        continue;
      }
      if (ts.isBlock(statement)) {
        const returned = this.executeStatements(statement.statements, environment, caller, depth + 1);
        if (returned.tainted || returned.unknown) return returned;
        continue;
      }
      if (ts.isFunctionDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
      if (expressionContainsRelevantSecuritySyntax(statement, environment)) {
        this.state.diagnostics.push(`Unsupported statement may affect security data flow at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
      }
    }
    return cleanValue;
  }

  private mergeEnvironments(
    target: Map<string, FlowValue>,
    branches: readonly Map<string, FlowValue>[],
  ): void {
    const names = new Set(branches.flatMap((branch) => [...branch.keys()]));
    for (const name of names) {
      const values = branches.map((branch) => branch.get(name) ?? cleanValue);
      const merged = values.reduce((value, next) => this.combine(value, next), cleanValue);
      const requestPaths = new Set(values.map((value) => value.requestPath ?? null));
      target.set(name, {
        ...merged,
        requestPath: requestPaths.size === 1 ? values[0]?.requestPath ?? null : null,
      });
    }
  }

  private addFinding(
    sink: { receiver: string; method: string },
    value: FlowValue,
    call: ts.CallExpression,
    caller: CodeEntityRecord,
  ): void {
    const sinkIdentity = `${this.state.filePath}:${call.getStart(this.state.source)}`;
    if (this.state.seenSinks.has(sinkIdentity)) return;
    const path = value.path;
    if (!path || path.nodes.length === 0) return;
    const sinkNode = this.makeNode('SINK', `${sink.receiver}.${sink.method}`, call, {
      sinkPattern: `${sink.receiver}.${sink.method}`,
      sourceEntityId: caller.id,
    });
    const completed = this.appendNode(value, sinkNode, 'REACHES_SQL_SINK');
    if (!completed.path || completed.path.nodes.length < 2) return;
    if (this.state.taintNodes + completed.path.nodes.length > this.state.limits.maxTaintNodes
      || this.state.taintEdges + completed.path.edges.length > this.state.limits.maxTaintEdges
      || this.state.paths + 1 > this.state.limits.maxPaths) {
      this.state.diagnostics.push('Exceeded SQL taint graph budget; further candidate paths were not emitted');
      this.state.budgetExhausted = true;
      return;
    }
    const line = lineAt(this.state.source, call);
    const qualifiedName = caller.qualified_name ?? caller.name;
    const sinkSignature = hash(call.arguments[0]?.getText(this.state.source).replace(/\s+/g, ' ').trim() ?? 'query').slice(0, 12);
    const semanticTarget = `${qualifiedName}::${sink.method}::${line}:${sinkSignature}`;
    this.state.seenSinks.add(sinkIdentity);
    this.state.taintNodes += completed.path.nodes.length;
    this.state.taintEdges += completed.path.edges.length;
    this.state.paths += 1;
    const evidenceGraph: CandidateEvidenceGraph = {
      nodes: completed.path.nodes,
      edges: completed.path.edges,
      paths: [{
        id: `taint-path:${hash(completed.path.nodes.map((node) => node.nodeKey).join('>')).slice(0, 20)}`,
        nodeIds: completed.path.nodes.map((node) => node.nodeKey),
        edgeIds: completed.path.edges.map((edge) => edge.edgeKey),
        completeness: 'COMPLETE',
        diagnostics: [],
      }],
      completeness: 'COMPLETE',
      sufficiency: 'SUFFICIENT',
      diagnostics: [],
    };
    this.state.findings.push({
      ruleId: sqlInjectionRule.id,
      ruleVersion: sqlInjectionRule.version,
      title: 'Untrusted input reaches a dynamic SQL sink',
      description: sqlInjectionRule.description,
      category: 'SECURITY',
      severity: sqlInjectionRule.severity,
      confidence: classifySqlInjectionConfidence(true, true, completed.path !== null),
      repositoryId: caller.repository_id,
      commitId: caller.commit_id,
      file: this.state.filePath,
      startLine: line,
      endLine: lineAt(this.state.source, call),
      semanticTarget,
      evidenceInputs: {
        source: path.nodes.find((node) => node.nodeType === 'SOURCE')?.label ?? 'unknown',
        sink: `${sink.receiver}.${sink.method}`,
        evidenceSufficiency: 'SUFFICIENT',
        evidenceCompleteness: 'COMPLETE',
      },
      fingerprintInputs: {
        sourcePattern: path.nodes.find((node) => node.nodeType === 'SOURCE')?.attributes.sourcePattern,
        sink: `${sink.receiver}.${sink.method}`,
        flowRelations: completed.path.edges.map((edge) => edge.relation),
      },
      evidenceGraph,
    });
  }

  private checkTimeBudget(): boolean {
    if (Date.now() - this.state.startedAt < this.state.limits.maxDurationMs) return false;
    if (!this.state.diagnostics.some((diagnostic) => diagnostic.includes('Exceeded maxDurationMs budget'))) {
      this.state.diagnostics.push(`Exceeded maxDurationMs budget (${this.state.limits.maxDurationMs})`);
    }
    this.state.budgetExhausted = true;
    return true;
  }
}

export class SqlInjectionAnalyzer implements Analyzer {
  readonly metadata: Analyzer['metadata'] = {
    name: 'security',
    version: '1.0.0',
    type: 'SECURITY',
    supportedLanguages: ['Python', 'JavaScript', 'TypeScript'],
    requiredIR: ['semantic-code-ir'],
    supportedScopes: ['FULL', 'FILE', 'ENTITY', 'IMPACTED'],
    resourceCost: 'HIGH',
    supportsIncremental: true,
  };

  async analyze(unknownContext: unknown): Promise<AnalyzerResult> {
    const started = Date.now();
    if (!(unknownContext instanceof AnalyzerContext)) {
      throw new Error('Security analyzer requires an AnalyzerContext');
    }
    const context = unknownContext;
    if (!securityRuleRegistry.get(sqlInjectionRule.id)) {
      throw new Error(`Security rule ${sqlInjectionRule.id} is not registered`);
    }
    const scopedEntities = context.getEntitiesForScope();
    const entities = context.repositoryIntelligence?.entities ?? context.codeIR?.entities ?? [];
    const relationships = context.repositoryIntelligence?.relationships ?? context.codeIR?.relationships ?? [];
    const findings: FindingCandidate[] = [];
    const diagnostics: string[] = [];
    let filesAnalyzed = 0;
    let entitiesAnalyzed = 0;
    let rulesExecuted = 0;
    let partial = false;
    const scopedFiles = context.getFilesForScope();
    if (context.analysisScope.complete === false) {
      diagnostics.push('Analysis scope is incomplete; SQL security results may omit affected code');
      partial = true;
    }
    if (context.repositoryIntelligence?.status === 'PARTIAL') {
      diagnostics.push('Repository Intelligence is partial; unresolved relationships are not treated as exact');
      partial = true;
    }
    const emptySelection = (context.analysisScope.mode === 'FILE' && (context.analysisScope.fileIds?.length ?? 0) === 0)
      || (context.analysisScope.mode === 'ENTITY' && (context.analysisScope.entityIds?.length ?? 0) === 0)
      || (context.analysisScope.mode === 'IMPACTED'
        && (context.analysisScope.fileIds?.length ?? 0) === 0
        && (context.analysisScope.entityIds?.length ?? 0) === 0);
    if (emptySelection || (context.analysisScope.mode !== 'FULL' && scopedFiles.length === 0)) {
      return this.result('PARTIAL', [], [`${context.analysisScope.mode} scope has no selected targets; no repository-wide fallback was applied`], started, 0, 0, 0, 0, 0, 0);
    }

    const maxFiles = Math.min(scopedFiles.length, context.resourceBudget.maxFiles);
    if (scopedFiles.length > maxFiles) {
      diagnostics.push(`Exceeded maxFiles budget (${context.resourceBudget.maxFiles})`);
      partial = true;
    }
    const selectedFiles = scopedFiles.slice(0, maxFiles);
    const eligibleEntities = scopedEntities.slice(0, context.resourceBudget.maxEntities);
    if (scopedEntities.length > eligibleEntities.length) {
      diagnostics.push(`Exceeded maxEntities budget (${context.resourceBudget.maxEntities})`);
      partial = true;
    }
    entitiesAnalyzed = eligibleEntities.length;
    const entitiesByFile = new Map<string, CodeEntityRecord[]>();
    for (const entity of eligibleEntities) {
      if (!entity.file_path) continue;
      entitiesByFile.set(entity.file_path, [...(entitiesByFile.get(entity.file_path) ?? []), entity]);
    }
    const seenFindings = new Set<string>();
    let totalTaintNodes = 0;
    let totalTaintEdges = 0;
    let totalPaths = 0;
    const maxDurationMs = context.resourceBudget.maxDurationMs;
    const typeScriptModules = new Map<string, TypeScriptModuleAnalysis>();

    for (const filePath of selectedFiles) {
      if (Date.now() - started >= maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${maxDurationMs})`);
        partial = true;
        break;
      }
      const metadata = await context.sourceAccess.getSourceMetadata(filePath);
      if (!metadata.language || !['Python', 'JavaScript', 'TypeScript'].includes(metadata.language)) continue;
      if (!metadata.exists) {
        diagnostics.push(`${filePath}: source is unavailable; security analysis was not performed`);
        partial = true;
        continue;
      }
      const content = await context.sourceAccess.getFileContent(filePath);
      filesAnalyzed += 1;
      rulesExecuted += 1;
      if (metadata.language === 'Python') {
        const remainingLimits = {
          maxTaintNodes: Math.max(0, SECURITY_LIMITS.maxTaintNodes - totalTaintNodes),
          maxTaintEdges: Math.max(0, SECURITY_LIMITS.maxTaintEdges - totalTaintEdges),
          maxPaths: Math.max(0, SECURITY_LIMITS.maxPaths - totalPaths),
          maxDepth: SECURITY_LIMITS.maxDepth,
          maxDurationMs: Math.max(0, maxDurationMs - (Date.now() - started)),
        };
        const python = this.analyzePython(content, filePath, entitiesByFile.get(filePath) ?? [], relationships, remainingLimits);
        findings.push(...python.findings.filter((finding) => !seenFindings.has(finding.semanticTarget ?? '')));
        for (const finding of python.findings) seenFindings.add(finding.semanticTarget ?? '');
        diagnostics.push(...python.diagnostics);
        partial ||= python.partial;
        totalTaintNodes += python.nodes;
        totalTaintEdges += python.edges;
        totalPaths += python.paths;
        if (totalTaintNodes >= SECURITY_LIMITS.maxTaintNodes
          || totalTaintEdges >= SECURITY_LIMITS.maxTaintEdges
          || totalPaths >= SECURITY_LIMITS.maxPaths) {
          diagnostics.push('Exceeded SQL taint graph budget; remaining files were not analyzed');
          partial = true;
          break;
        }
        continue;
      }
      const source = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        metadata.language === 'TypeScript'
          ? (filePath.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
          : (filePath.toLowerCase().endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS),
      );
      const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
      if (parseDiagnostics.length > 0) {
        diagnostics.push(`${filePath}: TypeScript parser reported syntax errors; security analysis was skipped for this file`);
        partial = true;
        continue;
      }
      const fileEntities = entitiesByFile.get(filePath) ?? [];
      const functionsById = new Map<string, FunctionUnit>();
      const functionEntitiesByName = new Map<string, FunctionUnit[]>();
      const exportedFunctions = new Map<string, FunctionUnit[]>();
      const astFunctions: Array<{ node: ts.FunctionLikeDeclaration; name: string }> = [];
      const collect = (node: ts.Node): void => {
        if (isFunctionLike(node)) {
          const name = getFunctionName(node);
          if (name) astFunctions.push({ node, name });
        }
        ts.forEachChild(node, collect);
      };
      collect(source);
      for (const item of astFunctions) {
        const startLine = lineAt(source, item.node);
        const entity = fileEntities.find((candidate) =>
          (candidate.entity_type === 'FUNCTION' || candidate.entity_type === 'METHOD')
          && candidate.name === item.name
          && candidate.start_line === startLine,
        );
        if (!entity) {
          diagnostics.push(`${filePath}:${startLine}: security function could not be mapped to Code IR`);
          partial = true;
          continue;
        }
        const unit = { entity, node: item.node, localBindings: collectLocalBindings(item.node) };
        functionsById.set(entity.id, unit);
        functionEntitiesByName.set(item.name, [...(functionEntitiesByName.get(item.name) ?? []), unit]);
        for (const exportName of functionExportNames(item.node, item.name)) {
          exportedFunctions.set(exportName, [...(exportedFunctions.get(exportName) ?? []), unit]);
        }
      }
      const moduleEntity = fileEntities.find((entity) => entity.entity_type === 'MODULE');
      const exactCalls = new Map(relationships
        .filter((relationship) => relationship.relation === 'CALLS' && relationship.resolution === 'EXACT')
        .map((relationship) => [`${relationship.source_entity_id}:${relationship.target_entity_id}`, relationship]));
      const importedBindings = new Map<string, { importedName: string; moduleSpecifier: string }>();
      const addCommonJsExport = (exportName: string, value: ts.Node): void => {
        const unit = isFunctionLike(value)
          ? [...functionsById.values()].find((candidate) => candidate.node === value)
          : ts.isIdentifier(value)
            ? (functionEntitiesByName.get(value.text) ?? []).length === 1
              ? functionEntitiesByName.get(value.text)?.[0]
              : undefined
            : undefined;
        if (unit) {
          exportedFunctions.set(exportName, [
            ...(exportedFunctions.get(exportName) ?? []),
            unit,
          ]);
        }
      };
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement)
          && ts.isStringLiteral(statement.moduleSpecifier)
          && statement.importClause
          && !statement.importClause.isTypeOnly) {
          const moduleSpecifier = statement.moduleSpecifier.text;
          const clause = statement.importClause;
          if (clause.name) importedBindings.set(clause.name.text, { importedName: 'default', moduleSpecifier });
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const specifier of clause.namedBindings.elements) {
              if (specifier.isTypeOnly) continue;
              importedBindings.set(specifier.name.text, {
                importedName: specifier.propertyName?.text ?? specifier.name.text,
                moduleSpecifier,
              });
            }
          } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
            importedBindings.set(clause.namedBindings.name.text, { importedName: '*', moduleSpecifier });
          }
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            const initializer = declaration.initializer;
            if (!initializer || !ts.isCallExpression(initializer)
              || !ts.isIdentifier(initializer.expression)
              || initializer.expression.text !== 'require'
              || initializer.arguments.length !== 1
              || !ts.isStringLiteral(initializer.arguments[0])) continue;
            const moduleSpecifier = initializer.arguments[0].text;
            if (ts.isIdentifier(declaration.name)) {
              importedBindings.set(declaration.name.text, { importedName: '*', moduleSpecifier });
            } else if (ts.isObjectBindingPattern(declaration.name)) {
              for (const element of declaration.name.elements) {
                if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
                const importedName = element.propertyName
                  ? ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
                    ? element.propertyName.text
                    : null
                  : element.name.text;
                if (importedName) {
                  importedBindings.set(element.name.text, { importedName, moduleSpecifier });
                }
              }
            }
          }
        }
        if (ts.isExportDeclaration(statement)
          && !statement.moduleSpecifier
          && statement.exportClause
          && ts.isNamedExports(statement.exportClause)) {
          for (const specifier of statement.exportClause.elements) {
            const localName = specifier.propertyName?.text ?? specifier.name.text;
            const candidates = functionEntitiesByName.get(localName) ?? [];
            if (candidates.length === 1) {
              const exportName = specifier.name.text;
              exportedFunctions.set(exportName, [
                ...(exportedFunctions.get(exportName) ?? []),
                candidates[0],
              ]);
            }
          }
        }
        if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
          && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const { left, right } = statement.expression;
          if (ts.isPropertyAccessExpression(left)
            && ts.isIdentifier(left.expression)
            && left.expression.text === 'exports') {
            addCommonJsExport(left.name.text, right);
          } else if (ts.isPropertyAccessExpression(left)
            && ts.isPropertyAccessExpression(left.expression)
            && ts.isIdentifier(left.expression.expression)
            && left.expression.expression.text === 'module'
            && left.expression.name.text === 'exports') {
            addCommonJsExport(left.name.text, right);
          } else if (ts.isPropertyAccessExpression(left)
            && ts.isIdentifier(left.expression)
            && left.expression.text === 'module'
            && left.name.text === 'exports'
            && ts.isObjectLiteralExpression(right)) {
            for (const property of right.properties) {
              if (ts.isPropertyAssignment(property)) {
                const exportName = staticPropertyName(property.name);
                if (exportName) addCommonJsExport(exportName, property.initializer);
              } else if (ts.isShorthandPropertyAssignment(property)) {
                addCommonJsExport(property.name.text, property.name);
              } else if (ts.isMethodDeclaration(property)) {
                const exportName = staticPropertyName(property.name);
                if (exportName) addCommonJsExport(exportName, property);
              }
            }
          } else if (ts.isPropertyAccessExpression(left)
            && ts.isIdentifier(left.expression)
            && left.expression.text === 'module'
            && left.name.text === 'exports') {
            addCommonJsExport('default', right);
          }
        }
      }
      const state: FileAnalysisState = {
        filePath,
        source,
        functionEntitiesByName,
        exactCalls,
        importedFunctions: new Map(),
        knownExternalCallers: new Set(),
        localBindingsByEntityId: new Map(Array.from(functionsById.values(), (unit) => [unit.entity.id, unit.localBindings])),
        diagnostics: [],
        findings: [],
        taintNodes: 0,
        taintEdges: 0,
        paths: 0,
        limits: {
          maxTaintNodes: Math.max(0, SECURITY_LIMITS.maxTaintNodes - totalTaintNodes),
          maxTaintEdges: Math.max(0, SECURITY_LIMITS.maxTaintEdges - totalTaintEdges),
          maxPaths: Math.max(0, SECURITY_LIMITS.maxPaths - totalPaths),
          maxDepth: SECURITY_LIMITS.maxDepth,
          maxDurationMs,
        },
        startedAt: started,
        budgetExhausted: false,
        seenSinks: new Set(),
      };
      typeScriptModules.set(filePath, {
        filePath,
        source,
        ...(moduleEntity ? { moduleEntity } : {}),
        functionsById,
        exportedFunctions,
        importedBindings,
        state,
        analyzer: new SqlInjectionFileAnalyzer(state),
      });
    }

    const availableFiles = [...typeScriptModules.keys()];
    for (const moduleAnalysis of typeScriptModules.values()) {
      if (Date.now() - started >= maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${maxDurationMs}) while resolving imports`);
        partial = true;
        break;
      }
      for (const [localName, binding] of moduleAnalysis.importedBindings) {
        const targetPath = resolveRelativeImportPath(moduleAnalysis.filePath, binding.moduleSpecifier, availableFiles);
        if (!targetPath) continue;
        const targetModule = typeScriptModules.get(targetPath);
        if (!targetModule) continue;
        const targets = binding.importedName === '*'
          ? [...targetModule.exportedFunctions.entries()].flatMap(([exportName, exportedFunctions]) =>
            exportedFunctions.length === 1 ? [[`${localName}.${exportName}`, exportedFunctions[0]!] as const] : [])
          : (targetModule.exportedFunctions.get(binding.importedName) ?? []).length === 1
            ? [[localName, targetModule.exportedFunctions.get(binding.importedName)![0]!] as const]
            : [];
        for (const [bindingName, functionUnit] of targets) {
          targetModule.state.knownExternalCallers.add(functionUnit.entity.id);
          moduleAnalysis.state.importedFunctions.set(bindingName, {
            analyzer: targetModule.analyzer,
            unit: functionUnit,
            relationshipId: createImportRelationshipId(
              moduleAnalysis.moduleEntity?.id ?? moduleAnalysis.filePath,
              functionUnit.entity.id,
              moduleAnalysis.filePath,
              binding.importedName === '*' ? bindingName.slice(localName.length + 1) : binding.importedName,
            ),
          });
        }
      }
    }

    for (const moduleAnalysis of typeScriptModules.values()) {
      if (Date.now() - started >= maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${maxDurationMs})`);
        partial = true;
        break;
      }
      moduleAnalysis.state.limits.maxTaintNodes = Math.max(0, SECURITY_LIMITS.maxTaintNodes - totalTaintNodes);
      moduleAnalysis.state.limits.maxTaintEdges = Math.max(0, SECURITY_LIMITS.maxTaintEdges - totalTaintEdges);
      moduleAnalysis.state.limits.maxPaths = Math.max(0, SECURITY_LIMITS.maxPaths - totalPaths);
      if (moduleAnalysis.moduleEntity) moduleAnalysis.analyzer.analyzeModule(moduleAnalysis.moduleEntity, moduleAnalysis.source.statements);
      else {
        diagnostics.push(`${moduleAnalysis.filePath}: module entity is unavailable; top-level flow was not analyzed`);
        partial = true;
      }
      for (const unit of moduleAnalysis.functionsById.values()) moduleAnalysis.analyzer.analyzeFunction(unit);
      totalTaintNodes = 0;
      totalTaintEdges = 0;
      totalPaths = 0;
      for (const analyzedModule of typeScriptModules.values()) {
        totalTaintNodes += analyzedModule.state.taintNodes;
        totalTaintEdges += analyzedModule.state.taintEdges;
        totalPaths += analyzedModule.state.paths;
      }
      if ([...typeScriptModules.values()].some((analyzedModule) => analyzedModule.state.budgetExhausted)) {
        partial = true;
        break;
      }
    }
    for (const moduleAnalysis of typeScriptModules.values()) {
      diagnostics.push(...moduleAnalysis.state.diagnostics);
      if (moduleAnalysis.state.diagnostics.length > 0 || moduleAnalysis.state.budgetExhausted) partial = true;
      for (const finding of moduleAnalysis.state.findings) {
        const signature = finding.semanticTarget ?? '';
        if (!seenFindings.has(signature)) {
          seenFindings.add(signature);
          findings.push(finding);
        }
      }
    }
    return this.result(
      partial ? 'PARTIAL' : 'COMPLETED',
      findings,
      diagnostics,
      started,
      filesAnalyzed,
      entitiesAnalyzed,
      rulesExecuted,
      totalTaintNodes,
      totalTaintEdges,
      totalPaths,
    );
  }

  private analyzePython(
    content: string,
    filePath: string,
    entities: CodeEntityRecord[],
    relationships: CodeRelationshipRecord[],
    limits: SecurityLimits,
  ): { findings: FindingCandidate[]; diagnostics: string[]; partial: boolean; nodes: number; edges: number; paths: number } {
    const diagnostics: string[] = [];
    const findings: FindingCandidate[] = [];
    const lines = content.split(/\r\n|\r|\n/);
    const moduleEntity = entities.find((entity) => entity.entity_type === 'MODULE');
    let activeFunction: CodeEntityRecord | undefined;
    let functionIndent = -1;
    let functionParameters = new Set<string>();
    let variables = new Map<string, FlowValue>();
    let requestAliases = new Set<string>(sqlInjectionSourcePatterns.python.requestRoots);
    const conditionalIndents: number[] = [];
    let nodesCount = 0;
    let edgesCount = 0;
    let pathsCount = 0;
    let partial = false;
    const startedAt = Date.now();
    const pythonSource = sqlInjectionSourcePatterns.python;
    const functionPattern = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
    const inputPatternFor = (roots: ReadonlySet<string>): RegExp => {
      const names = [...roots];
      return names.length === 0
        ? /(?!)/
        : new RegExp(`^\\s*([A-Za-z_]\\w*)\\s*=\\s*(${names.join('|')})\\.(${pythonSource.inputProperties.join('|')})(?:\\s*\\[\\s*['"][^'"]+['"]\\s*\\]|\\s*\\.get\\(\\s*['"][^'"]+['"]\\s*\\))\\s*$`);
    };
    const assignedConcatPattern = /^\s*([A-Za-z_]\w*)\s*=\s*(['"])(.*)\2\s*\+\s*(?:str\(\s*)?([A-Za-z_]\w*)\s*\)?\s*$/;
    const aliasPattern = /^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*$/;
    const sinkStartPattern = /\b(cursor|connection|conn|db|database)\.(execute|query)\s*\(/;
    const pythonSqlCallPattern = /^\s*(?:return\s+)?\b(cursor|connection|conn|db|database)\.(execute|query)\s*\(/;
    const normalizeReturnedSqlCall = (statement: string): string => {
      const returned = /^(\s*return\s+)([\s\S]+?)\s*$/.exec(statement);
      if (!returned) return statement;
      const prefix = returned[1] ?? '';
      let expression = returned[2]?.trim() ?? '';
      while (expression.startsWith('(') && expression.endsWith(')')) {
        expression = expression.slice(1, -1).trim();
        const candidate = `${prefix}${expression}`;
        if (pythonSqlCallPattern.test(candidate)) return candidate;
      }
      return statement;
    };
    const pythonNode = (
      nodeType: CandidateEvidenceNode['nodeType'],
      label: string,
      line: number,
      endLine = line,
      attributes: Record<string, unknown> = {},
    ): CandidateEvidenceNode => ({
      nodeKey: `${nodeType.toLowerCase()}:${hash(`${filePath}:${line}:${label}`).slice(0, 20)}`,
      nodeType,
      label,
      filePath,
      line,
      endLine,
      attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE', ...attributes },
    });
    const appendPythonNode = (value: FlowValue, node: CandidateEvidenceNode, relation: string): FlowValue => {
      const path = value.path ?? { nodes: [], edges: [] };
      const previous = path.nodes.at(-1);
      return {
        ...value,
        path: {
          nodes: [...path.nodes, node],
          edges: [
            ...path.edges,
            ...(previous ? [{
              edgeKey: `flow:${hash(`${previous.nodeKey}:${relation}:${node.nodeKey}`).slice(0, 20)}`,
              fromNodeKey: previous.nodeKey,
              toNodeKey: node.nodeKey,
              relation,
              resolution: 'EXACT' as const,
              confidence: 'HIGH' as const,
              attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
            }] : []),
          ],
        },
      };
    };
    const combinePythonValues = (left: FlowValue, right: FlowValue): FlowValue => ({
      tainted: left.tainted || right.tainted,
      dynamicSql: left.dynamicSql || right.dynamicSql,
      sqlLiteral: left.sqlLiteral || right.sqlLiteral,
      path: left.tainted ? left.path : right.path,
      unknown: left.unknown || right.unknown,
    });
    const reportConditionalAssignment = (line: number): void => {
      partial = true;
      const diagnostic = `${filePath}:${line}: conditional assignment may affect SQL taint; branch values were conservatively joined`;
      if (!diagnostics.includes(diagnostic)) diagnostics.push(diagnostic);
    };
    const setPythonVariable = (name: string, value: FlowValue, line: number): void => {
      const previous = variables.get(name) ?? cleanValue;
      if (conditionalIndents.length > 0 && (previous.tainted || previous.unknown || value.tainted || value.unknown)) {
        reportConditionalAssignment(line);
        value = combinePythonValues(previous, value);
      }
      variables.set(name, value);
    };
    const evaluatePythonExpression = (
      expression: string,
      environment: Map<string, FlowValue>,
      statementLine: number,
      endLine: number,
    ): FlowValue | null => {
      const parts = pythonStringExpression(expression);
      if (!parts) return null;
      const knownSqlText = parts.map((part) => part.kind === 'literal'
        ? part.text
        : environment.get(part.name)?.literalValue ?? '').join('');
      const hasSqlParameterConstruction = statementLooksSql(knownSqlText)
        && parts.some((part) => part.kind === 'variable' && functionParameters.has(part.name));
      let value = cleanValue;
      let literalText = '';
      let resolvedLiteralText = '';
      let allPartsAreLiterals = true;
      for (const part of parts) {
        if (part.kind === 'literal') {
          literalText += part.text;
          resolvedLiteralText += part.text;
          value = combinePythonValues(value, { ...cleanValue, sqlLiteral: statementLooksSql(part.text) });
        } else {
          let partValue = environment.get(part.name) ?? emptyFlowValue(true);
          if (hasSqlParameterConstruction
            && functionParameters.has(part.name)
            && partValue.unknown
            && !partValue.tainted) {
            const sourceLabel = `parameter:${part.name}`;
            partValue = {
              ...cleanValue,
              tainted: true,
              path: {
                nodes: [pythonNode('SOURCE', sourceLabel, activeFunction?.start_line ?? statementLine, activeFunction?.start_line ?? statementLine, {
                  sourcePattern: sourceLabel,
                })],
                edges: [],
              },
            };
            environment.set(part.name, partValue);
          }
          value = combinePythonValues(value, partValue);
          if (partValue.literalValue === undefined) {
            allPartsAreLiterals = false;
          } else {
            literalText += partValue.literalValue;
            resolvedLiteralText += partValue.literalValue;
          }
        }
      }
      const sqlLiteral = statementLooksSql(literalText);
      value = {
        ...value,
        sqlLiteral,
        literalValue: allPartsAreLiterals ? resolvedLiteralText : undefined,
      };
      if (value.tainted && sqlLiteral) {
        const fString = /^[fF]['"]/.test(expression.trim());
        value = {
          ...appendPythonNode(
            value,
            pythonNode(
              'TRANSFORMATION',
              fString ? 'Interpolated SQL construction' : 'Dynamic SQL construction',
              statementLine,
              endLine,
              { operation: fString ? 'TEMPLATE_INTERPOLATION' : 'STRING_CONCATENATION' },
            ),
            fString ? 'INTERPOLATED_INTO_SQL' : 'CONTRIBUTES_TO_SQL',
          ),
          dynamicSql: true,
          sqlLiteral: true,
        };
      }
      return value;
    };
    const functionInfos: Array<{
      name: string;
      startLine: number;
      indent: number;
      parameters: string[];
      parentStartLine?: number;
    }> = [];
    const functionStack: typeof functionInfos = [];
    for (const [lineIndex, candidateLine] of lines.entries()) {
      const candidate = functionPattern.exec(candidateLine);
      if (!candidate) continue;
      const indent = (candidate[1] ?? '').length;
      while (functionStack.at(-1) && (functionStack.at(-1)?.indent ?? -1) >= indent) functionStack.pop();
      const signature = /\(([^)]*)\)/.exec(candidateLine)?.[1] ?? '';
      const info: (typeof functionInfos)[number] = {
        name: candidate[2] ?? '',
        startLine: lineIndex + 1,
        indent,
        parameters: signature.split(',').flatMap((parameter) => {
          const name = /^\s*([A-Za-z_]\w*)/.exec(parameter)?.[1];
          return name ? [name] : [];
        }),
        ...(functionStack.at(-1) ? { parentStartLine: functionStack.at(-1)?.startLine } : {}),
      };
      functionInfos.push(info);
      functionStack.push(info);
    }
    const functionInfoByStartLine = new Map(functionInfos.map((info) => [info.startLine, info]));
    const nestedParameterFlows = new Map<number, Map<string, FlowValue>>();
    const nestedCallLines = new Set<number>();
    const directSourceCallPattern = new RegExp(`^\\s*(?:return\\s+)?([A-Za-z_]\\w*)\\(\\s*(${pythonSource.requestRoots.join('|')})\\.(${pythonSource.inputProperties.join('|')})(?:\\s*\\[\\s*['"][^'"]+['"]\\s*\\]|\\s*\\.get\\(\\s*['"][^'"]+['"]\\s*\\))\\s*\\)\\s*$`);
    for (const nested of functionInfos.filter((info) => info.parentStartLine !== undefined)) {
      const parent = functionInfoByStartLine.get(nested.parentStartLine ?? -1);
      const parameterName = nested.parameters[0];
      if (!parent || !parameterName) continue;
      for (let lineIndex = nested.startLine; lineIndex < lines.length; lineIndex += 1) {
        const candidateLine = lines[lineIndex] ?? '';
        const candidateIndent = /^\s*/.exec(candidateLine)?.[0].length ?? 0;
        if (candidateIndent < nested.indent) break;
        if (candidateIndent !== nested.indent) continue;
        const call = directSourceCallPattern.exec(candidateLine);
        if (!call || call[1] !== nested.name || !parent.parameters.includes(call[2] ?? '')) continue;
        const sourceLine = lineIndex + 1;
        const sourcePattern = `${call[2]}.${call[3]}`;
        const sourceNode = pythonNode('SOURCE', sourcePattern, sourceLine, sourceLine, {
          sourcePattern,
          sourceEntityId: entities.find((entity) => entity.start_line === parent.startLine)?.id,
        });
        const parameterNode = pythonNode('VARIABLE', parameterName, nested.startLine, nested.startLine, {
          operation: 'PARAMETER',
          sourceEntityId: entities.find((entity) => entity.start_line === nested.startLine)?.id,
        });
        const sourceValue: FlowValue = {
          ...cleanValue,
          tainted: true,
          path: { nodes: [sourceNode], edges: [] },
        };
        const parameterValue = appendPythonNode(sourceValue, parameterNode, 'PASSES_ARGUMENT');
        const parameters = nestedParameterFlows.get(nested.startLine) ?? new Map<string, FlowValue>();
        parameters.set(parameterName, parameterValue);
        nestedParameterFlows.set(nested.startLine, parameters);
        nestedCallLines.add(lineIndex);
      }
    }
    for (let index = 0; index < lines.length; index += 1) {
      if (Date.now() - startedAt >= limits.maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${limits.maxDurationMs})`);
        partial = true;
        break;
      }
      const line = lines[index] ?? '';
      let statementText = line;
      let assignmentEnd = index;
      if (/^\s*[A-Za-z_]\w*\s*=\s*\(/.test(line)) {
        let balance = pythonParenthesisDelta(statementText);
        while (balance > 0 && assignmentEnd + 1 < lines.length) {
          assignmentEnd += 1;
          statementText += `\n${lines[assignmentEnd] ?? ''}`;
          balance = pythonParenthesisDelta(statementText);
        }
        if (balance !== 0) {
          diagnostics.push(`${filePath}:${index + 1}: Python assignment expression has unbalanced parentheses`);
          partial = true;
          index = assignmentEnd;
          continue;
        }
      }
      const definition = functionPattern.exec(line);
      if (definition) {
        const name = definition[2];
        const startLine = index + 1;
        const functionInfo = functionInfoByStartLine.get(startLine);
        activeFunction = entities.find((entity) =>
          (entity.entity_type === 'FUNCTION' || entity.entity_type === 'METHOD')
          && entity.name === name
          && entity.start_line === startLine,
        );
        functionIndent = (definition[1] ?? '').length;
        functionParameters = new Set();
        variables = new Map(nestedParameterFlows.get(startLine) ?? []);
        const parameterSources = functionInfo?.parameters.filter((parameter) =>
          !pythonSource.requestRoots.includes(parameter as typeof pythonSource.requestRoots[number])
          && !['cursor', 'connection', 'conn', 'db', 'database', 'self', 'cls'].includes(parameter.toLowerCase())) ?? [];
        for (const parameter of parameterSources) {
          functionParameters.add(parameter);
          if (variables.has(parameter)) continue;
          variables.set(parameter, emptyFlowValue(true));
        }
        requestAliases = new Set((functionInfo?.parameters ?? []).filter((parameter) =>
          pythonSource.requestRoots.includes(parameter as typeof pythonSource.requestRoots[number])));
        conditionalIndents.length = 0;
        if (!activeFunction) {
          diagnostics.push(`${filePath}:${startLine}: Python function could not be mapped to Code IR`);
          partial = true;
        }
        continue;
      }
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (functionIndent >= 0 && indent <= functionIndent) {
        activeFunction = undefined;
        functionIndent = -1;
        functionParameters = new Set();
        variables = new Map();
        requestAliases = new Set(pythonSource.requestRoots);
      }
      while (conditionalIndents.at(-1) !== undefined && (conditionalIndents.at(-1) ?? -1) >= indent) {
        conditionalIndents.pop();
      }
      const insideConditional = conditionalIndents.length > 0;
      const conditionalHeader = /^\s*(?:if|elif|else|for|while|try|except|finally|with)\b.*:\s*(?:#.*)?$/.test(line);
      if (nestedCallLines.has(index)) continue;
      if (conditionalHeader) {
        const requestAccess = new RegExp(`\\b(?:${[...requestAliases].join('|')})\\.(?:${pythonSource.inputProperties.join('|')})\\b`);
        if (requestAccess.test(line)
          || [...variables.values()].some((value) => value.tainted || value.unknown)) {
          partial = true;
          diagnostics.push(`${filePath}:${index + 1}: conditional control flow may affect SQL taint and is not modeled`);
        }
        if (/:\s*\S/.test(line.replace(/:\s*#.*$/, ':'))) {
          partial = true;
          diagnostics.push(`${filePath}:${index + 1}: one-line Python control-flow suites are unsupported`);
        }
        conditionalIndents.push(indent);
        continue;
      }
      const sourceMatch = inputPatternFor(requestAliases).exec(line);
      if (sourceMatch) {
        const sourceKey = `source:${hash(`${filePath}:${index}:${sourceMatch[2]}.${sourceMatch[3]}`).slice(0, 20)}`;
        const sourceNode: CandidateEvidenceNode = {
          nodeKey: sourceKey,
          nodeType: 'SOURCE',
          label: `${sourceMatch[2]}.${sourceMatch[3]}`,
          filePath,
          line: index + 1,
          attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE', confidence: 'HIGH', sourcePattern: `${sourceMatch[2]}.${sourceMatch[3]}` },
        };
        setPythonVariable(sourceMatch[1] ?? '', {
          tainted: true,
          dynamicSql: false,
          sqlLiteral: false,
          path: { nodes: [sourceNode], edges: [] },
          unknown: false,
        }, index + 1);
        continue;
      }
      const concatMatch = assignedConcatPattern.exec(line);
      if (concatMatch) {
        const existing = variables.get(concatMatch[4] ?? '');
        const sqlLiteral = statementLooksSql(concatMatch[3] ?? '');
        if (existing?.tainted && sqlLiteral) {
          const variableName = concatMatch[1] ?? '';
          const expressionNode: CandidateEvidenceNode = {
            nodeKey: `transformation:${hash(`${filePath}:${index}:${line}`).slice(0, 20)}`,
            nodeType: 'TRANSFORMATION',
            label: 'Dynamic SQL construction',
            filePath,
            line: index + 1,
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE', operation: 'STRING_CONCATENATION' },
          };
          const last = existing.path?.nodes.at(-1);
          const edge: CandidateEvidenceEdge | null = last ? {
            edgeKey: `flow:${hash(`${last.nodeKey}:${expressionNode.nodeKey}`).slice(0, 20)}`,
            fromNodeKey: last.nodeKey,
            toNodeKey: expressionNode.nodeKey,
            relation: 'CONTRIBUTES_TO_SQL',
            resolution: 'EXACT',
            confidence: 'HIGH',
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
          } : null;
          const variableNode: CandidateEvidenceNode = {
            nodeKey: `variable:${hash(`${filePath}:${index}:${variableName}`).slice(0, 20)}`,
            nodeType: 'VARIABLE',
            label: variableName,
            filePath,
            line: index + 1,
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
          };
          const expressionPath: FlowPath = {
            nodes: [...(existing.path?.nodes ?? []), expressionNode, variableNode],
            edges: [
              ...(existing.path?.edges ?? []),
              ...(edge ? [edge] : []),
              {
                edgeKey: `flow:${hash(`${expressionNode.nodeKey}:ASSIGNED_TO:${variableNode.nodeKey}`).slice(0, 20)}`,
                fromNodeKey: expressionNode.nodeKey,
                toNodeKey: variableNode.nodeKey,
                relation: 'ASSIGNED_TO',
                resolution: 'EXACT',
                confidence: 'HIGH',
                attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
              },
            ],
          };
          setPythonVariable(variableName, { tainted: true, dynamicSql: true, sqlLiteral: true, path: expressionPath, unknown: false }, index + 1);
          continue;
        }
      }
      const aliasMatch = aliasPattern.exec(statementText);
      if (aliasMatch) {
        const aliasName = aliasMatch[1] ?? '';
        const sourceName = aliasMatch[2] ?? '';
        const sourceIsRequest = requestAliases.has(sourceName);
        const targetIsRequest = requestAliases.has(aliasName);
        if (sourceIsRequest) {
          if (insideConditional) reportConditionalAssignment(index + 1);
          requestAliases.add(aliasName);
        } else if (!insideConditional) {
          requestAliases.delete(aliasName);
        } else if (targetIsRequest) {
          reportConditionalAssignment(index + 1);
        }
        const existing = variables.get(aliasMatch[2] ?? '');
        if (existing?.tainted && existing.path) {
          const variableName = aliasMatch[1] ?? '';
          const variableNode: CandidateEvidenceNode = {
            nodeKey: `variable:${hash(`${filePath}:${index}:${variableName}`).slice(0, 20)}`,
            nodeType: 'VARIABLE',
            label: variableName,
            filePath,
            line: index + 1,
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
          };
          const last = existing.path.nodes.at(-1);
          const edge: CandidateEvidenceEdge | null = last ? {
            edgeKey: `flow:${hash(`${last.nodeKey}:ASSIGNED_TO:${variableNode.nodeKey}`).slice(0, 20)}`,
            fromNodeKey: last.nodeKey,
            toNodeKey: variableNode.nodeKey,
            relation: 'ASSIGNED_TO',
            resolution: 'EXACT',
            confidence: 'HIGH',
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
          } : null;
          setPythonVariable(variableName, {
            ...existing,
            path: { nodes: [...existing.path.nodes, variableNode], edges: [...existing.path.edges, ...(edge ? [edge] : [])] },
          }, index + 1);
        } else {
          if (insideConditional && (variables.get(aliasName)?.tainted || variables.get(aliasName)?.unknown)) {
            partial = true;
            diagnostics.push(`${filePath}:${index + 1}: conditional assignment may affect SQL taint; branch values were conservatively joined`);
          } else {
            variables.delete(aliasName);
          }
        }
        continue;
      }
      const literalAssignmentMatch = /^\s*([A-Za-z_]\w*)\s*=\s*(?:(['"])(?:\\.|(?!\2)[^\\])*\2|[-+]?\d+(?:\.\d+)?|True|False|None)\s*(?:#.*)?$/.exec(statementText);
      if (literalAssignmentMatch) {
        const variableName = literalAssignmentMatch[1] ?? '';
        const literalExpression = /^\s*[A-Za-z_]\w*\s*=\s*((['"])(?:\\.|(?!\2)[^\\])*\2)\s*(?:#.*)?$/.exec(statementText)?.[1];
        const literalValue = literalExpression === undefined ? null : parsePythonStringLiteral(literalExpression);
        if (!insideConditional) requestAliases.delete(variableName);
        else if (requestAliases.has(variableName)) reportConditionalAssignment(index + 1);
        setPythonVariable(variableName, {
          ...cleanValue,
          ...(literalValue === null ? {} : { literalValue }),
        }, index + 1);
        continue;
      }
      const assignmentMatch = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+?)\s*$/.exec(statementText);
      if (assignmentMatch) {
        const variableName = assignmentMatch[1] ?? '';
        const value = evaluatePythonExpression(assignmentMatch[2] ?? '', variables, index + 1, assignmentEnd + 1);
        if (value) {
          setPythonVariable(variableName, value.tainted
            ? appendPythonNode(value, pythonNode('VARIABLE', variableName, index + 1, assignmentEnd + 1), 'ASSIGNED_TO')
            : value, index + 1);
          index = assignmentEnd;
          continue;
        }
        setPythonVariable(variableName, emptyFlowValue(true), index + 1);
      }
      const requestAccess = new RegExp(`\\b(?:${[...requestAliases].join('|')})\\.(?:${pythonSource.inputProperties.join('|')})\\b`);
      if (requestAccess.test(line)
        && !/^\s*return\b/.test(line)
        && !sourceMatch) {
        diagnostics.push(`${filePath}:${index + 1}: Python source expression is outside the supported assignment subset`);
        partial = true;
      }
      let sinkStatement = line;
      let statementEnd = index;
      if (sinkStartPattern.test(line)) {
        let balance = pythonParenthesisDelta(line);
        while (balance > 0 && statementEnd + 1 < lines.length) {
          statementEnd += 1;
          sinkStatement += `\n${lines[statementEnd] ?? ''}`;
          balance = pythonParenthesisDelta(sinkStatement);
        }
        if (balance !== 0) {
          diagnostics.push(`${filePath}:${index + 1}: SQL sink call has an incomplete argument list`);
          partial = true;
          index = statementEnd;
          continue;
        }
      }
      const normalizedSinkStatement = normalizeReturnedSqlCall(sinkStatement);
      const directCallMatch = pythonSqlCallPattern.exec(normalizedSinkStatement);
      const directArguments = directCallMatch ? splitPythonCallArguments(normalizedSinkStatement) : null;
      const directQuery = directCallMatch && directArguments?.[0]
        ? evaluatePythonExpression(directArguments[0], variables, index + 1, statementEnd + 1)
        : null;
      const safeParameterizedQuery = directArguments?.length === 2
        && isPythonTupleBinding(directArguments[1] ?? '')
        && directQuery
        && !directQuery.tainted
        && !directQuery.unknown
        && directQuery.literalValue !== undefined
        && statementLooksSql(directQuery.literalValue)
        && /(?:\?|%\w|\$\d+|:[A-Za-z_]\w*)/.test(directQuery.literalValue);
      if (safeParameterizedQuery) {
        index = statementEnd;
        continue;
      }
      if (directCallMatch) {
        const queryVariable = directQuery ?? undefined;
        const sinkEntity = activeFunction ?? moduleEntity;
        const queryHasPlaceholder = queryVariable?.literalValue !== undefined
          && /(?:\?|%\w|\$\d+|:[A-Za-z_]\w*)/.test(queryVariable.literalValue);
        if (queryVariable?.tainted && queryVariable.dynamicSql && queryVariable.path && sinkEntity) {
          const sinkLabel = `${directCallMatch[1]}.${directCallMatch[2]}`;
          const sinkNode: CandidateEvidenceNode = {
            nodeKey: `sink:${hash(`${filePath}:${index}:${sinkLabel}`).slice(0, 20)}`,
            nodeType: 'SINK',
            label: sinkLabel,
            filePath,
            line: index + 1,
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE', confidence: 'HIGH', sinkPattern: sinkLabel },
          };
          const last = queryVariable.path.nodes.at(-1);
          if (!last) continue;
          const sinkEdge: CandidateEvidenceEdge = {
            edgeKey: `flow:${hash(`${last.nodeKey}:REACHES_SQL_SINK:${sinkNode.nodeKey}`).slice(0, 20)}`,
            fromNodeKey: last.nodeKey,
            toNodeKey: sinkNode.nodeKey,
            relation: 'REACHES_SQL_SINK',
            resolution: 'EXACT',
            confidence: 'HIGH',
            attributes: { provenance: 'SECURITY_ANALYZER', authority: 'AUTHORITATIVE' },
          };
          const graphNodes = [...queryVariable.path.nodes, sinkNode];
          const graphEdges = [...queryVariable.path.edges, sinkEdge];
          if (nodesCount + graphNodes.length > limits.maxTaintNodes
            || edgesCount + graphEdges.length > limits.maxTaintEdges
            || pathsCount + 1 > limits.maxPaths) {
            diagnostics.push('Exceeded SQL taint graph budget; further candidate paths were not emitted');
            partial = true;
            break;
          }
          nodesCount += graphNodes.length;
          edgesCount += graphEdges.length;
          pathsCount += 1;
          const semanticTarget = `${sinkEntity.qualified_name ?? sinkEntity.name}::${sinkLabel}::${index + 1}`;
          findings.push({
            ruleId: sqlInjectionRule.id,
            ruleVersion: sqlInjectionRule.version,
            title: 'Untrusted input reaches a dynamic SQL sink',
            description: sqlInjectionRule.description,
            category: 'SECURITY',
            severity: 'HIGH',
            confidence: 'HIGH',
            repositoryId: sinkEntity.repository_id,
            commitId: sinkEntity.commit_id,
            file: filePath,
            startLine: index + 1,
            endLine: index + 1,
            semanticTarget,
            evidenceInputs: { source: graphNodes[0]?.label, sink: sinkLabel, evidenceSufficiency: 'SUFFICIENT', evidenceCompleteness: 'COMPLETE' },
            fingerprintInputs: { source: graphNodes[0]?.attributes.sourcePattern, sink: sinkLabel, flowRelations: graphEdges.map((edge) => edge.relation) },
            evidenceGraph: {
              nodes: graphNodes,
              edges: graphEdges,
              paths: [{
                id: `taint-path:${hash(graphNodes.map((node) => node.nodeKey).join('>')).slice(0, 20)}`,
                nodeIds: graphNodes.map((node) => node.nodeKey),
                edgeIds: graphEdges.map((edge) => edge.edgeKey),
                completeness: 'COMPLETE',
                diagnostics: [],
              }],
              completeness: 'COMPLETE',
              sufficiency: 'SUFFICIENT',
              diagnostics: [],
            },
          });
          } else if (queryVariable?.tainted && queryVariable.dynamicSql) {
            diagnostics.push(`${filePath}:${index + 1}: dynamic SQL flow could not be associated with a Code IR entity`);
            partial = true;
          } else if (queryVariable?.tainted && !queryVariable.dynamicSql) {
            diagnostics.push(`${filePath}:${index + 1}: tainted SQL argument is not a proven dynamic query`);
            partial = true;
          } else if (queryVariable?.unknown) {
            diagnostics.push(`${filePath}:${index + 1}: SQL argument contains an unresolved value; safety was not established`);
            partial = true;
          } else if (
            !queryVariable
            || queryVariable.literalValue === undefined
            || !statementLooksSql(queryVariable.literalValue)
            || queryHasPlaceholder
            || (directArguments?.length ?? 0) > 1
          ) {
            diagnostics.push(`${filePath}:${index + 1}: Python SQL sink arguments are outside the recognized query and binding subset`);
            partial = true;
          }
        index = statementEnd;
        continue;
      }
      if (sinkStartPattern.test(line)) {
        diagnostics.push(`${filePath}:${index + 1}: Python SQL sink argument could not be resolved to the supported variable or parameterized-query form`);
        partial = true;
        index = statementEnd;
        continue;
      }
      if (/^\s*return\b/.test(line)) {
        const returnsTaintedValue = [...variables.entries()].some(([name, value]) =>
          value.tainted && new RegExp(`\\b${name}\\b`).test(line));
        if (returnsTaintedValue) {
          diagnostics.push(`${filePath}:${index + 1}: Python return propagation is not supported for tainted values`);
          partial = true;
        }
        continue;
      }
      if (/\b(?:request|req)\.(?:args|form|json|query|body|params)\b/.test(line)
        && !sourceMatch) {
        diagnostics.push(`${filePath}:${index + 1}: Python source expression is outside the supported assignment subset`);
        partial = true;
        continue;
      }
      const taintedNames = [...variables.keys()].filter((name) => new RegExp(`\\b${name}\\b`).test(line));
      if (taintedNames.length > 0 && /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(line)) {
        diagnostics.push(`${filePath}:${index + 1}: tainted Python data participates in unsupported SQL construction`);
        partial = true;
      } else if (taintedNames.length > 0 && /\b[A-Za-z_]\w*\s*\(/.test(line) && !sinkStartPattern.test(line)) {
        diagnostics.push(`${filePath}:${index + 1}: tainted Python data reaches an unsupported function call; interprocedural propagation is not proven`);
        partial = true;
      }
    }
    if (relationships.some((relationship) =>
      relationship.relation === 'CALLS'
      && relationship.resolution !== 'EXACT'
      && entities.some((entity) => entity.id === relationship.source_entity_id && entity.file_path === filePath))) {
      diagnostics.push(`${filePath}: unresolved Python call relationships are not treated as exact taint propagation`);
      partial = true;
    }
    const hasRecognizedInput = lines.some((line) => inputPatternFor(new Set(pythonSource.requestRoots)).test(line));
    const hasRecognizedSink = lines.some((line) => sinkStartPattern.test(line));
    if (hasRecognizedInput && hasRecognizedSink && relationships.some((relationship) =>
      relationship.relation === 'CALLS'
      && relationship.resolution === 'EXACT'
      && entities.some((entity) => entity.id === relationship.source_entity_id && entity.file_path === filePath))) {
      diagnostics.push(`${filePath}: Python interprocedural taint propagation is unsupported; exact call edges are not assumed to prove argument or return flow`);
      partial = true;
    }
    return { findings, diagnostics, partial, nodes: nodesCount, edges: edgesCount, paths: pathsCount };
  }

  private result(
    status: AnalyzerResult['status'],
    findings: FindingCandidate[],
    diagnostics: string[],
    started: number,
    filesAnalyzed: number,
    entitiesAnalyzed: number,
    rulesExecuted: number,
    taintNodes: number,
    taintEdges: number,
    paths: number,
  ): AnalyzerResult {
    return {
      status,
      findings,
      diagnostics,
      metrics: {
        durationMs: Date.now() - started,
        filesAnalyzed,
        entitiesAnalyzed,
        rulesExecuted,
        findingsProduced: findings.length,
        taintNodes,
        taintEdges,
        paths,
      },
    };
  }
}

export const sqlInjectionAnalyzer = new SqlInjectionAnalyzer();
