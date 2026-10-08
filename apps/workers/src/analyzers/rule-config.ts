export const structuralQualityRuleDefaults = {
  LONG_FUNCTION_LINES: 100,
  HIGH_PARAMETER_COUNT: 7,
  HIGH_FAN_OUT: 15,
  HIGH_FAN_IN: 20,
  MAX_NESTING_DEPTH: 5,
  EMPTY_FUNCTION_MAX_LINES: 3,
} as const;

export type StructuralQualityRuleConfig = typeof structuralQualityRuleDefaults;

export function resolveStructuralQualityConfig(overrides?: Partial<StructuralQualityRuleConfig>): StructuralQualityRuleConfig {
  return {
    LONG_FUNCTION_LINES: overrides?.LONG_FUNCTION_LINES ?? structuralQualityRuleDefaults.LONG_FUNCTION_LINES,
    HIGH_PARAMETER_COUNT: overrides?.HIGH_PARAMETER_COUNT ?? structuralQualityRuleDefaults.HIGH_PARAMETER_COUNT,
    HIGH_FAN_OUT: overrides?.HIGH_FAN_OUT ?? structuralQualityRuleDefaults.HIGH_FAN_OUT,
    HIGH_FAN_IN: overrides?.HIGH_FAN_IN ?? structuralQualityRuleDefaults.HIGH_FAN_IN,
    MAX_NESTING_DEPTH: overrides?.MAX_NESTING_DEPTH ?? structuralQualityRuleDefaults.MAX_NESTING_DEPTH,
    EMPTY_FUNCTION_MAX_LINES: overrides?.EMPTY_FUNCTION_MAX_LINES ?? structuralQualityRuleDefaults.EMPTY_FUNCTION_MAX_LINES,
  };
}
