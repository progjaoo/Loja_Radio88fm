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
import { Activity, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import { AdminActivity } from "@/components/admin-activity";
import { useCan } from "@/components/admin-permissions";
import { ErrorState, Loading, Notice } from "@/components/feedback";

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
const shortDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
const errorText = userFacingError;

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
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const availableRoles = roles.filter((role) => role.active);

  const selectedRoles = (user: StoreUser) =>
    drafts[user.userId] ?? user.roles.filter((role) => role.active).map((role) => role.id);
  const change = (user: StoreUser, roleId: string, checked: boolean) => {
    const current = selectedRoles(user);
    const next = checked ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
    setDrafts((all) => ({ ...all, [user.userId]: next }));
  };

  return <section className="mt-8" aria-labelledby="access-assignments-title">
    <div className="flex items-center gap-2"><UserRound size={19} /><h2 id="access-assignments-title" className="display text-2xl">Contas e funções</h2></div>
    {!users.length ? <p className="mt-3 rounded-[20px] border border-dashed p-6 text-sm text-muted-foreground">Nenhuma conta encontrada.</p> :
      <div className="mt-4 grid gap-3">{users.map((user) => {
        const selected = selectedRoles(user);
        const original = user.roles.filter((role) => role.active).map((role) => role.id).sort();
        const changed = JSON.stringify([...selected].sort()) !== JSON.stringify(original);
        const hasInactive = user.roles.some((role) => !role.active);
        return <article key={user.userId} className="rounded-[22px] border border-border/70 bg-card p-4 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-sm font-bold">{user.fullName || "Sem nome"}</h3><p className="mt-1 text-xs text-muted-foreground">{user.email} · desde {shortDate(user.createdAt)}</p></div>
            <div className="flex flex-wrap gap-1.5">{user.roles.filter((role) => role.active).map((role) =>
              <span key={role.id} className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{role.name}</span>,
            )}{!user.roles.some((role) => role.active) && <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Sem função ativa</span>}</div>
          </div>
          {canManage && <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-bold">Acesso por função</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {availableRoles.map((role) => <label key={role.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={selected.includes(role.id)} onChange={(event) => change(user, role.id, event.target.checked)} />
                {role.name}
              </label>)}
            </div>
            {hasInactive && <p className="mt-2 text-xs text-amber-700">Esta conta tem uma função desativada. Ao salvar, ela será removida da atribuição.</p>}
            <div className="mt-3 flex items-center gap-3">
              <button className="button py-2 text-xs" disabled={!changed || update.isPending} onClick={() => {
                setError("");
                update.mutate({ userId: user.userId, data: { roleIds: selected } }, {
                  onSuccess: () => { setDrafts((all) => { const next = { ...all }; delete next[user.userId]; return next; }); onChanged(); },
                  onError: (cause) => setError(errorText(cause)),
                });
              }}>{update.isPending ? "Salvando…" : "Salvar acessos"}</button>
              {changed && <button className="text-xs underline" onClick={() => setDrafts((all) => { const next = { ...all }; delete next[user.userId]; return next; })}>Descartar</button>}
            </div>
          </div>}
        </article>;
      })}</div>}
    {error && <div className="mt-3"><Notice text={error} /></div>}
    {!canManage && <p className="mt-3 text-xs text-muted-foreground">Seu perfil pode consultar contas, mas não alterar funções de acesso.</p>}
  </section>;
}

