import { createHash } from 'node:crypto';

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
}

interface FunctionUnit {
  entity: CodeEntityRecord;
  node: ts.FunctionLikeDeclaration;
}

interface FileAnalysisState {
  filePath: string;
  source: ts.SourceFile;
  functionEntitiesByName: Map<string, FunctionUnit[]>;
  exactCalls: Map<string, CodeRelationshipRecord>;
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
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lineAt(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function statementLooksSql(value: string): boolean {
  return /^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE|MERGE|CREATE|ALTER|DROP)\b/i.test(value);
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
  if (!patterns.requestRoots.includes(root as typeof patterns.requestRoots[number])) return null;
  if (!getParameterNames(current).has(root)) return null;
  if (accessNames.length < 1 || !patterns.inputProperties.includes(accessNames[0] as typeof patterns.inputProperties[number])) return null;
  if (accessNames[1] === '*') return `${root}.${accessNames[0]}`;
  return `${root}.${accessNames.slice(0, Math.min(2, accessNames.length)).join('.')}`;
}

function staticSqlLiteralText(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) return node.head.text;
  return null;
}

function isRecognizedSqlSink(node: ts.CallExpression): { receiver: string; method: string } | null {
  if (!ts.isPropertyAccessExpression(node.expression) || !ts.isIdentifier(node.expression.expression)) return null;
  const receiver = node.expression.expression.text;
  const method = node.expression.name.text;
  const allowed = sqlInjectionSinkPatterns.receiverMethods[receiver as keyof typeof sqlInjectionSinkPatterns.receiverMethods] as readonly string[] | undefined;
  return allowed?.includes(method) ? { receiver, method } : null;
}

function isRecognizedParameterizedCall(node: ts.CallExpression): boolean {
  const query = node.arguments[0];
  const bindings = node.arguments[1];
  const queryText = staticSqlLiteralText(query);
  if (!bindings || !queryText) return false;
  return /(?:\?|%\w|\$\d+|:[A-Za-z_]\w*)/.test(queryText) && statementLooksSql(queryText);
}

