import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, Bell, User, LogOut, KeyRound, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import { authService } from '@/services/authService'
import { roleLabel } from '@/utils/formatters'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { changePasswordSchema, type ChangePasswordInput } from '@/utils/validators'

export const Topbar = () => {
  const { user, logout } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useAppStore()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwModal, setPwModal] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
  })

  const handleLogout = () => {
    logout()
    navigate('/login')
    toast.success('Sesión cerrada correctamente')
  }

  const handleChangePassword = async (data: ChangePasswordInput) => {
    setPwLoading(true)
    try {
      await authService.changePassword(data.currentPassword, data.newPassword)
      toast.success('Contraseña actualizada exitosamente')
      setPwModal(false)
      reset()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Error al cambiar contraseña'
      toast.error(msg)
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <>
      <header className={`fixed top-0 right-0 h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 z-30 transition-all duration-300 ${sidebarCollapsed ? 'left-16' : 'left-64'}`}>
        {/* Left */}
        <div className="flex items-center gap-3">
          <button onClick={toggleSidebar} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-blue-900">Clavijos Motos S.A.S.</p>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {/* Notifications (placeholder) */}
          <button className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors relative">
            <Bell className="w-5 h-5" />
          </button>

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-7 h-7 bg-blue-900 rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-gray-800 leading-tight">{user?.name ?? 'Usuario'}</p>
                <p className="text-xs text-gray-400">{roleLabel(user?.role ?? '')}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl border border-gray-200 shadow-modal z-20 py-1 animate-slide-in">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { setMenuOpen(false); setPwModal(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <KeyRound className="w-4 h-4 text-gray-400" />
                    Cambiar contraseña
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Cerrar sesión
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Change Password Modal */}
      <Modal
        open={pwModal}
        onClose={() => { setPwModal(false); reset() }}
        title="Cambiar Contraseña"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn-outline" onClick={() => { setPwModal(false); reset() }}>Cancelar</button>
            <button className="btn-secondary" form="pw-form" type="submit" disabled={pwLoading}>
              {pwLoading && <Spinner size="sm" />} Guardar
            </button>
          </div>
        }
      >
        <form id="pw-form" onSubmit={handleSubmit(handleChangePassword)} className="space-y-4">
          <div>
            <label className="label">Contraseña actual</label>
            <input type="password" className={`input-field ${errors.currentPassword ? 'input-error' : ''}`} {...register('currentPassword')} />
            {errors.currentPassword && <p className="text-red-500 text-xs mt-1">{errors.currentPassword.message}</p>}
          </div>
          <div>
            <label className="label">Nueva contraseña</label>
            <input type="password" className={`input-field ${errors.newPassword ? 'input-error' : ''}`} {...register('newPassword')} />
            {errors.newPassword && <p className="text-red-500 text-xs mt-1">{errors.newPassword.message}</p>}
          </div>
          <div>
            <label className="label">Confirmar contraseña</label>
            <input type="password" className={`input-field ${errors.confirmPassword ? 'input-error' : ''}`} {...register('confirmPassword')} />
            {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>}
          </div>
        </form>
      </Modal>
    </>
  )
}
