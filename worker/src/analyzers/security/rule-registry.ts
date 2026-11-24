import { sqlInjectionRule, type SecurityRuleMetadata } from './rules/sql-injection.js';

export class SecurityRuleRegistry {
  private readonly rules = new Map<string, SecurityRuleMetadata>();

  register(rule: SecurityRuleMetadata): void {
    this.rules.set(rule.id, rule);
  }

  get(ruleId: string): SecurityRuleMetadata | undefined {
    return this.rules.get(ruleId);
  }

  list(): SecurityRuleMetadata[] {
    return Array.from(this.rules.values());
  }
}

export const securityRuleRegistry = new SecurityRuleRegistry();
securityRuleRegistry.register(sqlInjectionRule);
