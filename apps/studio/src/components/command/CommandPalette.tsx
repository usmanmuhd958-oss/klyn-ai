"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Search,
  X,
  FileCode2,
  Bot,
  LayoutDashboard,
  Terminal,
  Trash2,
  Wifi,
} from "lucide-react";

import {
  useStudioStore,
} from "@/store/useStudioStore";

import type {
  StudioCommand,
  WorkspaceView,
} from "@/types/studio";

interface PaletteCommand {
  id: string;
  name: string;
  description: string;
  category:
    | "workspace"
    | "agent"
    | "navigation"
    | "system";
  icon: React.ReactNode;
  execute: () => void;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const {
    commands,
    setView,
    clearTimeline,
    connectRuntime,
  } = useStudioStore();

  useEffect(() => {
    const handler = () => {
      setOpen(true);
    };

    window.addEventListener(
      "klyn:open-command-palette",
      handler
    );

    return () => {
      window.removeEventListener(
        "klyn:open-command-palette",
        handler
      );
    };
  }, []);

  useEffect(() => {
    const keyboardHandler = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setOpen(true);
      }

      if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };

    window.addEventListener(
      "keydown",
      keyboardHandler
    );

    return () => {
      window.removeEventListener(
        "keydown",
        keyboardHandler
      );
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  const executeView = (view: WorkspaceView) => {
    setView(view);
    setOpen(false);
  };

  const defaultCommands: PaletteCommand[] = [
    {
      id: "open-file",
      name: "Open File",
      description: "Search and open workspace files",
      category: "workspace",
      icon: <FileCode2 size={16} />,
      execute() {
        setOpen(false);
      },
    },
    {
      id: "ask-architect",
      name: "Ask Architect Agent",
      description: "Delegate architecture planning task",
      category: "agent",
      icon: <Bot size={16} />,
      execute() {
        window.dispatchEvent(
          new CustomEvent("klyn:delegate-agent", {
            detail: { agent: "architect" },
          })
        );
        setOpen(false);
      },
    },
    {
      id: "refactor-file",
      name: "Refactor Current File",
      description: "Generate AI mutation proposal",
      category: "agent",
      icon: <Bot size={16} />,
      execute() {
        window.dispatchEvent(
          new CustomEvent("klyn:agent-task", {
            detail: { task: "refactor-current-file" },
          })
        );
        setOpen(false);
      },
    },
    {
      id: "editor-view",
      name: "Switch To Editor",
      description: "Open code workspace",
      category: "navigation",
      icon: <LayoutDashboard size={16} />,
      execute() {
        executeView("editor");
      },
    },
    {
      id: "orchestra-view",
      name: "Open Agent Orchestra",
      description: "View autonomous agents",
      category: "navigation",
      icon: <Bot size={16} />,
      execute() {
        executeView("orchestra");
      },
    },
    {
      id: "timeline-view",
      name: "Open Execution Timeline",
      description: "Inspect runtime traces",
      category: "navigation",
      icon: <Terminal size={16} />,
      execute() {
        executeView("timeline");
      },
    },
    {
      id: "clear-timeline",
      name: "Clear Timeline",
      description: "Remove execution history",
      category: "system",
      icon: <Trash2 size={16} />,
      execute() {
        clearTimeline();
        setOpen(false);
      },
    },
    {
      id: "connect-runtime",
      name: "Connect Runtime",
      description: "Start WebSocket runtime stream",
      category: "system",
      icon: <Wifi size={16} />,
      execute() {
        connectRuntime("ws://localhost:3001");
        setOpen(false);
      },
    },
  ];

  const allCommands = useMemo(() => {
    const custom: PaletteCommand[] = commands.map(
      (command: StudioCommand) => ({
        id: command.id,
        name: command.name,
        description: command.description ?? "",
        category: command.category,
        icon: <Terminal size={16} />,
        execute: command.execute,
      })
    );

    return [...defaultCommands, ...custom];
  }, [commands]);

  const filteredCommands = useMemo(() => {
    const value = query.toLowerCase();

    if (!value) return allCommands;

    return allCommands.filter(
      (command) =>
        command.name.toLowerCase().includes(value) ||
        command.description.toLowerCase().includes(value) ||
        command.category.includes(value)
    );
  }, [query, allCommands]);

  const executeSelected = () => {
    const command = filteredCommands[selectedIndex];

    if (command) {
      command.execute();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40">
      <div className="w-[min(600px,90vw)] overflow-hidden rounded-xl border border-[#27272a] bg-[#09090b]/80 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[#27272a] px-4">
          <Search size={18} className="text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  Math.min(index + 1, filteredCommands.length - 1)
                );
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  Math.max(index - 1, 0)
                );
              }

              if (event.key === "Enter") {
                executeSelected();
              }

              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Ask Klyn anything..."
            className="h-14 flex-1 bg-transparent text-sm text-white outline-none"
          />
          <button onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto p-2">
          {filteredCommands.map((command, index) => (
            <button
              key={command.id}
              onClick={command.execute}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ${
                selectedIndex === index ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <div className="text-blue-400">{command.icon}</div>
              <div>
                <p className="text-sm text-white">{command.name}</p>
                <p className="text-xs text-zinc-500">{command.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
