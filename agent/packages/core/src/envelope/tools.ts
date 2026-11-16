/** Single source of truth for tool names and their cost. nextActions may only reference these. */
export const TOOLS = {
  verdict_scan_token: { cost: 1, write: false },
  verdict_agent_brief: { cost: 0.2, write: false },
  verdict_list_runners: { cost: 0.5, write: false },
  verdict_token_history: { cost: 0.5, write: false },
  verdict_explain_score: { cost: 0.5, write: false },
  verdict_compare_tokens: { cost: 1, write: false }, // per address
  verdict_budget: { cost: 0, write: false },
  verdict_registry_search: { cost: 0.2, write: false },
  verdict_registry_check: { cost: 1, write: false },
  verdict_watch_token: { cost: 1, write: true, scope: 'watch' },
  verdict_register_mcp: { cost: 1, write: true, scope: 'registry' },
  verdict_attest_token: { cost: 2, write: true, scope: 'attest' },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];
export const isTool = (n: string): n is ToolName => n in TOOLS;
