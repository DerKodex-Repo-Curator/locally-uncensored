import type { ToolRegistry } from './tool-registry'
import { COMPUTER_USE_TOOL, executeComputerUse } from '../computer-use'
import { COMPUTER_TASK_TOOL, executeComputerTask } from '../computer-task'

/** Put the computer control tools into the catalog, or take them out. */
export function syncComputerUseTool(registry: ToolRegistry, enabled: boolean): void {
  if (enabled) {
    registry.registerBuiltin(COMPUTER_USE_TOOL, executeComputerUse)
    registry.registerBuiltin(COMPUTER_TASK_TOOL, executeComputerTask)
  } else {
    registry.withdrawBuiltin(COMPUTER_USE_TOOL.name)
    registry.withdrawBuiltin(COMPUTER_TASK_TOOL.name)
  }
}
