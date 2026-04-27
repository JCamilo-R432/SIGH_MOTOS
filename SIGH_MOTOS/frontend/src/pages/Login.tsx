import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Bike, Lock, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { authService } from '@/services/authService'
import { useAuthStore } from '@/store/authStore'
import { loginSchema, type LoginInput } from '@/utils/validators'
import { Spinner } from '@/components/ui/Spinner'

export default function Login() {
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAuthStore()
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true })
  }, [isAuthenticated, navigate])

  const onSubmit = async (data: LoginInput) => {
    setLoading(true)
    try {
      const res = await authService.login(data)
      setAuth(res.user, res.token)
      toast.success(`¡Bienvenido, ${res.user.name}!`)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Credenciales incorrectas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-center justify-center p-4">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
        backgroundSize: '32px 32px',
      }} />

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-modal p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <Bike className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-blue-900">Clavijos Motos</h1>
            <p className="text-gray-400 text-sm mt-1">Sistema de Gestión Comercial</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="label">Correo electrónico</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="email"
                  placeholder="admin@clavijosmotos.com"
                  className={`input-field pl-9 ${errors.email ? 'input-error' : ''}`}
                  {...register('email')}
                  autoComplete="email"
                  autoFocus
                />
              </div>
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  className={`input-field pl-9 pr-10 ${errors.password ? 'input-error' : ''}`}
                  {...register('password')}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5 text-base mt-2"
            >
              {loading ? <><Spinner size="sm" /> Iniciando sesión...</> : 'Iniciar Sesión'}
            </button>
          </form>

          {/* Forgot password */}
          <p className="text-center mt-5 text-sm text-gray-400">
            <button className="text-blue-600 hover:text-blue-800 hover:underline transition-colors">
              ¿Olvidaste tu contraseña?
            </button>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center mt-4 text-blue-300 text-xs">
          Aguachica, Cesar · Colombia
        </p>
      </div>
    </div>
  )
}
