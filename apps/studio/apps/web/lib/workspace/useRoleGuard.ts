"use client";

import { useWorkspaceStore } from "./useWorkspaceStore";

export type Permission =
  | "workspace.manage"
  | "member.invite"
  | "project.create"
  | "artifact.write"
  | "artifact.read"
  | "billing.manage";

const rolePermissions: Record<string, Permission[]> = {
  owner: [
    "workspace.manage",
    "member.invite",
    "project.create",
    "artifact.write",
    "artifact.read",
    "billing.manage",
  ],
  admin: [
    "member.invite",
    "project.create",
    "artifact.write",
    "artifact.read",
    "billing.manage",
  ],
  developer: ["project.create", "artifact.write", "artifact.read"],
  viewer: ["artifact.read"],
};

export function useRoleGuard() {
  const role = useWorkspaceStore((state) => state.currentRole);

  function can(permission: Permission): boolean {
    if (!role) {
      return false;
    }

    return rolePermissions[role]?.includes(permission) ?? false;
  }

  function requireRole(allowedRoles: string[]): boolean {
    if (!role) {
      return false;
    }

    return allowedRoles.includes(role);
  }

  return {
    role,
    can,
    requireRole,
  };
}
