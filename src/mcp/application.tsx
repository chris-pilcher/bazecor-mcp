import { useEffect, useLayoutEffect, useRef } from "react";
import { ipcRenderer } from "electron";
import { applicationSettings, updateApplicationSetting } from "./appSettings";
import { convertBackup, readBackup } from "./backups";
import { restoreConfiguration } from "./restore";
import { commandsFor } from "./deviceDraft";
import { version } from "../../package.json";
import { DeviceTools } from "../renderer/DeviceContext";
import type { State } from "../api/comms/Device";
import type Device from "../api/comms/Device";
import type { Dispatch } from "../renderer/DeviceContext";

const routes = {
  layout: "/editor",
  macros: "/macros",
  superkeys: "/superkeys",
  preferences: "/preferences",
  devices: "/device-manager",
};
interface Adapter {
  state: State;
  dispatch: Dispatch;
  dirty: boolean;
  navigate: (path: string) => void;
  onConnect: (device: Device) => Promise<void>;
  onDisconnect: () => void | Promise<void>;
  setLoading: (value: boolean) => void;
  reloadEditor: () => void;
  setTheme: (value: string) => Promise<void>;
}
export function useMcpApplication(adapter: Adapter) {
  const latest = useRef(adapter);
  useLayoutEffect(() => {
    latest.current = adapter;
  });
  useEffect(() => {
    const listener = async (
      _event: Electron.IpcRendererEvent,
      message: {
        id: number;
        command: {
          operation: string;
          editor?: keyof typeof routes;
          deviceId?: string;
          includePrivate?: boolean;
          backup?: unknown;
          name?: string;
          value?: unknown;
        };
      },
    ) => {
      try {
        const { current } = latest;
        const { command } = message;
        let result: unknown;
        if (command.operation === "app_settings") {
          result = await applicationSettings(current.state.currentDevice);
        } else if (command.operation === "telemetry") {
          const device = current.state.currentDevice;
          if (!device || device.isClosed) throw new Error("Connect a device first");
          const supported = commandsFor(device);
          const values: Record<string, unknown> = {};
          for (const query of [
            "version",
            "hardware.chip_id",
            "layer.state",
            "layer.current",
            "wireless.battery.left.level",
            "wireless.battery.right.level",
            "wireless.battery.left.status",
            "wireless.battery.right.status",
          ]) {
            if (supported.includes(query)) {
              // eslint-disable-next-line no-await-in-loop
              const value = await device.noCacheCommand(query);
              if (typeof value !== "string") throw new Error(`Could not read ${query}`);
              values[query] = value;
            }
          }
          result = {
            deviceId: device.serialNumber,
            values,
            commandDiscovery: supported.length ? "available" : "unavailable",
            observedAt: new Date().toISOString(),
            note: "Only advertised read-only queries were sent through the existing connection; active layer is unknown unless reported in values.",
          };
        } else if (command.operation === "backup_convert") {
          result = convertBackup(current.state.currentDevice, command.backup);
        } else if (command.operation === "backup_read" || command.operation === "backup_store") {
          result = await readBackup(
            current.state.currentDevice,
            command.includePrivate === true,
            command.operation === "backup_store",
          );
        } else if (command.operation === "devices") {
          result = {
            appVersion: version,
            mcpVersion: "0.2.1",
            connected: current.state.currentDevice?.serialNumber,
            devices: current.state.deviceList.map(device => ({
              id: device.serialNumber,
              chipId: device.device?.chipId,
              name: device.device?.info?.displayName || device.device?.info?.product,
              type: device.type,
              firmware: device.memoryMap.get("version") || null,
              commands: commandsFor(device),
              commandDiscovery: commandsFor(device).length ? "available" : "unavailable",
              connected: !device.isClosed,
            })),
            note: "Discovery uses the app's existing inventory. Open Device Manager for its normal discovery scan; MCP does not probe an active port independently.",
          };
        } else {
          if (current.dirty) throw new Error("Save or discard the current draft before changing editor or device");
          if (command.operation === "app_setting") {
            result = await updateApplicationSetting(
              command.name,
              command.value,
              current.state.currentDevice,
              current.setTheme,
            );
            if (current.state.currentDevice && !current.state.currentDevice.isClosed) current.reloadEditor();
            else current.navigate("/device-manager");
          } else if (command.operation === "navigate") {
            if (!command.editor || !routes[command.editor]) throw new Error("Unsupported editor");
            if (command.editor !== "devices" && (!current.state.currentDevice || current.state.currentDevice.isClosed))
              throw new Error("Connect a keyboard first");
            const requirements: Partial<Record<keyof typeof routes, string>> = {
              macros: "macros.map",
              superkeys: "superkeys.map",
            };
            const required = requirements[command.editor];
            if (required && !commandsFor(current.state.currentDevice).includes(required))
              throw new Error(`Firmware does not advertise ${required}`);
            current.navigate(routes[command.editor]);
            result = {
              requestedEditor: command.editor,
              note: "Read the new editor after loading; revisions are scoped to each view session.",
            };
          } else if (command.operation === "restore_backup") {
            if (current.state.currentDevice?.serialNumber !== command.deviceId)
              throw new Error("Active device changed. Read device inventory again.");
            current.setLoading(true);
            try {
              result = await restoreConfiguration(current.state.currentDevice, command.backup);
              current.reloadEditor();
            } catch (error) {
              current.state.currentDevice?.memoryMap.clear();
              throw new Error(`Restore did not complete. ${String(error)}`);
            } finally {
              current.setLoading(false);
            }
          } else if (command.operation === "connect") {
            if (current.state.currentDevice && !current.state.currentDevice.isClosed)
              throw new Error("Disconnect the current keyboard explicitly first");
            const matches = current.state.deviceList.filter(device => device.serialNumber === command.deviceId);
            if (matches.length !== 1) throw new Error("Unknown or ambiguous device ID. Read devices again.");
            const device = await DeviceTools.connect(matches[0]);
            if (!device) throw new Error("Connection failed");
            current.dispatch({
              type: "changeCurrent",
              payload: { selected: current.state.deviceList.indexOf(matches[0]), device },
            });
            await current.onConnect(device);
            result = { connected: device.serialNumber };
          } else if (command.operation === "disconnect") {
            if (!(await DeviceTools.disconnect(current.state.currentDevice))) throw new Error("Disconnect failed");
            await current.onDisconnect();
            result = { connected: false };
          } else throw new Error("Unsupported application command");
        }
        ipcRenderer.send("mcp:result", { id: message.id, result });
      } catch (error) {
        ipcRenderer.send("mcp:result", { id: message.id, error: (error as Error).message });
      }
    };
    ipcRenderer.on("mcp:application", listener);
    return () => {
      ipcRenderer.removeListener("mcp:application", listener);
    };
  }, []);
}
