import axios from 'axios'
import { toast } from 'sonner'

const BASE_URL = import.meta.env.VITE_API_URL || 'https://motos.quantacloud.co/api/v1'

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Global error handler
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      'Error de conexión con el servidor'

    if (status === 401) {
      localStorage.removeItem('auth_token')
      // Avoid circular import — dispatch custom event instead of calling store
      window.dispatchEvent(new CustomEvent('sigc:unauthorized'))
      toast.error('Sesión expirada. Por favor inicia sesión nuevamente.')
    } else if (status === 403) {
      toast.error('No tienes permisos para realizar esta acción.')
    } else if (status === 404) {
      // Silently handle — caller decides
    } else if (status >= 500) {
      toast.error('Error interno del servidor. Intenta de nuevo.')
    } else if (status !== 422 && status !== 400) {
      // 422/400 are validation errors, handled by callers
      toast.error(message)
    }

    return Promise.reject(error)
  }
)

export default api