function RoleEditor({
  draft,
  permissions,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  draft: RoleDraft;
  permissions: AdminPermission[];
  busy: boolean;
  onChange: (draft: RoleDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, AdminPermission[]>();
    for (const permission of permissions.filter((item) => !protectedKeys.has(item.key))) {
      groups.set(permission.resource, [...(groups.get(permission.resource) ?? []), permission]);
    }
    return [...groups.entries()];
  }, [permissions]);
  const togglePermission = (key: string, enabled: boolean) => onChange({
    ...draft,
    permissionKeys: enabled
      ? [...new Set([...draft.permissionKeys, key])]
      : draft.permissionKeys.filter((permission) => permission !== key),
  });

  return <div className="mt-4 rounded-[22px] border border-foreground/20 bg-muted/40 p-4" data-testid="admin-role-editor">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-bold">{draft.id ? "Editar função" : "Nova função"}</h3><p className="mt-1 text-xs text-muted-foreground">As funções padrão não podem ser alteradas. A gestão de acessos administrativos permanece exclusiva do administrador.</p></div><button className="rounded-full p-2 hover:bg-muted" aria-label="Fechar editor de função" onClick={onClose}><X size={17} /></button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {!draft.id && <label className="text-xs font-bold">Identificador<input className="field mt-1.5" value={draft.slug} onChange={(event) => onChange({ ...draft, slug: event.target.value.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9-]+/g, "-") })} placeholder="ex.: gerente-de-loja" maxLength={60} /></label>}
      <label className="text-xs font-bold">Nome<input className="field mt-1.5" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} maxLength={80} /></label>
      <label className="text-xs font-bold sm:col-span-2">Descrição<textarea className="field mt-1.5" rows={2} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} maxLength={500} /></label>
    </div>
    {draft.id && <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.active} onChange={(event) => onChange({ ...draft, active: event.target.checked })} />Função ativa</label>}
    <fieldset className="mt-4 space-y-4">
      <legend className="mb-2 text-xs font-bold">Permissões da função</legend>
      {grouped.map(([resource, items]) => <div key={resource}>
        <h4 className="mb-2 text-xs font-semibold capitalize">{resource.replaceAll("_", " ")}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((permission) => <label key={permission.key} className="flex items-start gap-2 rounded-xl bg-card p-2.5 text-xs">
            <input type="checkbox" className="mt-0.5" checked={draft.permissionKeys.includes(permission.key)} onChange={(event) => togglePermission(permission.key, event.target.checked)} />
            <span><b className="block">{permission.description}</b><small className="text-muted-foreground">{permission.key}</small></span>
          </label>)}
        </div>
      </div>)}
    </fieldset>
    <div className="mt-4 flex flex-wrap gap-2">
      <button className="button" disabled={busy || draft.name.trim().length < 2 || draft.permissionKeys.length === 0 || (!draft.id && draft.slug.length < 2)} onClick={onSave}>{busy ? "Salvando…" : "Salvar função"}</button>
      <button className="button button-outline" onClick={onClose}>Cancelar</button>
    </div>
  </div>;
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

  return <section className="mt-9" aria-labelledby="access-roles-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck size={19} /><h2 id="access-roles-title" className="display text-2xl">Funções e permissões</h2></div><p className="mt-1 text-sm text-muted-foreground">Defina o que cada função pode consultar e alterar.</p></div>
      {canManage && <button className="button py-2.5 text-xs" onClick={() => { setError(""); setDraft({ ...emptyRole, permissionKeys: [] }); }}><Plus size={15} />Nova função</button>}
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-2">{roles.map((role) => <article key={role.id} className={`rounded-[22px] border bg-card p-4 shadow-soft ${role.active ? "border-border/70" : "border-dashed border-border opacity-70"}`}>
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold">{role.name}</h3><p className="mt-1 text-xs text-muted-foreground">{role.description || "Sem descrição."}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${role.active ? "bg-muted" : "bg-muted text-muted-foreground"}`}>{role.isSystem ? "Padrão" : role.active ? "Ativa" : "Desativada"}</span></div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{role.permissionKeys.length} permissões</span><span>·</span><span>{role.assignedUserCount} contas</span></div>
      <p className="mt-2 text-xs leading-5">{role.permissionKeys.map((key) => key.replace(":", " · ").replaceAll("_", " ")).join("  /  ") || "Sem permissões"}</p>
      {canManage && !role.isSystem && <button className="mt-3 text-xs font-bold underline" onClick={() => { setError(""); setDraft({ id: role.id, slug: role.slug, name: role.name, description: role.description, active: role.active, permissionKeys: role.permissionKeys }); }}>Editar função</button>}
    </article>)}</div>
    {draft && <RoleEditor draft={draft} permissions={permissions} busy={busy} onChange={setDraft} onClose={() => setDraft(null)} onSave={save} />}
    {error && <div className="mt-3"><Notice text={error} /></div>}
    {!canManage && <p className="mt-3 text-xs text-muted-foreground">Somente um administrador pode criar ou alterar funções.</p>}
  </section>;
}

