import {
  createMovementsTool,
  deleteMovementTool,
  updateMovementTool,
  type MovementsCtx,
} from "./movements";
import {
  getBalanceTool,
  getSpendByCategoryTool,
  listCategoriesTool,
  listRecentTool,
  listWalletsTool,
  searchTransactionsTool,
  type ReadCtx,
} from "./reads";
import { runReadonlySqlTool, type EscapeCtx } from "./escape";

export type AgentToolsCtx = MovementsCtx & ReadCtx & EscapeCtx;

export function buildTools(ctx: AgentToolsCtx) {
  return {
    create_movements: createMovementsTool(ctx),
    update_movement: updateMovementTool(ctx),
    delete_movement: deleteMovementTool(ctx),
    get_balance: getBalanceTool(ctx),
    list_recent: listRecentTool(ctx),
    list_wallets: listWalletsTool(ctx),
    list_categories: listCategoriesTool(ctx),
    search_transactions: searchTransactionsTool(ctx),
    get_spend_by_category: getSpendByCategoryTool(ctx),
    run_readonly_sql: runReadonlySqlTool(ctx),
  };
}
