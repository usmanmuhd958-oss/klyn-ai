import { create } from "zustand";
import {
  StudioState,
  WorkspaceFile,
  ExecutionEvent,
  StudioAgent,
  WorkspaceView,
  StudioCommand
} from "@/types/studio";

interface StudioActions {
  /**
   * Workspace
   */
  addFile(file: WorkspaceFile): void;
  updateFile(id: string, content: string): void;
  setActiveFile(id: string): void;

  /**
   * Agents
   */
  registerAgent(agent: StudioAgent): void;
  updateAgent(id: string, update: Partial<StudioAgent>): void;

  /**
   * Timeline
   */
  addExecutionEvent(event: ExecutionEvent): void;
  clearTimeline(): void;

  /**
   * Views
   */
  setView(view: WorkspaceView): void;

  /**
   * Runtime Connection
   */
  setConnection(state: boolean): void;

  /**
   * Commands
   */
  commands: StudioCommand[];
  registerCommand(command: StudioCommand): void;

  /**
   * Websocket bridge
   */
  connectRuntime(url: string): WebSocket | null;
}

type StudioStore = StudioState & StudioActions;

export const useStudioStore = create<StudioStore>((set, get) => ({
  /**
   * Initial State
   */
  files: [],
  tabs: [],
  timeline: [],
  currentView: "editor",
  connected: false,
  swarm: {
    agents: [],
    connections: []
  },
  commands: [],

  /**
   * File Operations
   */
  addFile(file) {
    set(state => ({
      files: [...state.files, file]
    }));
  },

  updateFile(id, content) {
    set(state => ({
      files: state.files.map(file =>
        file.id === id
          ? {
              ...file,
              content,
              modified: true,
              updatedAt: Date.now()
            }
          : file
      )
    }));
  },

  setActiveFile(id) {
    set({
      activeFileId: id
    });
  },

  /**
   * Agent Runtime
   */
  registerAgent(agent) {
    set(state => ({
      swarm: {
        ...state.swarm,
        agents: [...state.swarm.agents, agent]
      }
    }));
  },

  updateAgent(id, update) {
    set(state => ({
      swarm: {
        ...state.swarm,
        agents: state.swarm.agents.map(agent =>
          agent.id === id
            ? {
                ...agent,
                ...update
              }
            : agent
        )
      }
    }));
  },

  /**
   * Timeline
   */
  addExecutionEvent(event) {
    set(state => ({
      timeline: [...state.timeline, event]
    }));
  },

  clearTimeline() {
    set({
      timeline: []
    });
  },

  /**
   * UI
   */
  setView(view) {
    set({
      currentView: view
    });
  },

  setConnection(state) {
    set({
      connected: state
    });
  },

  /**
   * Commands
   */
  registerCommand(command) {
    set(state => ({
      commands: [...state.commands, command]
    }));
  },

  /**
   * WebSocket Runtime Stream
   */
  connectRuntime(url) {
    try {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        get().setConnection(true);
      };

      socket.onclose = () => {
        get().setConnection(false);
      };

      socket.onerror = () => {
        get().setConnection(false);
      };

      socket.onmessage = message => {
        try {
          const data = JSON.parse(message.data);

          if (data.type === "execution") {
            get().addExecutionEvent(data.payload);
          }

          if (data.type === "agent") {
            get().updateAgent(data.payload.id, data.payload);
          }
        } catch (error) {
          console.error("Klyn runtime event error", error);
        }
      };

      return socket;
    } catch (error) {
      console.error("Klyn websocket connection failed", error);
      return null;
    }
  }
}));
