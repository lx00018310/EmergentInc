import { ToolRegistry } from "../registry.js";
import {
  saveArtifactDefinition,
  handleSaveArtifact,
  readArtifactDefinition,
  handleReadArtifact,
  listArtifactsDefinition,
  handleListArtifacts,
  transferArtifactDefinition,
  handleTransferArtifact,
} from "./artifacts.js";
import {
  listPrivateFilesDefinition,
  handleListPrivateFiles,
  readPrivateFileDefinition,
  handleReadPrivateFile,
  inspectPrivateImageDefinition,
  handleInspectPrivateImage,
} from "./private_files.js";
import {
  vpsExecDefinition,
  handleVpsExec,
  vpsListFilesDefinition,
  handleVpsListFiles,
  vpsReadFileDefinition,
  handleVpsReadFile,
  vpsWriteFileDefinition,
  handleVpsWriteFile,
  vpsUploadFileDefinition,
  handleVpsUploadFile,
  vpsDownloadFileDefinition,
  handleVpsDownloadFile,
} from "./vps.js";

export const BUILTIN_DEFINITIONS = [
  saveArtifactDefinition,
  readArtifactDefinition,
  listArtifactsDefinition,
  transferArtifactDefinition,
  listPrivateFilesDefinition,
  readPrivateFileDefinition,
  inspectPrivateImageDefinition,
  vpsExecDefinition,
  vpsListFilesDefinition,
  vpsReadFileDefinition,
  vpsWriteFileDefinition,
  vpsUploadFileDefinition,
  vpsDownloadFileDefinition,
];

export function registerAllBuiltinTools(
  registry: ToolRegistry,
  configOverrides?: Record<string, { enabled?: boolean; timeout_seconds?: number }>,
  availability: { vpsListFilesAvailable?: boolean; vpsAvailableTools?: string[] } = {}
): void {
  const tools = [
    { def: saveArtifactDefinition, handler: handleSaveArtifact },
    { def: readArtifactDefinition, handler: handleReadArtifact },
    { def: listArtifactsDefinition, handler: handleListArtifacts },
    { def: transferArtifactDefinition, handler: handleTransferArtifact },
    { def: listPrivateFilesDefinition, handler: handleListPrivateFiles },
    { def: readPrivateFileDefinition, handler: handleReadPrivateFile },
    { def: inspectPrivateImageDefinition, handler: handleInspectPrivateImage },
    { def: vpsExecDefinition, handler: handleVpsExec },
    { def: vpsListFilesDefinition, handler: handleVpsListFiles },
    { def: vpsReadFileDefinition, handler: handleVpsReadFile },
    { def: vpsWriteFileDefinition, handler: handleVpsWriteFile },
    { def: vpsUploadFileDefinition, handler: handleVpsUploadFile },
    { def: vpsDownloadFileDefinition, handler: handleVpsDownloadFile },
  ];

  const availableVpsTools = new Set(
    availability.vpsAvailableTools ?? (availability.vpsListFilesAvailable ? ["vps_list_files"] : [])
  );

  for (const { def, handler } of tools) {
    // Config cannot enable an adapter whose prerequisites the caller has not verified.
    // Availability comes from probeVpsAvailability(), which is a purely local static check.
    if (def.name.startsWith("vps_") && !availableVpsTools.has(def.name)) continue;
    const overridden = { ...def };
    if (configOverrides && configOverrides[def.name]) {
      const cfg = configOverrides[def.name];
      if (typeof cfg.enabled === "boolean") {
        overridden.enabled = cfg.enabled;
      }
      if (typeof cfg.timeout_seconds === "number") {
        overridden.timeout_seconds = cfg.timeout_seconds;
      }
    }
    registry.register(overridden, handler);
  }
}
