"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase/client";
import { useWorkspaceStore } from "./useWorkspaceStore";

interface WorkspaceContextValue {
  loading: boolean;
  refreshWorkspace: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined
);

interface ProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: ProviderProps) {
  const [loading, setLoading] = useState(true);

  const setWorkspace = useWorkspaceStore((state) => state.setWorkspace);
  const setMembers = useWorkspaceStore((state) => state.setMembers);
  const setRole = useWorkspaceStore((state) => state.setRole);

  async function refreshWorkspace() {
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const { data: member } = await supabase
        .from("workspace_members")
        .select(
          `
          *,
          workspaces(*)
        `
        )
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (member?.workspaces) {
        setWorkspace({
          id: member.workspaces.id,
          name: member.workspaces.name,
          ownerId: member.workspaces.owner_id,
        });

        setRole(member.role);

        const { data: members } = await supabase
          .from("workspace_members")
          .select("*")
          .eq("workspace_id", member.workspace_id);

        setMembers(members ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshWorkspace();
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        loading,
        refreshWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error(
      "useWorkspace must be used inside WorkspaceProvider"
    );
  }

  return context;
}
