import { useState, useEffect } from 'react';
import { useLanguageStore } from '@/store/language-store';
import { AI_CONFIG } from '@/lib/constants/ai-config';

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
    step3Title: isEn ? 'Select AI Model' : 'Selecciona el modelo de IA',
    step3Desc: isEn
      ? 'Choose the model that best fits your needs. We recommend Qwen 2.5 72B.'
      : 'Elegí el modelo que mejor se adapte a tus necesidades. Te sugerimos Qwen 2.5 72B.',
    step4Title: isEn ? 'Test and Activate' : 'Prueba y Activa',
    step4Desc: isEn
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
  const [selectedModel, setSelectedModel] = useState<string>(AI_CONFIG.DEFAULT_MODEL);
  const [customModel, setCustomModel] = useState('');
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
          if (data.model) {
            const isStandard = AI_CONFIG.AVAILABLE_MODELS.some((m) => m.id === data.model);
            if (isStandard) {
              setSelectedModel(data.model);
            } else {
              setSelectedModel('custom');
              setCustomModel(data.model);
            }
          }
        } else {
          setIsSaved(false);
        }
      })
      .catch(() => {
        if (localStorage.getItem('ai_key_saved') === 'true') {
          setIsSaved(true);
        }
      });
  }, []);

  const getActiveModel = () => {
    return selectedModel === 'custom' ? customModel : selectedModel;
  };

  const handleSave = async () => {
    setStatus('');
    setLoading(true);
    const model = getActiveModel();
    if (selectedModel === 'custom' && !customModel.trim()) {
      setStatus('❌ Por favor introduce el nombre del modelo personalizado.');
      setLoading(false);
      return;
    }
    try {
      // 1. Verificar primero
      const verifyRes = await fetch('/api/config/ai/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok && !verifyData.warning) {
        setStatus(`❌ ${dt.verificationFailed}` + (verifyData.error || dt.invalidKeyNoSave));
        setLoading(false);
        return;
      }

      // 2. Si verifica (o da warning de 429), guardar
      const res = await fetch('/api/config/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('ai_key_saved', 'true');
        if (verifyData.warning) {
          setStatus(`⚠️ ${verifyData.warning}`);
        } else {
          setStatus(`✅ ${dt.saveSuccess}`);
        }
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
    const model = getActiveModel();
    if (selectedModel === 'custom' && !customModel.trim()) {
      setStatus('❌ Por favor introduce el nombre del modelo personalizado.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/config/ai/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.warning) {
          setStatus(`⚠️ ${data.warning}`);
        } else {
          setStatus(`✅ ${dt.connectionSuccess}`);
        }
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
    <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-md p-6 border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
        <span>🤖</span> {dt.aiAssistantSettings}
      </h2>
      <p className="text-sm text-gray-600 mb-6">{dt.stepsDescription}</p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Recomendación + Paso 1 */}
        <div className="lg:col-span-7 space-y-6">
          {/* Banner de modelo sugerido */}
          <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs">
            <div className="font-semibold text-sm flex items-center gap-1.5 mb-1 text-amber-950">
              <span>💡</span>{' '}
              {isEn ? 'Recommended Model (100% Free)' : 'Modelo Recomendado (100% Gratis)'}
            </div>
            <p className="mb-2 leading-relaxed">
              {isEn
                ? 'We suggest using OpenRouter configured with the free router '
                : 'Te sugerimos usar OpenRouter configurado con el enrutador gratuito '}
              <code className="bg-amber-100 font-mono text-[11px] px-1.5 py-0.5 rounded border border-amber-300 select-all font-semibold">
                {AI_CONFIG.DEFAULT_MODEL}
              </code>
              .
            </p>
            <p className="leading-relaxed">
              {isEn
                ? 'For a 100% free experience, use this router as OpenRouter rotates free models over time. If you prefer Qwen 2.5/3.7, you can select them in Step 3, but they require a paid key (extremely cheap, cents per million tokens).'
                : 'Para una experiencia 100% gratis usá este enrutador, ya que OpenRouter rota los modelos gratis con el tiempo. Si preferís Qwen 2.5/3.7, podés seleccionarlos en el Paso 3, pero requieren una clave con saldo (es extremadamente barato, centavos por millón de tokens).'}
            </p>
          </div>

          {/* Paso 1 */}
          <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100">
            <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                1
              </span>
              {dt.step1Title}
            </h3>

            <div className="text-xs text-blue-800/80 space-y-2 mb-4 leading-relaxed">
              <p>
                {isEn
                  ? "Click the button below to open OpenRouter. If you don't have an account, register first (it takes 1 minute)."
                  : 'Hacé clic en el botón de abajo para abrir OpenRouter. Si no tenés cuenta, registrate primero (lleva 1 minuto).'}
              </p>
              <div className="p-3 bg-white/70 border border-blue-100 rounded-md text-[11px] space-y-2 font-medium text-blue-950">
                <div className="font-bold text-blue-900 mb-1">
                  {isEn
                    ? 'Once on the OpenRouter page:'
                    : 'Una vez dentro de la página de OpenRouter:'}
                </div>
                <div className="flex gap-1.5 items-start">
                  <span className="text-blue-600 font-bold">1.</span>
                  <span>
                    {isEn ? 'Click the blue button ' : 'Hacé clic en el botón azul '}
                    <strong className="bg-blue-600 text-white px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap font-bold shadow-sm">
                      + New Key
                    </strong>
                    {isEn ? ' at the top right.' : ' arriba a la derecha.'}
                  </span>
                </div>
                <div className="flex gap-1.5 items-start">
                  <span className="text-blue-600 font-bold">2.</span>
                  <span>
                    {isEn
                      ? 'Enter a name (e.g. "My Assistant") and click '
                      : 'Poné un nombre (ej. "Mi Asistente") y hacé clic en '}
                    <strong className="bg-blue-50 border border-blue-200 px-1 py-0.5 rounded text-[10px] text-blue-800 font-bold">
                      Create
                    </strong>
                    .
                  </span>
                </div>
                <div className="flex gap-1.5 items-start">
                  <span className="text-blue-600 font-bold">3.</span>
                  <span>
                    {isEn
                      ? 'Copy the generated key (starts with '
                      : 'Copiá la clave generada (empieza con '}
                    <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[10px] text-amber-900 font-semibold select-all">
                      sk-or-v1-...
                    </code>
                    {isEn ? ') and paste it in Step 2 below.' : ') y pegala en el Paso 2 de abajo.'}
                  </span>
                </div>
              </div>
            </div>

            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded shadow-sm transition-colors"
            >
              {dt.createKeyOpenRouter}
            </a>
          </div>
        </div>

        {/* Columna Derecha: Paso 2 + Paso 3 (Modelo) + Paso 4 (Prueba/Activa) */}
        <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
          {/* Paso 2 */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex-1 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                  2
                </span>
                {dt.step2Title}
              </h3>
              <p className="text-xs text-gray-500 mb-3">{dt.step2Desc}</p>
            </div>
            <div className="relative mt-auto">
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

          {/* Paso 3 (Nuevo): Selección de modelo */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex-1 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                  3
                </span>
                {dt.step3Title}
              </h3>
              <p className="text-xs text-gray-500 mb-3">{dt.step3Desc}</p>
            </div>

            <div className="space-y-3 mt-auto">
              <select
                className="w-full p-2.5 border border-gray-300 rounded bg-white text-black focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-medium"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {AI_CONFIG.AVAILABLE_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>

              {selectedModel === 'custom' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                    {isEn ? 'Custom Model Identifier' : 'Identificador de Modelo Personalizado'}
                  </label>
                  <input
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded bg-white text-black focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs font-mono"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="e.g. deepseek/deepseek-chat"
                  />
                  <p className="text-[10px] text-gray-400 leading-normal">
                    {isEn
                      ? 'Type the exact model ID from OpenRouter models directory.'
                      : 'Escribí el ID exacto del modelo desde el directorio de modelos de OpenRouter.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Paso 4 */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex-1 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <span className="bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                  4
                </span>
                {dt.step4Title}
              </h3>
              <p className="text-xs text-gray-500 mb-4">{dt.step4Desc}</p>
            </div>
            <div className="flex gap-3 mt-auto">
              <button
                disabled={loading || !apiKey}
                className="flex-1 bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2.5 rounded transition-colors"
                onClick={handleVerify}
              >
                {dt.verifyConnection}
              </button>
              <button
                disabled={loading || !apiKey}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded transition-colors"
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
                  : status.includes('⚠️')
                    ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                    : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
