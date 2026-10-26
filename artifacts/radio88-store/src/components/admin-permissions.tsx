import { createContext, useContext, useMemo, type ReactNode } from "react";

const AdminPermissionsContext = createContext<ReadonlySet<string>>(new Set());

export function AdminPermissionsProvider({
  permissions,
  children,
}: {
  permissions: string[];
  children: ReactNode;
}) {
  const value = useMemo(() => new Set(permissions), [permissions]);
  return <AdminPermissionsContext.Provider value={value}>{children}</AdminPermissionsContext.Provider>;
}

export function useAdminPermissions() {
  return useContext(AdminPermissionsContext);
}

export function useCan(permission: string) {
  return useAdminPermissions().has(permission);
}

export function useCanAll(...permissions: string[]) {
  const granted = useAdminPermissions();
  return permissions.every((permission) => granted.has(permission));
}

export function useCanAny(...permissions: string[]) {
  const granted = useAdminPermissions();
  return permissions.some((permission) => granted.has(permission));
}
