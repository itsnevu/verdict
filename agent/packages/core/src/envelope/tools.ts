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
  verdict_read_contract: { cost: 0.5, write: false },
  verdict_decode_tx: { cost: 0.5, write: false },
  verdict_wallet_holdings: { cost: 1, write: false },
  verdict_wallet_score: { cost: 3, write: false },
  verdict_wallet_approvals: { cost: 1, write: false },
  verdict_prepare_revoke: { cost: 1, write: false },
  verdict_simulate_tx: { cost: 0.5, write: false },
  verdict_lint_solidity: { cost: 0.2, write: false },
  verdict_check_policy: { cost: 0.5, write: false },
  verdict_track_record: { cost: 0, write: false },
  verdict_wash_check: { cost: 1, write: false },
  verdict_lp_status: { cost: 1, write: false },
  verdict_deployer_history: { cost: 1, write: false },
  verdict_trace_funding: { cost: 1, write: false },
  verdict_label_address: { cost: 0.2, write: false },
  verdict_wallet_moves: { cost: 1, write: false },
  verdict_wallet_pnl: { cost: 2, write: false },
  verdict_prepare_swap: { cost: 1, write: false },
  verdict_bridge_check: { cost: 1, write: false },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];
export const isTool = (n: string): n is ToolName => n in TOOLS;
