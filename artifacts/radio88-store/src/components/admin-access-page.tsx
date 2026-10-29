import { userFacingError } from '@/lib/user-facing-errors';
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminCapabilitiesQueryKey,
  getListAdminPermissionsQueryKey,
  getListAdminRolesQueryKey,
  getListAdminUsersQueryKey,
  getListAuditEventsQueryKey,
  useCreateAdminRole,
  useListAdminPermissions,
  useListAdminRoles,
  useListAdminUsers,
  useListAuditEvents,
  useUpdateAdminRole,
  useUpdateAdminUserRoles,
} from "@workspace/api-client-react";
import type { AdminPermission, AdminRole, AuditEvent, StoreUser } from "@workspace/api-client-react";
import { Activity, Clock3, Plus, ShieldCheck, UserRound } from "lucide-react";
import { AdminActivity } from "@/components/admin-activity";
import { useCan } from "@/components/admin-permissions";
import { ErrorState, Loading, Notice } from "@/components/feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RoleDraft = {
  id?: string;
  slug: string;
  name: string;
  description: string;
  active: boolean;
  permissionKeys: string[];
};

const emptyRole: RoleDraft = { slug: "", name: "", description: "", active: true, permissionKeys: [] };
const protectedKeys = new Set(["users:manage", "roles:manage"]);
const resourceLabels: Record<string, string> = {
  audit: "Atividade administrativa",
  categories: "Categorias",
  content: "Conteúdo da vitrine",
  fiscal: "Notas fiscais",
  inventory: "Estoque",
  orders: "Pedidos",
  payments: "Pagamentos",
  product_lines: "Linhas de produtos",
  products: "Produtos",
  roles: "Funções e permissões",
  shipping: "Frete e envios",
  users: "Pessoas e acessos",
};
const shortDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
const errorText = userFacingError;

function groupPermissions(permissionKeys: string[], permissions: AdminPermission[]) {
  const byKey = new Map(permissions.map((permission) => [permission.key, permission]));
  const groups = new Map<string, { key: string; description: string }[]>();
  for (const key of permissionKeys) {
    const permission = byKey.get(key);
    const resource = permission?.resource ?? key.split(":")[0] ?? "other";
    const description = permission?.description ?? "Permissão do sistema";
    groups.set(resource, [...(groups.get(resource) ?? []), { key, description }]);
  }
  return [...groups.entries()].sort(([left], [right]) =>
    (resourceLabels[left] ?? left).localeCompare(resourceLabels[right] ?? right, "pt-BR"),
  );
}

