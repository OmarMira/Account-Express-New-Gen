import { useState, useEffect } from 'react';
import { useLanguageStore } from '@/store/language-store';

export default function AiConfigTab() {
  const language = useLanguageStore((s) => s.language) || 'es';
  const isEn = language === 'en';

  const dt = {
    assistantActivated: isEn ? 'Assistant Activated!' : '¡Asistente Activado!',
    savedSuccessDesc: isEn
      ? 'The configuration was saved successfully. Artificial intelligence is now integrated into the system.'
      : 'La configuración se guardó correctamente. La inteligencia artificial ya está integrada en el sistema.',
    editSettings: isEn ? 'Edit Configuration' : 'Editar Configuración',
    aiAssistantSettings: isEn ? 'AI Assistant Configuration' : 'Configuración del Asistente de IA',
    stepsDescription: isEn
      ? 'Follow these simple steps to activate artificial intelligence in your system.'
      : 'Sigue estos sencillos pasos para activar la inteligencia artificial en tu sistema.',
    step1Title: isEn ? 'Obtain your access key' : 'Obtén tu clave de acceso',
    step1Desc: isEn
      ? 'Register or log in to OpenRouter to generate a secure free or paid API key.'
      : 'Regístrate o inicia sesión en OpenRouter para generar una clave de API segura y gratuita o de pago.',
    createKeyOpenRouter: isEn ? 'Create Key on OpenRouter ↗' : 'Crear Clave en OpenRouter ↗',
    step2Title: isEn ? 'Enter the obtained key' : 'Ingresa la clave obtenida',
    step2Desc: isEn
      ? 'Copy the key generated in OpenRouter (starts with "sk-or-...") and paste it below.'
      : 'Copia la clave generada en OpenRouter (comienza con "sk-or-...") y pégala aquí abajo.',
    hide: isEn ? 'Hide' : 'Ocultar',
    show: isEn ? 'Show' : 'Mostrar',
    step3Title: isEn ? 'Test and Activate' : 'Prueba y Activa',
    step3Desc: isEn
      ? 'First verify if the key works correctly, then save it to activate the assistant.'
      : 'Primero verifica si la clave funciona correctamente, luego guárdala para activar el asistente.',
    verifyConnection: isEn ? 'Verify Connection' : 'Verificar Conexión',
    saveAndActivate: isEn ? 'Save and Activate' : 'Guardar y Activar',
    verificationFailed: isEn ? 'Verification failed: ' : 'La verificación falló: ',
    invalidKeyNoSave: isEn ? 'Invalid key. Not saved.' : 'Clave inválida. No se guardó.',
    saveSuccess: isEn
      ? 'Saved successfully! AI is now active.'
      : '¡Guardado con éxito! La IA ya está activa.',
    saveError: isEn ? 'Error: Could not save the key.' : 'Error: No se pudo guardar la clave.',
    networkError: isEn
      ? 'Network error: Verify your connection.'
      : 'Error de red: Verifica tu conexión.',
    connectionSuccess: isEn
      ? 'Connection successful! The key is valid.'
      : '¡Conexión exitosa! La clave es válida.',
    invalidKey: isEn ? 'Invalid key.' : 'Clave inválida.',
    networkErrorVerify: isEn ? 'Network error during verification.' : 'Error de red al verificar.',
  };

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
        setStatus(`❌ ${dt.verificationFailed}` + (errData.error || dt.invalidKeyNoSave));
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
        setStatus(`✅ ${dt.saveSuccess}`);
        setIsSaved(true);
      } else {
        setStatus(`❌ ${dt.saveError} ` + (data.error || ''));
      }
    } catch (e) {
      setStatus(`❌ ${dt.networkError}`);
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
        setStatus(`✅ ${dt.connectionSuccess}`);
      } else {
        setStatus(`❌ ${dt.verificationFailed}` + (data.error || dt.invalidKey));
      }
    } catch (e) {
      setStatus(`❌ ${dt.networkErrorVerify}`);
    } finally {
      setLoading(false);
    }
  };

  if (isSaved) {
    return (
      <div className="max-w-lg mx-auto bg-white rounded-xl shadow-md p-8 border border-green-200 text-center">
        <div className="text-5xl mb-4">🤖✨</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">{dt.assistantActivated}</h2>
        <p className="text-gray-600 mb-8">{dt.savedSuccessDesc}</p>
        <button
          onClick={() => {
            setIsSaved(false);
            setStatus('');
          }}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-6 py-2 rounded-lg transition-colors"
        >
          {dt.editSettings}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto bg-white rounded-xl shadow-md p-6 border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
        <span>🤖</span> {dt.aiAssistantSettings}
      </h2>
      <p className="text-sm text-gray-600 mb-6">{dt.stepsDescription}</p>

      {/* Paso 1 */}
      <div className="mb-6 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
        <h3 className="font-semibold text-blue-900 mb-1 flex items-center gap-2">
          <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            1
          </span>
          {dt.step1Title}
        </h3>
        <p className="text-xs text-blue-800/80 mb-3">{dt.step1Desc}</p>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
        >
          {dt.createKeyOpenRouter}
        </a>
      </div>

      {/* Paso 2 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            2
          </span>
          {dt.step2Title}
        </h3>
        <p className="text-xs text-gray-500 mb-3">{dt.step2Desc}</p>
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
            {showKey ? dt.hide : dt.show}
          </button>
        </div>
      </div>

      {/* Paso 3 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
            3
          </span>
          {dt.step3Title}
        </h3>
        <p className="text-xs text-gray-500 mb-4">{dt.step3Desc}</p>
        <div className="flex gap-3">
          <button
            disabled={loading || !apiKey}
            className="flex-1 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2 rounded transition-colors"
            onClick={handleVerify}
          >
            {dt.verifyConnection}
          </button>
          <button
            disabled={loading || !apiKey}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            onClick={handleSave}
          >
            {dt.saveAndActivate}
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
