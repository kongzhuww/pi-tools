import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadMeshConfig } from "./config.js";
import { SshEngine } from "./ssh-engine.js";
import { registerMeshTools } from "./tool-registry.js";
import { registerMeshCommands } from "./commands.js";

export * from "./types.js";
export * from "./config.js";
export * from "./ssh-engine.js";
export * from "./tool-registry.js";
export * from "./commands.js";

export default function (pi: ExtensionAPI) {
  const { config, loadedFrom } = loadMeshConfig();
  const engine = new SshEngine(config.devices);

  const { handleControl } = registerMeshTools(pi, config, engine);
  registerMeshCommands(pi, config, loadedFrom, engine, handleControl);
}