function expressionContainsRelevantSecuritySyntax(node: ts.Node): boolean {
  let relevant = false;
  const visit = (child: ts.Node): void => {
    if (sourcePattern(child) || (ts.isCallExpression(child) && isRecognizedSqlSink(child))) relevant = true;
    if (!relevant) ts.forEachChild(child, visit);
  };
  visit(node);
  return relevant;
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
    const source = sourcePattern(node);
    if (source) {
      const evidenceNode = this.makeNode('SOURCE', source, node, { sourcePattern: source });
      return {
        tainted: true,
        dynamicSql: false,
        sqlLiteral: false,
        path: { nodes: [evidenceNode], edges: [] },
        unknown: false,
      };
    }
    if (ts.isIdentifier(node)) return environment.get(node.text) ?? cleanValue;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return { ...cleanValue, sqlLiteral: statementLooksSql(node.text) };
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
      if (!dynamicSql) return { ...combined, dynamicSql: false };
      const transformation = this.makeNode('TRANSFORMATION', 'Dynamic SQL construction', node, { operation: 'STRING_CONCATENATION' });
      return { ...this.appendNode(combined, transformation, 'CONTRIBUTES_TO_SQL'), dynamicSql: true, sqlLiteral: true };
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
      if (!combined.tainted || !sqlLiteral) return { ...combined, sqlLiteral };
      const transformation = this.makeNode('TRANSFORMATION', 'Interpolated SQL construction', node, { operation: 'TEMPLATE_INTERPOLATION' });
      return { ...this.appendNode(combined, transformation, 'INTERPOLATED_INTO_SQL'), dynamicSql: true, sqlLiteral: true };
    }
    if (ts.isCallExpression(node)) return this.evaluateCall(node, environment, caller, depth + 1);
    if (ts.isPropertyAccessExpression(node)) {
      const base = this.evaluateExpression(node.expression, environment, caller, depth + 1);
      if (!base.tainted) return base;
      return this.appendNode(base, this.makeNode('VARIABLE', node.getText(this.state.source), node, {
        sourceEntityId: caller.id,
        operation: 'PROPERTY_READ',
      }), 'READS_PROPERTY');
    }
    if (ts.isElementAccessExpression(node)) {
      const base = this.evaluateExpression(node.expression, environment, caller, depth + 1);
      if (!base.tainted) return base;
      return this.appendNode(base, this.makeNode('VARIABLE', node.getText(this.state.source), node, {
        sourceEntityId: caller.id,
        operation: 'ELEMENT_READ',
      }), 'READS_PROPERTY');
    }
    if (ts.isConditionalExpression(node) || ts.isAwaitExpression(node)) {
      const value = this.evaluateExpression(ts.isConditionalExpression(node) ? node.whenTrue : node.expression, environment, caller, depth + 1);
      if (value.tainted) {
        this.state.diagnostics.push(`Unsupported control/data-flow expression at ${this.state.filePath}:${lineAt(this.state.source, node)}`);
        return { ...value, unknown: true };
      }
      return value;
    }
    return emptyFlowValue();
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
      const query = args[0] ?? cleanValue;
      if (query.tainted && query.dynamicSql && !query.unknown && query.path) {
        this.addFinding(sink, query, call, caller);
      } else if (query.tainted && (query.unknown || !query.dynamicSql)) {
        this.state.diagnostics.push(`SQL sink has tainted or unresolved input without a fully proven dynamic SQL path at ${this.state.filePath}:${lineAt(this.state.source, call)}`);
      }
      return cleanValue;
    }

    const target = this.resolveExactCall(call, caller);
    if (!target) {
      if (args.some((argument) => argument.tainted)) {
        this.state.diagnostics.push(`Tainted argument reaches an unresolved call at ${this.state.filePath}:${lineAt(this.state.source, call)}`);
        return emptyFlowValue(true);
      }
      return cleanValue;
    }
    if (this.callStack.includes(target.entity.id)) {
      if (args.some((argument) => argument.tainted)) {
        this.state.diagnostics.push(`Taint call cycle could not be resolved at ${this.state.filePath}:${lineAt(this.state.source, call)}`);
        return emptyFlowValue(true);
      }
      return cleanValue;
    }
    const callRelationship = this.state.exactCalls.get(`${caller.id}:${target.entity.id}`);
    if (!callRelationship) return emptyFlowValue(true);
    const calledArgs = args.map((argument) => argument.tainted
      ? this.appendNode(argument, this.makeNode('CALL', target.entity.qualified_name ?? target.entity.name, call, {
        sourceEntityId: caller.id,
        targetEntityId: target.entity.id,
        sourceRelationshipId: callRelationship.id,
      }), 'CALLS')
      : argument);
    const returned = this.executeFunction(target, calledArgs, depth + 1, call);
    if (!returned.tainted) return returned;
    return this.appendNode(returned, this.makeNode('CALL', `${target.entity.name} return`, call, {
      sourceEntityId: caller.id,
      targetEntityId: target.entity.id,
      sourceRelationshipId: callRelationship.id,
    }), 'RETURNED_FROM_CALL');
  }

  private resolveExactCall(call: ts.CallExpression, caller: CodeEntityRecord): FunctionUnit | null {
    let targetName: string | null = null;
    if (ts.isIdentifier(call.expression)) targetName = call.expression.text;
    else if (ts.isPropertyAccessExpression(call.expression) && call.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
      targetName = call.expression.name.text;
    }
    if (!targetName) return null;
    const candidates = this.state.functionEntitiesByName.get(targetName) ?? [];
    if (candidates.length !== 1) return null;
    const target = candidates[0];
    const key = `${caller.id}:${target.entity.id}`;
    return target && this.state.exactCalls.has(key) ? target : null;
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
      for (let index = 0; index < parameterNames.length; index += 1) {
        const parameter = parameterNames[index];
        if (!parameter || !ts.isIdentifier(parameter.name)) {
          this.state.diagnostics.push(`Unsupported parameter binding in ${unit.entity.qualified_name ?? unit.entity.name}`);
          continue;
        }
        let value = arguments_[index] ?? cleanValue;
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
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            if (declaration.initializer && expressionContainsRelevantSecuritySyntax(declaration.initializer)) {
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
        this.evaluateExpression(statement.expression, environment, caller, depth + 1);
        continue;
      }
      if (ts.isReturnStatement(statement)) {
        if (!statement.expression) return cleanValue;
        const value = this.evaluateExpression(statement.expression, environment, caller, depth + 1);
        return value.tainted
          ? this.appendNode(value, this.makeNode('TRANSFORMATION', 'Function return', statement, { sourceEntityId: caller.id }), 'RETURNS')
          : value;
      }
      if (ts.isBlock(statement)) {
        const returned = this.executeStatements(statement.statements, environment, caller, depth + 1);
        if (returned.tainted || returned.unknown) return returned;
        continue;
      }
      if (ts.isFunctionDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
      if (expressionContainsRelevantSecuritySyntax(statement)) {
        this.state.diagnostics.push(`Unsupported statement may affect security data flow at ${this.state.filePath}:${lineAt(this.state.source, statement)}`);
      }
    }
    return cleanValue;
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

    for (const filePath of selectedFiles) {
      if (Date.now() - started >= maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${maxDurationMs})`);
        partial = true;
        break;
      }
      const metadata = await context.sourceAccess.getSourceMetadata(filePath);
      if (!metadata.exists) {
        diagnostics.push(`${filePath}: source is unavailable; security analysis was not performed`);
        partial = true;
        continue;
      }
      if (!metadata.language || !['Python', 'JavaScript', 'TypeScript'].includes(metadata.language)) continue;
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
        const unit = { entity, node: item.node };
        functionsById.set(entity.id, unit);
        functionEntitiesByName.set(item.name, [...(functionEntitiesByName.get(item.name) ?? []), unit]);
      }
      const moduleEntity = fileEntities.find((entity) => entity.entity_type === 'MODULE');
      const exactCalls = new Map(relationships
        .filter((relationship) => relationship.relation === 'CALLS' && relationship.resolution === 'EXACT')
        .map((relationship) => [`${relationship.source_entity_id}:${relationship.target_entity_id}`, relationship]));
      const state: FileAnalysisState = {
        filePath,
        source,
        functionEntitiesByName,
        exactCalls,
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
      const fileAnalyzer = new SqlInjectionFileAnalyzer(state);
      if (moduleEntity) fileAnalyzer.analyzeModule(moduleEntity, source.statements);
      else {
        diagnostics.push(`${filePath}: module entity is unavailable; top-level flow was not analyzed`);
        partial = true;
      }
      for (const unit of functionsById.values()) fileAnalyzer.analyzeFunction(unit);
      diagnostics.push(...state.diagnostics);
      if (state.diagnostics.length > 0) partial = true;
      for (const finding of state.findings) {
        const signature = finding.semanticTarget ?? '';
        if (!seenFindings.has(signature)) {
          seenFindings.add(signature);
          findings.push(finding);
        }
      }
      totalTaintNodes += state.taintNodes;
      totalTaintEdges += state.taintEdges;
      totalPaths += state.paths;
      if (state.budgetExhausted) {
        partial = true;
        break;
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
    let activeFunction: CodeEntityRecord | undefined;
    let functionIndent = -1;
    let variables = new Map<string, FlowValue>();
    let nodesCount = 0;
    let edgesCount = 0;
    let pathsCount = 0;
    let partial = false;
    const startedAt = Date.now();
    const pythonSource = sqlInjectionSourcePatterns.python;
    const functionPattern = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
    const inputPattern = new RegExp(`^\\s*([A-Za-z_]\\w*)\\s*=\\s*(${pythonSource.requestRoots.join('|')})\\.(${pythonSource.inputProperties.join('|')})(?:\\s*\\[\\s*['"][^'"]+['"]\\s*\\])\\s*$`);
    const assignedConcatPattern = /^\s*([A-Za-z_]\w*)\s*=\s*(['"])(.*)\2\s*\+\s*([A-Za-z_]\w*)\s*$/;
    const aliasPattern = /^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*$/;
    const sinkStartPattern = /\b(cursor|connection|conn|db|database)\.(execute|query)\s*\(/;
    const executePattern = /\b(cursor|connection|conn|db|database)\.(execute|query)\s*\(\s*([A-Za-z_]\w*)\s*(?:,\s*([^)]+))?\s*\)/;
    const parameterizedCallPattern = /^\s*(?:cursor|connection|conn|db|database)\.(?:execute|query)\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*[\s\S]+\)\s*$/;
    for (let index = 0; index < lines.length; index += 1) {
      if (Date.now() - startedAt >= limits.maxDurationMs) {
        diagnostics.push(`Exceeded maxDurationMs budget (${limits.maxDurationMs})`);
        partial = true;
        break;
      }
      const line = lines[index] ?? '';
      const definition = functionPattern.exec(line);
      if (definition) {
        const name = definition[2];
        const startLine = index + 1;
        activeFunction = entities.find((entity) =>
          (entity.entity_type === 'FUNCTION' || entity.entity_type === 'METHOD')
          && entity.name === name
          && entity.start_line === startLine,
        );
        functionIndent = (definition[1] ?? '').length;
        variables = new Map();
        if (!activeFunction) {
          diagnostics.push(`${filePath}:${startLine}: Python function could not be mapped to Code IR`);
          partial = true;
        }
        continue;
      }
      if (!line.trim()) continue;
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (activeFunction && indent <= functionIndent) {
        activeFunction = undefined;
        variables = new Map();
      }
      const sourceMatch = inputPattern.exec(line);
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
        variables.set(sourceMatch[1] ?? '', {
          tainted: true,
          dynamicSql: false,
          sqlLiteral: false,
          path: { nodes: [sourceNode], edges: [] },
          unknown: false,
        });
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
          variables.set(variableName, { tainted: true, dynamicSql: true, sqlLiteral: true, path: expressionPath, unknown: false });
          continue;
        }
      }
      const aliasMatch = aliasPattern.exec(line);
      if (aliasMatch) {
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
          variables.set(variableName, {
            ...existing,
            path: { nodes: [...existing.path.nodes, variableNode], edges: [...existing.path.edges, ...(edge ? [edge] : [])] },
          });
        }
        continue;
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
      const executeMatch = executePattern.exec(sinkStatement);
      if (executeMatch) {
        const queryVariable = variables.get(executeMatch[3] ?? '');
        if (queryVariable?.tainted && queryVariable.dynamicSql && queryVariable.path && activeFunction) {
          const sinkLabel = `${executeMatch[1]}.${executeMatch[2]}`;
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
          const semanticTarget = `${activeFunction.qualified_name ?? activeFunction.name}::${sinkLabel}::${index + 1}`;
          findings.push({
            ruleId: sqlInjectionRule.id,
            ruleVersion: sqlInjectionRule.version,
            title: 'Untrusted input reaches a dynamic SQL sink',
            description: sqlInjectionRule.description,
            category: 'SECURITY',
            severity: 'HIGH',
            confidence: 'HIGH',
            repositoryId: activeFunction.repository_id,
            commitId: activeFunction.commit_id,
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
        } else if (queryVariable?.tainted && !queryVariable.dynamicSql) {
          diagnostics.push(`${filePath}:${index + 1}: tainted SQL argument is not a proven dynamic query`);
          partial = true;
        }
        index = statementEnd;
        continue;
      }
      if (sinkStartPattern.test(line) && parameterizedCallPattern.test(sinkStatement)) {
        const parameterizedMatch = parameterizedCallPattern.exec(sinkStatement);
        const sqlText = parameterizedMatch?.[2] ?? '';
        if (!statementLooksSql(sqlText) || !/(?:\?|%\w|\$\d+|:[A-Za-z_]\w*)/.test(sqlText)) {
          diagnostics.push(`${filePath}:${index + 1}: Python SQL sink arguments are outside the recognized parameterization subset`);
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
      } else if (taintedNames.length > 0 && /^\s*return\b/.test(line)) {
        diagnostics.push(`${filePath}:${index + 1}: Python return propagation is not supported for tainted values`);
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
    const hasRecognizedInput = lines.some((line) => inputPattern.test(line));
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
