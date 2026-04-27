import { useNavigate } from 'react-router-dom'
import { Bike, Home } from 'lucide-react'

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-blue-900 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-20 h-20 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <Bike className="w-11 h-11 text-white" />
        </div>
        <h1 className="text-8xl font-black text-white mb-2">404</h1>
        <p className="text-blue-200 text-lg mb-8">Página no encontrada</p>
        <button onClick={() => navigate('/dashboard')} className="btn-primary">
          <Home className="w-4 h-4" /> Volver al Inicio
        </button>
      </div>
    </div>
  )
}
