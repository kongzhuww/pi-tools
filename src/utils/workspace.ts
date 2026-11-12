import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 动态嗅探当前 Pi 所属的工作区或项目名称：
 * 1. 优先从 Herdr 环境变量 + CLI 实时获取当前工作区的自定义名称
 * 2. 降级检测当前工作目录名 (CWD)
 * 3. 兜底返回默认 "Pi"
 */
export async function resolveWorkspaceTitle(): Promise<string> {
  const wsId = process.env.HERDR_WORKSPACE_ID;
  const herdrBin = process.env.HERDR_BIN_PATH || "herdr";

  if (wsId) {
    try {
      const { stdout } = await execFileAsync(herdrBin, ["workspace", "get", wsId], {
        timeout: 2000,
        windowsHide: true,
      });
      const data = JSON.parse(stdout);
      const label = data?.result?.workspace?.label;
      if (typeof label === "string" && label.trim()) {
        return `Pi · ${label.trim()}`;
      }
    } catch {
      return `Pi · [${wsId}]`;
    }
  }

  try {
    const cwd = process.cwd();
    const parts = cwd.split(/[/\\]/).filter(Boolean);
    const folder = parts.at(-1) || "终端";
    return `Pi · ${folder}`;
  } catch {
    return "Pi";
  }
}
