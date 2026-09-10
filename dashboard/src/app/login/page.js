'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, ShieldCheck, AlertCircle, Delete } from 'lucide-react';

function LoginForm() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const handleKeyPress = (num) => {
    if (pin.length < 6) {
      setPin((prev) => prev + num);
      setError('');
    }
  };

  const handleDelete = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!pin) {
      setError('Por favor ingresa el PIN de acceso.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'PIN incorrecto.');
        setPin('');
      } else {
        router.push(redirectPath);
        router.refresh();
      }
    } catch (err) {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl border border-slate-800">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400 mb-4 shadow-inner">
          <Lock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Panel de Administración</h1>
        <p className="text-sm text-slate-400 mt-1">Ingresa el PIN de seguridad para acceder al sistema</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-center items-center gap-3 my-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all duration-200 ${
                pin[i]
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300 scale-105 shadow-lg shadow-indigo-500/10'
                  : 'border-slate-800 bg-slate-950/60 text-slate-500'
              }`}
            >
              {pin[i] ? '•' : ''}
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-950/30 p-3 rounded-xl border border-rose-800/40">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              type="button"
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-14 rounded-xl bg-slate-800/70 hover:bg-slate-700/80 active:scale-95 text-xl font-semibold text-white transition border border-slate-700/50 shadow-sm"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-14 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-xs font-medium text-slate-400 transition border border-slate-800"
          >
            LIMPIAR
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            className="h-14 rounded-xl bg-slate-800/70 hover:bg-slate-700/80 active:scale-95 text-xl font-semibold text-white transition border border-slate-700/50"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-14 rounded-xl bg-slate-800/40 hover:bg-slate-800 flex items-center justify-center text-slate-400 transition border border-slate-800"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <button
          type="submit"
          disabled={loading || pin.length === 0}
          className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-white shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <ShieldCheck className="w-5 h-5" />
              <span>Ingresar al Dashboard</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <Suspense fallback={<div className="text-slate-400">Cargando...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