export function AdminAccessPage() {
  const queryClient = useQueryClient();
  const canReadUsers = useCan("users:read");
  const canReadRoles = useCan("roles:read");
  const canManageUsers = useCan("users:manage");
  const canManageRoles = useCan("roles:manage");
  const canReadAudit = useCan("audit:read");
  const canManageAssignments = canManageUsers && canManageRoles;
  const users = useListAdminUsers({ query: { queryKey: getListAdminUsersQueryKey(), enabled: canReadUsers, retry: false } });
  const roles = useListAdminRoles({ query: { queryKey: getListAdminRolesQueryKey(), enabled: canReadRoles, retry: false } });
  const permissions = useListAdminPermissions({ query: { queryKey: getListAdminPermissionsQueryKey(), enabled: canReadRoles, retry: false } });
  const audit = useListAuditEvents({ query: { queryKey: getListAuditEventsQueryKey(), enabled: canReadAudit, retry: false } });
  const invalidateAccess = () => {
    for (const queryKey of [
      getListAdminUsersQueryKey(),
      getListAdminRolesQueryKey(),
      getListAdminPermissionsQueryKey(),
      getListAuditEventsQueryKey(),
      getGetAdminCapabilitiesQueryKey(),
    ]) void queryClient.invalidateQueries({ queryKey });
  };

  return <div className="space-y-8">
    {canReadUsers && <section aria-labelledby="accounts-title">
      <div className="flex items-center gap-2"><UserRound size={19} /><h2 id="accounts-title" className="display text-2xl">Contas da loja</h2></div>
      {users.isLoading ? <Loading /> : users.isError ? <ErrorState retry={() => users.refetch()} message="Não foi possível carregar as contas." /> :
        canReadRoles && (roles.isLoading || permissions.isLoading) ? <Loading label="Carregando funções" /> :
          canReadRoles && (roles.isError || permissions.isError) ? <ErrorState retry={() => { void roles.refetch(); void permissions.refetch(); }} message="Não foi possível carregar as funções e permissões." /> :
            <AccessAssignments users={users.data ?? []} roles={roles.data ?? []} canManage={canManageAssignments && canReadRoles} onChanged={invalidateAccess} />}
    </section>}
    {canReadRoles && <section>
      {roles.isLoading || permissions.isLoading ? <Loading label="Carregando funções" /> :
        roles.isError || permissions.isError ? <ErrorState retry={() => { void roles.refetch(); void permissions.refetch(); }} message="Não foi possível carregar funções e permissões." /> :
          <RoleManagement roles={roles.data ?? []} permissions={permissions.data ?? []} canManage={canManageRoles} onChanged={invalidateAccess} />}
    </section>}
    {canReadAudit && <section aria-labelledby="admin-activity-title">
      <div className="flex items-center gap-2"><Activity size={19} /><h2 id="admin-activity-title" className="display text-2xl">Atividade administrativa</h2></div>
      {audit.isLoading ? <Loading /> : audit.isError ? <ErrorState retry={() => audit.refetch()} message="O registro de atividade não está disponível para este perfil." /> : <AdminActivity events={(audit.data ?? []) as AuditEvent[]} />}
    </section>}
  </div>;
}
