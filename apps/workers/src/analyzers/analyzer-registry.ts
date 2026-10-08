import type { Analyzer, AnalyzerTypeName, ScopeMode } from './types.js';

export class AnalyzerRegistry {
  private readonly analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): void {
    this.analyzers.set(analyzer.metadata.name, analyzer);
  }

  get(name: string): Analyzer | undefined {
    return this.analyzers.get(name);
  }

  list(): Analyzer[] {
    return Array.from(this.analyzers.values());
  }

  listMatching(language: string, requiredIR: string[], scope: ScopeMode, type?: AnalyzerTypeName): Analyzer[] {
    return this.list().filter((analyzer) => {
      if (type && analyzer.metadata.type !== type) {
        return false;
      }

      if (!analyzer.metadata.supportedLanguages.includes(language)) {
        return false;
      }

      if (requiredIR.length > 0 && !requiredIR.every((ir) => analyzer.metadata.requiredIR.includes(ir))) {
        return false;
      }

      if (!analyzer.metadata.supportedScopes.includes(scope)) {
        return false;
      }

      return true;
    });
  }
}

export const analyzerRegistry = new AnalyzerRegistry();