function AccessAssignments({
  users,
  roles,
  canManage,
  onChanged,
}: {
  users: StoreUser[];
  roles: AdminRole[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const update = useUpdateAdminUserRoles();
  const [editingUser, setEditingUser] = useState<StoreUser | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const availableRoles = roles.filter((role) => role.active);
  const currentRoleIds = editingUser?.roles.filter((role) => role.active).map((role) => role.id) ?? [];
  const changed = JSON.stringify([...selectedRoleIds].sort()) !== JSON.stringify([...currentRoleIds].sort());
  const hasInactiveRoles = editingUser?.roles.some((role) => !role.active) ?? false;

  const openEditor = (user: StoreUser) => {
    setError("");
    setSelectedRoleIds(user.roles.filter((role) => role.active).map((role) => role.id));
    setEditingUser(user);
  };
  const closeEditor = () => {
    if (update.isPending) return;
    setEditingUser(null);
    setSelectedRoleIds([]);
    setError("");
  };
  const save = () => {
    if (!editingUser || !changed) return;
    setError("");
    update.mutate({ userId: editingUser.userId, data: { roleIds: selectedRoleIds } }, {
      onSuccess: () => {
        setEditingUser(null);
        setSelectedRoleIds([]);
        onChanged();
      },
      onError: (cause) => setError(errorText(cause)),
    });
  };

  return <>
    <section className="admin-access-section" aria-labelledby="accounts-title">
      <div className="admin-access-section-heading">
        <div>
          <h2 id="accounts-title" className="display">Contas da loja</h2>
          <p>Consulte as contas e as funções que determinam seus acessos administrativos.</p>
        </div>
        <span className="admin-section-count">{users.length} {users.length === 1 ? "conta" : "contas"}</span>
      </div>
      {!users.length ? <p className="admin-empty-state">Nenhuma conta encontrada.</p> :
        <div className="admin-access-user-list">{users.map((user) => {
          const activeRoles = user.roles.filter((role) => role.active);
          const inactiveRoles = user.roles.filter((role) => !role.active);
          return <article key={user.userId} className="admin-access-user-card">
            <div className="admin-access-user-details">
              <div className="admin-access-user-identity">
                <span className="admin-access-user-icon" aria-hidden="true"><UserRound size={18} /></span>
                <div className="min-w-0">
                  <h3>{user.fullName || "Sem nome"}</h3>
                  <p>{user.email}</p>
                  <small>Conta criada em {shortDate(user.createdAt)}</small>
                </div>
              </div>
              <div className="admin-access-role-summary" aria-label="Funções atuais">
                <span className="admin-access-label">Funções</span>
                <div className="admin-access-role-chips">
                  {activeRoles.map((role) => <span key={role.id} className="admin-access-role-chip">{role.name}</span>)}
                  {inactiveRoles.map((role) => <span key={role.id} className="admin-access-role-chip is-inactive">{role.name} · desativada</span>)}
                  {!user.roles.length && <span className="admin-access-no-role">Sem função atribuída</span>}
                </div>
              </div>
              {canManage && <button type="button" className="button button-outline admin-access-edit-button" onClick={() => openEditor(user)}>
                Ajustar funções
              </button>}
            </div>
          </article>;
        })}</div>}
      {!canManage && <p className="admin-access-readonly-note">Seu perfil pode consultar contas, mas não alterar funções de acesso.</p>}
    </section>

    <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) closeEditor(); }}>
      <DialogContent className="admin-access-dialog" data-testid="dialog-user-roles">
        <DialogHeader className="admin-access-dialog-header">
          <DialogTitle className="display">Ajustar funções da conta</DialogTitle>
          <DialogDescription>{editingUser?.fullName || editingUser?.email} · Marque as funções que devem definir os acessos desta conta.</DialogDescription>
        </DialogHeader>
        <div className="admin-access-dialog-body">
          {availableRoles.length ? <div className="admin-role-choice-list">
            {availableRoles.map((role) => <label key={role.id} className={`admin-role-choice${selectedRoleIds.includes(role.id) ? " is-selected" : ""}`}>
              <input type="checkbox" checked={selectedRoleIds.includes(role.id)} onChange={(event) => setSelectedRoleIds((current) =>
                event.target.checked ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id),
              )} />
              <span><b>{role.name}</b><small>{role.description || `${role.permissionKeys.length} permissões disponíveis`}</small></span>
            </label>)}
          </div> : <p className="admin-empty-state">Não há funções ativas para atribuir.</p>}
          {hasInactiveRoles && <p className="admin-inline-warning">Esta conta possui função desativada. Ao salvar, as funções desativadas serão removidas da atribuição.</p>}
          {error && <div className="mt-4"><Notice text={error} /></div>}
        </div>
        <DialogFooter className="admin-access-dialog-footer">
          <button type="button" className="button button-outline" onClick={closeEditor} disabled={update.isPending}>Cancelar</button>
          <button type="button" className="button" disabled={!changed || update.isPending} onClick={save}>
            {update.isPending ? "Salvando…" : "Salvar acessos"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function RoleEditor({
  draft,
  permissions,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: RoleDraft;
  permissions: AdminPermission[];
  busy: boolean;
  error: string;
  onChange: (draft: RoleDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const grouped = useMemo(() => groupPermissions(
    permissions.filter((item) => !protectedKeys.has(item.key)).map((item) => item.key),
    permissions,
  ), [permissions]);
  const togglePermission = (key: string, enabled: boolean) => onChange({
    ...draft,
    permissionKeys: enabled
      ? [...new Set([...draft.permissionKeys, key])]
      : draft.permissionKeys.filter((permission) => permission !== key),
  });
  const canSave = draft.name.trim().length >= 2 && draft.permissionKeys.length > 0 && (draft.id || draft.slug.length >= 2);

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="admin-access-dialog admin-role-dialog" data-testid="admin-role-editor">
      <DialogHeader className="admin-access-dialog-header">
        <DialogTitle className="display">{draft.id ? "Editar função" : "Nova função"}</DialogTitle>
        <DialogDescription>Escolha um nome e defina as permissões por área. A gestão de pessoas e de funções continua exclusiva do administrador.</DialogDescription>
      </DialogHeader>
      <div className="admin-access-dialog-body">
        <div className="admin-role-fields">
          {!draft.id && <label htmlFor="admin-role-slug">Identificador<input id="admin-role-slug" className="field" value={draft.slug} onChange={(event) => onChange({ ...draft, slug: event.target.value.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9-]+/g, "-") })} placeholder="ex.: gerente-de-loja" maxLength={60} /></label>}
          <label htmlFor="admin-role-name">Nome da função<input id="admin-role-name" className="field" autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} maxLength={80} /></label>
          <label className="admin-role-description" htmlFor="admin-role-description">Descrição<textarea id="admin-role-description" className="field" rows={2} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} maxLength={500} /></label>
        </div>
        {draft.id && <label className="admin-role-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => onChange({ ...draft, active: event.target.checked })} />Função ativa</label>}
        <div className="admin-permission-heading">
          <div><h3>Permissões por área</h3><p>Selecione somente o que a função precisa para sua rotina.</p></div>
          <span>{draft.permissionKeys.length} selecionadas</span>
        </div>
        <div className="admin-permission-groups">
          {grouped.map(([resource, items]) => <fieldset key={resource} className="admin-permission-group">
            <legend>{resourceLabels[resource] ?? resource} <span>{items.length}</span></legend>
            <div className="admin-permission-options">
              {items.map((permission) => <label key={permission.key} className={`admin-permission-option${draft.permissionKeys.includes(permission.key) ? " is-selected" : ""}`}>
                <input type="checkbox" checked={draft.permissionKeys.includes(permission.key)} onChange={(event) => togglePermission(permission.key, event.target.checked)} />
                <span>{permission.description}</span>
              </label>)}
            </div>
          </fieldset>)}
        </div>
        {error && <div className="mt-4"><Notice text={error} /></div>}
      </div>
      <DialogFooter className="admin-access-dialog-footer">
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="button" disabled={!canSave || busy} onClick={onSave}>{busy ? "Salvando…" : "Salvar função"}</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function RoleManagement({
  roles,
  permissions,
  canManage,
  onChanged,
}: {
  roles: AdminRole[];
  permissions: AdminPermission[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const create = useCreateAdminRole();
  const update = useUpdateAdminRole();
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [error, setError] = useState("");
  const busy = create.isPending || update.isPending;
  const save = () => {
    if (!draft) return;
    setError("");
    const callbacks = {
      onSuccess: () => { setDraft(null); onChanged(); },
      onError: (cause: unknown) => setError(errorText(cause)),
    };
    if (draft.id) {
      update.mutate({ roleId: draft.id, data: {
        name: draft.name.trim(),
        description: draft.description.trim(),
        active: draft.active,
        permissionKeys: draft.permissionKeys,
      } }, callbacks);
    } else {
      create.mutate({ data: {
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        permissionKeys: draft.permissionKeys,
      } }, callbacks);
    }
  };
  const openNewRole = () => {
    setError("");
    setDraft({ ...emptyRole, permissionKeys: [] });
  };
  const openEditRole = (role: AdminRole) => {
    setError("");
    setDraft({ id: role.id, slug: role.slug, name: role.name, description: role.description, active: role.active, permissionKeys: role.permissionKeys });
  };

  return <section className="admin-access-section" aria-labelledby="access-roles-title">
    <div className="admin-access-section-heading">
      <div>
        <h2 id="access-roles-title" className="display">Funções de acesso</h2>
        <p>Organize permissões por área e reutilize-as nas contas da equipe.</p>
      </div>
      <span className="admin-section-count">{roles.length} {roles.length === 1 ? "função" : "funções"}</span>
    </div>
    {canManage && <div className="admin-access-toolbar"><p>As funções padrão são mantidas pelo sistema. Crie uma função para necessidades específicas.</p><button type="button" className="button" onClick={openNewRole}><Plus size={16} />Criar função</button></div>}
    {!roles.length ? <p className="admin-empty-state">Nenhuma função encontrada.</p> :
      <div className="admin-role-grid">{roles.map((role) => {
        const grouped = groupPermissions(role.permissionKeys, permissions);
        return <article key={role.id} className={`admin-role-card${role.active ? "" : " is-inactive"}`}>
          <div className="admin-role-card-heading">
            <div className="min-w-0"><h3>{role.name}</h3><p>{role.description || "Sem descrição."}</p></div>
            <span className={`admin-role-status${role.active ? " is-active" : ""}`}>{role.isSystem ? "Padrão" : role.active ? "Ativa" : "Desativada"}</span>
          </div>
          <div className="admin-role-metrics"><span><b>{role.permissionKeys.length}</b> permissões</span><span><b>{role.assignedUserCount}</b> contas</span></div>
          <details className="admin-role-permissions">
            <summary>Ver permissões por área</summary>
            <div className="admin-role-permission-details">
              {grouped.map(([resource, items]) => <div key={resource}>
                <h4>{resourceLabels[resource] ?? resource}</h4>
                <ul>{items.map((permission) => <li key={permission.key}>{permission.description}</li>)}</ul>
              </div>)}
              {!role.permissionKeys.length && <p>Esta função não possui permissões atribuídas.</p>}
            </div>
          </details>
          {canManage && !role.isSystem && <button type="button" className="admin-role-edit" onClick={() => openEditRole(role)}>Editar função</button>}
        </article>;
      })}</div>}
    {!canManage && <p className="admin-access-readonly-note">Seu perfil pode consultar funções, mas não criar ou alterá-las.</p>}
    {draft && <RoleEditor draft={draft} permissions={permissions} busy={busy} error={error} onChange={setDraft} onClose={() => setDraft(null)} onSave={save} />}
  </section>;
}

export function AdminAccessPage() {
  const queryClient = useQueryClient();
  const canReadUsers = useCan("users:read");
  const canReadRoles = useCan("roles:read");
  const canManageUsers = useCan("users:manage");
  const canManageRoles = useCan("roles:manage");
  const canManageAssignments = canManageUsers && canManageRoles;
  const [selectedView, setSelectedView] = useState<"people" | "roles">("people");
  const users = useListAdminUsers({ query: { queryKey: getListAdminUsersQueryKey(), enabled: canReadUsers, retry: false } });
  const roles = useListAdminRoles({ query: { queryKey: getListAdminRolesQueryKey(), enabled: canReadRoles, retry: false } });
  const permissions = useListAdminPermissions({ query: { queryKey: getListAdminPermissionsQueryKey(), enabled: canReadRoles, retry: false } });
  const view = canReadUsers ? selectedView : "roles";
  const invalidateAccess = () => {
    for (const queryKey of [
      getListAdminUsersQueryKey(),
      getListAdminRolesQueryKey(),
      getListAdminPermissionsQueryKey(),
      getListAuditEventsQueryKey(),
      getGetAdminCapabilitiesQueryKey(),
    ]) void queryClient.invalidateQueries({ queryKey });
  };

  return <div className="admin-access-page">
    {canReadUsers && canReadRoles && <div className="admin-access-switch" aria-label="Área de gestão de acessos">
      <button type="button" aria-pressed={view === "people"} onClick={() => setSelectedView("people")}><UserRound size={16} />Pessoas</button>
      <button type="button" aria-pressed={view === "roles"} onClick={() => setSelectedView("roles")}><ShieldCheck size={16} />Funções e permissões</button>
    </div>}
    {view === "people" && canReadUsers && <>
      {users.isLoading ? <Loading /> : users.isError ? <ErrorState retry={() => users.refetch()} message="Não foi possível carregar as contas." /> :
        canManageAssignments && (roles.isLoading || permissions.isLoading) ? <Loading label="Carregando funções" /> :
          canManageAssignments && (roles.isError || permissions.isError) ? <ErrorState retry={() => { void roles.refetch(); void permissions.refetch(); }} message="Não foi possível carregar as funções disponíveis." /> :
            <AccessAssignments users={users.data ?? []} roles={roles.data ?? []} canManage={canManageAssignments} onChanged={invalidateAccess} />}
    </>}
    {view === "roles" && canReadRoles && <>
      {roles.isLoading || permissions.isLoading ? <Loading label="Carregando funções" /> :
        roles.isError || permissions.isError ? <ErrorState retry={() => { void roles.refetch(); void permissions.refetch(); }} message="Não foi possível carregar funções e permissões." /> :
          <RoleManagement roles={roles.data ?? []} permissions={permissions.data ?? []} canManage={canManageRoles} onChanged={invalidateAccess} />}
    </>}
  </div>;
}

export function AdminActivityPage() {
  const canReadAudit = useCan("audit:read");
  const audit = useListAuditEvents({ query: { queryKey: getListAuditEventsQueryKey(), enabled: canReadAudit, retry: false } });

  return <section className="admin-activity-page" aria-labelledby="admin-activity-title">
    <div className="admin-access-section-heading">
      <div className="admin-activity-heading">
        <span className="admin-activity-heading-icon" aria-hidden="true"><Activity size={19} /></span>
        <div><h2 id="admin-activity-title" className="display">Registro de atividades</h2><p>Alterações realizadas pela equipe na administração da loja.</p></div>
      </div>
      {!audit.isLoading && !audit.isError && <span className="admin-section-count">{audit.data?.length ?? 0} registros carregados</span>}
    </div>
    {audit.isLoading ? <Loading /> : audit.isError ? <ErrorState retry={() => audit.refetch()} message="O registro de atividade não está disponível para este perfil." /> :
      <AdminActivity events={(audit.data ?? []) as AuditEvent[]} />}
  </section>;
}
