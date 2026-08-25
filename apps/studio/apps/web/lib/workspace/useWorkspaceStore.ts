import { create } from "zustand";

export type WorkspaceRole = "owner" | "admin" | "developer" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt?: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

interface WorkspaceState {
  activeWorkspace: Workspace | null;
  members: WorkspaceMember[];
  currentRole: WorkspaceRole | null;
  setWorkspace: (workspace: Workspace) => void;
  setMembers: (members: WorkspaceMember[]) => void;
  setRole: (role: WorkspaceRole) => void;
  clearWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspace: null,
  members: [],
  currentRole: null,

  setWorkspace: (workspace) =>
    set({
      activeWorkspace: workspace,
    }),

  setMembers: (members) =>
    set({
      members,
    }),

  setRole: (role) =>
    set({
      currentRole: role,
    }),

  clearWorkspace: () =>
    set({
      activeWorkspace: null,
      members: [],
      currentRole: null,
    }),
}));
