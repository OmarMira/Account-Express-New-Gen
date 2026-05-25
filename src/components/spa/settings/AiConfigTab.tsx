import { useState, useEffect } from 'react';

export default function AiConfigTab() {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config/ai')
      .then((res) => res.json())
      .then((data) => {
        if (data.isSaved) {
          setIsSaved(true);
          if (data.apiKey) setApiKey(data.apiKey);
        } else if (localStorage.getItem('ai_key_saved') === 'true') {
          setIsSaved(true);
        }
      })
      .catch(() => {
        if (localStorage.getItem('ai_key_saved') === 'true') {
          setIsSaved(true);
        }
      });
  }, []);

  const handleSave = async () => {
    setStatus('');
    setLoading(true);
    try {
      // 1. Verificar primero
      const verifyRes = await fetch('/api/config/ai/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (!verifyRes.ok) {
        const errData = await verifyRes.json();
        setStatus(
          '❌ La verificación falló: ' + (errData.error || 'Clave inválida. No se guardó.'),
        );
        setLoading(false);
        return;
      }

      // 2. Si verifica, guardar
      const res = await fetch('/api/config/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('ai_key_saved', 'true');
        setStatus('✅ ¡Guardado con éxito! La IA ya está activa.');
        setIsSaved(true);
      } else {
        setStatus('❌ Error: ' + (data.error || 'No se pudo guardar la clave.'));
      }
    } catch (e) {
      setStatus('❌ Error de red: Verifica tu conexión.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setStatus('');
    setLoading(true);
    try {
      const res = await fetch('/api/config/ai/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('✅ ¡Conexión exitosa! La clave es válida.');
      } else {
        setStatus('❌ Falló la verificación: ' + (data.error || 'Clave inválida.'));
      }
    } catch (e) {
      setStatus('❌ Error de red al verificar.');
    } finally {
      setLoading(false);
    }
  };

  if (isSaved) {
    return (
      <div className="max-w-lg mx-auto bg-white rounded-xl shadow-md p-8 border border-green-200 text-center">
        <div className="text-5xl mb-4">🤖✨</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">¡Asistente Activado!</h2>
        <p className="text-gray-600 mb-8">
          La configuración se guardó correctamente. La inteligencia artificial ya está integrada en
          el sistema.
        </p>
        <button
          onClick={() => {
            setIsSaved(false);
            setStatus('');
          }}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-6 py-2 rounded-lg transition-colors"
        >
          Editar Configuración
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto bg-white rounded-xl shadow-md p-6 border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
        <span>🤖</span> Configuración del Asistente de IA
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        Sigue estos sencillos pasos para activar la inteligencia artificial en tu sistema.
      </p>

      {/* Paso 1 */}
      <div className="mb-6 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
        <h3 className="font-semibold text-blue-900 mb-1 flex items-center gap-2">
          <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            1
          </span>
          Obtén tu clave de acceso
        </h3>
        <p className="text-xs text-blue-800/80 mb-3">
          Regístrate o inicia sesión en OpenRouter para generar una clave de API segura y gratuita o
          de pago.
        </p>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
        >
          Crear Clave en OpenRouter ↗
        </a>
      </div>

      {/* Paso 2 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            2
          </span>
          Ingresa la clave obtenida
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Copia la clave generada en OpenRouter (comienza con "sk-or-...") y pégala aquí abajo.
        </p>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            className="w-full p-2.5 pr-20 border border-gray-300 rounded bg-white text-black focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-v1-..."
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-700 hover:text-gray-900 bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded transition-colors"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {/* Paso 3 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            3
          </span>
          Prueba y Activa
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Primero verifica si la clave funciona correctamente, luego guárdala para activar el
          asistente.
        </p>
        <div className="flex gap-3">
          <button
            disabled={loading || !apiKey}
            className="flex-1 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2 rounded transition-colors"
            onClick={handleVerify}
          >
            Verificar Conexión
          </button>
          <button
            disabled={loading || !apiKey}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            onClick={handleSave}
          >
            Guardar y Activar
          </button>
        </div>
      </div>

      {status && (
        <div
          className={`p-3 rounded-lg text-sm font-medium border ${
            status.includes('✅')
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {status}
        </div>
      )}
    </div>
  );
}
