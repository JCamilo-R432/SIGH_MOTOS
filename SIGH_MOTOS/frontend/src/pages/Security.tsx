import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Edit, Shield, UserCheck, UserX, Activity, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { securityService } from '@/services/securityService'
import api from '@/services/api'
import type { User, AuditLog } from '@/types'
import { userSchema, userUpdateSchema, type UserInput, type UserUpdateInput } from '@/utils/validators'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDateTime, roleLabel } from '@/utils/formatters'
import { useAuthStore } from '@/store/authStore'

type ActiveTab = 'users' | 'audit'

export default function Security() {
  const { user: currentUser } = useAuthStore()
  const [activeTab, setActiveTab] = useState<ActiveTab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditTotalPages, setAuditTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [auditLoading, setAuditLoading] = useState(false)

  const [userModal, setUserModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [resetModal, setResetModal] = useState(false)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)

  const AUDIT_LIMIT = 30

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UserInput>({
    resolver: zodResolver(userSchema),
    defaultValues: { role: 'SELLER' },
  })

  const { register: regEdit, handleSubmit: handleEditSubmit, reset: resetEdit, formState: { errors: editErrors } } = useForm<UserUpdateInput>({
    resolver: zodResolver(userUpdateSchema),
  })

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await securityService.getUsers())
    } catch { /* handled */ } finally { setLoading(false) }
  }, [])

  const loadAudit = useCallback(async (p = auditPage) => {
    setAuditLoading(true)
    try {
      const res = await securityService.getAuditLogs({ page: p, limit: AUDIT_LIMIT })
      setAuditLogs(res.data)
      setAuditTotal(res.total)
      setAuditTotalPages(res.totalPages)
    } catch { /* handled */ } finally { setAuditLoading(false) }
  }, [auditPage])

  useEffect(() => {
    loadUsers()
    loadAudit()
  }, [loadUsers, loadAudit])

  const openCreate = () => {
    setSelectedUser(null)
    reset({ name: '', email: '', password: '', role: 'SELLER' })
    setUserModal(true)
  }

  const openEdit = (u: User) => {
    setSelectedUser(u)
    resetEdit({ name: u.name, email: u.email, role: u.role, isActive: u.isActive, password: '' })
    setUserModal(true)
  }

  const onSaveUser = async (data: UserInput) => {
    setSaving(true)
    try {
      await securityService.createUser(data)
      toast.success('Usuario creado correctamente')
      setUserModal(false)
      reset()
      loadUsers()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al crear usuario'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const onUpdateUser = async (data: UserUpdateInput) => {
    if (!selectedUser) return
    setSaving(true)
    try {
      const payload: UserUpdateInput = { ...data }
      if (!payload.password) delete payload.password
      await securityService.updateUser(selectedUser.id, payload)
      toast.success('Usuario actualizado')
      setUserModal(false)
      loadUsers()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al actualizar usuario'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const openReset = (u: User) => {
    setResetTarget(u)
    setNewPassword('')
    setResetModal(true)
  }

  const handleResetPassword = async () => {
    if (!resetTarget || newPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setResetting(true)
    try {
      await api.post(`/security/users/${resetTarget.id}/reset-password`, { newPassword })
      toast.success(`Contraseña de ${resetTarget.name} actualizada`)
      setResetModal(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al resetear contraseña'
      toast.error(msg)
    } finally { setResetting(false) }
  }

  const handleToggle = async (u: User) => {
    if (u.id === currentUser?.id) { toast.error('No puedes desactivar tu propia cuenta'); return }
    setToggling(u.id)
    try {
      const updated = await securityService.toggleUserStatus(u.id, !u.isActive)
      setUsers((prev) => prev.map((usr) => usr.id === updated.id ? updated : usr))
      toast.success(`Usuario ${updated.isActive ? 'activado' : 'desactivado'}`)
    } catch { toast.error('Error al cambiar estado del usuario') } finally { setToggling(null) }
  }

  const roleVariant = (role: string): 'blue' | 'orange' | 'green' => {
    if (role === 'ADMIN') return 'blue'
    if (role === 'SELLER') return 'orange'
    return 'green'
  }

  return (
    <div>
      <PageHeader
        title="Seguridad y Usuarios"
        description="Gestión de usuarios y auditoría del sistema"
        actions={
          activeTab === 'users' && (
            <button className="btn-primary btn-sm" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Nuevo Usuario
            </button>
          )
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        <button onClick={() => setActiveTab('users')} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'users' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Shield className="w-4 h-4" /> Usuarios
        </button>
        <button onClick={() => setActiveTab('audit')} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'audit' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Activity className="w-4 h-4" /> Auditoría
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? <TableSkeleton rows={6} cols={5} /> : users.length === 0 ? (
              <EmptyState icon={<Shield className="w-8 h-8" />} title="Sin usuarios" action={<button className="btn-primary btn-sm" onClick={openCreate}><Plus className="w-4 h-4" /> Crear primero</button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-th">Nombre</th>
                    <th className="table-th">Email</th>
                    <th className="table-th">Rol</th>
                    <th className="table-th">Estado</th>
                    <th className="table-th">Creado</th>
                    <th className="table-th">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="table-row">
                      <td className="table-td">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-900 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium">{u.name}</span>
                          {u.id === currentUser?.id && <span className="badge-blue text-xs">Tú</span>}
                        </div>
                      </td>
                      <td className="table-td text-gray-500 text-sm">{u.email}</td>
                      <td className="table-td">
                        <Badge variant={roleVariant(u.role)}>{roleLabel(u.role)}</Badge>
                      </td>
                      <td className="table-td">
                        <Badge variant={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Activo' : 'Inactivo'}</Badge>
                      </td>
                      <td className="table-td text-gray-500 text-xs">{formatDateTime(u.createdAt)}</td>
                      <td className="table-td">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500" title="Editar">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openReset(u)}
                            disabled={u.id === currentUser?.id}
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-500 disabled:opacity-30"
                            title="Resetear Contraseña"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggle(u)}
                            disabled={toggling === u.id || u.id === currentUser?.id}
                            className={`p-1.5 rounded transition-colors ${u.isActive ? 'hover:bg-red-50 text-red-500' : 'hover:bg-green-50 text-green-600'}`}
                            title={u.isActive ? 'Desactivar' : 'Activar'}
                          >
                            {toggling === u.id ? <Spinner size="sm" /> : u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {/* Audit Tab */}
      {activeTab === 'audit' && (
        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Log de Auditoría</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            {auditLoading ? <TableSkeleton rows={8} cols={5} /> : auditLogs.length === 0 ? (
              <EmptyState icon={<Activity className="w-8 h-8" />} title="Sin registros de auditoría" description="Aquí aparecerán las acciones críticas del sistema." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-th">Fecha</th>
                    <th className="table-th">Usuario</th>
                    <th className="table-th">Acción</th>
                    <th className="table-th">Recurso</th>
                    <th className="table-th">Detalles</th>
                    <th className="table-th">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="table-row">
                      <td className="table-td text-xs text-gray-500">{formatDateTime(log.createdAt)}</td>
                      <td className="table-td font-medium text-sm">{log.user?.name ?? 'Sistema'}</td>
                      <td className="table-td">
                        <span className="badge-blue">{log.action}</span>
                      </td>
                      <td className="table-td text-gray-500 text-xs">{log.resource}{log.resourceId ? ` #${log.resourceId.slice(0, 8)}` : ''}</td>
                      <td className="table-td text-gray-500 text-xs max-w-xs truncate">{log.details ?? '—'}</td>
                      <td className="table-td font-mono text-xs text-gray-400">{log.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!auditLoading && auditLogs.length > 0 && (
            <Pagination page={auditPage} totalPages={auditTotalPages} total={auditTotal} limit={AUDIT_LIMIT} onPageChange={(p) => { setAuditPage(p); loadAudit(p) }} />
          )}
        </Card>
      )}

      {/* Reset Password Modal */}
      <Modal
        open={resetModal}
        onClose={() => setResetModal(false)}
        title={`Resetear Contraseña — ${resetTarget?.name ?? ''}`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setResetModal(false)}>Cancelar</button>
            <button className="btn-secondary" onClick={handleResetPassword} disabled={resetting || newPassword.length < 8}>
              {resetting && <Spinner size="sm" />} Establecer Contraseña
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Define una nueva contraseña para <strong>{resetTarget?.name}</strong>. El usuario deberá usar esta contraseña en su próximo inicio de sesión.</p>
          <div>
            <label className="label">Nueva Contraseña *</label>
            <input
              type="password"
              className="input-field"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoFocus
            />
            {newPassword.length > 0 && newPassword.length < 8 && (
              <p className="text-red-500 text-xs mt-1">Mínimo 8 caracteres</p>
            )}
          </div>
        </div>
      </Modal>

      {/* User Modal */}
      <Modal
        open={userModal}
        onClose={() => setUserModal(false)}
        title={selectedUser ? 'Editar Usuario' : 'Nuevo Usuario'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => setUserModal(false)}>Cancelar</button>
            <button className="btn-secondary" form="user-form" type="submit" disabled={saving}>
              {saving && <Spinner size="sm" />} {selectedUser ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        }
      >
        {selectedUser ? (
          <form id="user-form" onSubmit={handleEditSubmit(onUpdateUser)} className="space-y-4">
            <div><label className="label">Nombre</label><input className={`input-field ${editErrors.name ? 'input-error' : ''}`} {...regEdit('name')} />{editErrors.name && <p className="text-red-500 text-xs mt-1">{editErrors.name.message}</p>}</div>
            <div><label className="label">Email</label><input type="email" className={`input-field ${editErrors.email ? 'input-error' : ''}`} {...regEdit('email')} />{editErrors.email && <p className="text-red-500 text-xs mt-1">{editErrors.email.message}</p>}</div>
            <div>
              <label className="label">Rol</label>
              <select className="input-field" {...regEdit('role')}>
                <option value="ADMIN">Administrador</option>
                <option value="SELLER">Vendedor</option>
                <option value="WAREHOUSE">Almacén</option>
              </select>
            </div>
            <div><label className="label">Nueva Contraseña (dejar vacío para no cambiar)</label><input type="password" className="input-field" {...regEdit('password')} placeholder="Nueva contraseña..." /></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isActive" className="w-4 h-4" {...regEdit('isActive')} />
              <label htmlFor="isActive" className="text-sm text-gray-700">Usuario activo</label>
            </div>
          </form>
        ) : (
          <form id="user-form" onSubmit={handleSubmit(onSaveUser)} className="space-y-4">
            <div><label className="label">Nombre *</label><input className={`input-field ${errors.name ? 'input-error' : ''}`} {...register('name')} placeholder="Nombre completo" />{errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}</div>
            <div><label className="label">Email *</label><input type="email" className={`input-field ${errors.email ? 'input-error' : ''}`} {...register('email')} placeholder="correo@empresa.com" />{errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}</div>
            <div>
              <label className="label">Rol *</label>
              <select className="input-field" {...register('role')}>
                <option value="ADMIN">Administrador</option>
                <option value="SELLER">Vendedor</option>
                <option value="WAREHOUSE">Almacén</option>
              </select>
            </div>
            <div>
              <label className="label">Contraseña *</label>
              <input type="password" className={`input-field ${errors.password ? 'input-error' : ''}`} {...register('password')} placeholder="Mínimo 8 caracteres" />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
