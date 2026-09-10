'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  QrCode,
  CheckCircle2,
  AlertCircle,
  Key,
  Clock,
  Calendar,
  Phone,
  RefreshCw,
  LogOut,
  Bell,
  Trash2,
  Shield,
  Search,
  Filter,
  ArrowUpRight
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:3001';

export default function DashboardPage() {
  const router = useRouter();

  // State: WhatsApp Connection
  const [botStatus, setBotStatus] = useState('LOADING'); // LOADING, CONNECTED, QR_READY, DISCONNECTED
  const [qrCode, setQrCode] = useState(null);
  const [phoneInfo, setPhoneInfo] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);

  // State: Groq API Key
  const [maskedApiKey, setMaskedApiKey] = useState('...');
  const [newApiKey, setNewApiKey] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyMessage, setKeyMessage] = useState(null);

  // State: Reminders
  const [reminders, setReminders] = useState([]);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Logout handler
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  // 1. Fetch Bot Connection & QR
  const checkBotStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`, { cache: 'no-store' });
      if (!res.ok) throw new Error('API down');
      const data = await res.json();
      setBotStatus(data.status || 'DISCONNECTED');
      setPhoneInfo({ phone: data.phone, pushname: data.pushname });
      setLastCheck(new Date());

      if (data.status === 'QR_READY') {
        const qrRes = await fetch(`${API_BASE}/api/qr`, { cache: 'no-store' });
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          setQrCode(qrData.qr);
        }
      } else {
        setQrCode(null);
      }
    } catch (err) {
      setBotStatus('DISCONNECTED');
      setQrCode(null);
    }
  }, []);

  // 2. Fetch Groq Config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setMaskedApiKey(data.groqApiKeyMasked || 'No configurada');
      }
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  }, []);

  // 3. Fetch Reminders
  const fetchReminders = useCallback(async () => {
    try {
      setRemindersLoading(true);
      const res = await fetch(`${API_BASE}/api/reminders`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setReminders(data);
      }
    } catch (err) {
      console.error('Error fetching reminders:', err);
    } finally {
      setRemindersLoading(false);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    checkBotStatus();
    fetchConfig();
    fetchReminders();

    const interval = setInterval(() => {
      checkBotStatus();
      fetchReminders();
    }, 4000);

    return () => clearInterval(interval);
  }, [checkBotStatus, fetchConfig, fetchReminders]);

  // Update Groq API Key
  const handleSaveApiKey = async (e) => {
    e.preventDefault();
    if (!newApiKey.trim()) return;

    setKeySaving(true);
    setKeyMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: newApiKey.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setKeyMessage({ type: 'success', text: 'API Key actualizada correctamente.' });
        setNewApiKey('');
        fetchConfig();
      } else {
        setKeyMessage({ type: 'error', text: data.error || 'Error al guardar.' });
      }
    } catch (err) {
      setKeyMessage({ type: 'error', text: 'No se pudo contactar el servidor del bot.' });
    } finally {
      setKeySaving(false);
    }
  };

  // Delete reminder
  const handleDeleteReminder = async (id) => {
    if (!confirm('¿Seguro que deseas eliminar este recordatorio?')) return;
    try {
      await fetch(`${API_BASE}/api/reminders/${id}`, { method: 'DELETE' });
      fetchReminders();
    } catch (err) {
      alert('Error al eliminar');
    }
  };

  // Format date to Colombia
  const formatColombiaDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  // Filtered reminders
  const filteredReminders = reminders.filter((rem) => {
    const matchesStatus =
      filterStatus === 'ALL' ||
      (filterStatus === 'PENDING' && rem.status === 'pending') ||
      (filterStatus === 'COMPLETED' && rem.status === 'completed');

    const matchesSearch =
      searchQuery === '' ||
      (rem.texto && rem.texto.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (rem.user?.phone && rem.user.phone.includes(searchQuery));

    return matchesStatus && matchesSearch;
  });

  const pendingCount = reminders.filter((r) => r.status === 'pending').length;
  const completedCount = reminders.filter((r) => r.status === 'completed').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-md shadow-indigo-500/20">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white leading-tight">WhatsApp Assistant</h1>
              <p className="text-xs text-slate-400">Panel de Control y Motor de Tareas</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Connection badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/90 border border-slate-700/60 text-xs font-medium">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  botStatus === 'CONNECTED'
                    ? 'bg-emerald-500 animate-pulse shadow-sm shadow-emerald-400'
                    : botStatus === 'QR_READY'
                    ? 'bg-amber-400'
                    : 'bg-rose-500'
                }`}
              />
              <span className="text-slate-300">
                {botStatus === 'CONNECTED'
                  ? 'Bot Activo'
                  : botStatus === 'QR_READY'
                  ? 'Esperando Escaneo QR'
                  : 'Desconectado'}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Top Grid: Connection & Groq Config */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Section 1: Connection & QR (7 cols) */}
          <section className="lg:col-span-7 bg-slate-900/60 rounded-2xl border border-slate-800/80 p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <h2 className="text-lg font-bold text-white">Conexión de WhatsApp</h2>
                </div>
                <button
                  onClick={checkBotStatus}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                  title="Actualizar estado"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {botStatus === 'CONNECTED' ? (
                <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-5">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 text-emerald-400 shadow-inner">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div className="text-center sm:text-left space-y-1">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Sesión Autenticada
                    </span>
                    <h3 className="text-xl font-bold text-white">Bot en Línea</h3>
                    <p className="text-sm text-slate-300 flex items-center justify-center sm:justify-start gap-1.5">
                      <Phone className="w-4 h-4 text-emerald-400" />
                      Teléfono: <span className="font-mono text-emerald-300 font-semibold">{phoneInfo?.phone || 'Conectado'}</span>
                      {phoneInfo?.pushname && <span className="text-slate-400">({phoneInfo.pushname})</span>}
                    </p>
                    <p className="text-xs text-slate-400 pt-1">
                      El bot está respondiendo mensajes de WhatsApp y ejecutando el motor de recordatorios con Groq y node-schedule.
                    </p>
                  </div>
                </div>
              ) : botStatus === 'QR_READY' && qrCode ? (
                <div className="flex flex-col md:flex-row items-center gap-6 bg-slate-950/70 p-6 rounded-2xl border border-amber-500/30">
                  <div className="bg-white p-3 rounded-2xl shadow-2xl flex-shrink-0">
                    <img src={qrCode} alt="WhatsApp QR" className="w-48 h-48 rounded-lg" />
                  </div>
                  <div className="space-y-3 text-center md:text-left">
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Escaneo Requerido
                    </span>
                    <h3 className="text-lg font-bold text-white">Vincula tu WhatsApp</h3>
                    <ol className="text-sm text-slate-300 space-y-1.5 list-decimal list-inside text-left">
                      <li>Abre WhatsApp en tu teléfono</li>
                      <li>Toca <b>Ajustes</b> o <b>Menú</b> &gt; <b>Dispositivos vinculados</b></li>
                      <li>Toca <b>Vincular un dispositivo</b></li>
                      <li>Apunta tu cámara a este código QR</li>
                    </ol>
                    <p className="text-xs text-amber-400/80">Este QR se actualiza automáticamente.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <AlertCircle className="w-6 h-6 animate-pulse text-amber-400" />
                  </div>
                  <h3 className="text-base font-semibold text-white">Iniciando Cliente de WhatsApp...</h3>
                  <p className="text-sm text-slate-400 max-w-sm mx-auto">
                    El backend en Railway está inicializando Puppeteer en modo headless y generando la sesión.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-slate-400 flex justify-between items-center">
              <span>Backend URL: <code className="text-indigo-400 font-mono">{API_BASE}</code></span>
              {lastCheck && <span>Última comprobación: {lastCheck.toLocaleTimeString()}</span>}
            </div>
          </section>

          {/* Section 2: Groq API Key (5 cols) */}
          <section className="lg:col-span-5 bg-slate-900/60 rounded-2xl border border-slate-800/80 p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Configuración Groq AI</h2>
                  <p className="text-xs text-slate-400">Modelo: llama3-8b-8192 (Rotación dinámica)</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Clave Actual en Base de Datos</span>
                  <div className="font-mono text-sm text-indigo-300 font-semibold flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>{maskedApiKey}</span>
                  </div>
                </div>

                <form onSubmit={handleSaveApiKey} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Nueva GROQ_API_KEY
                    </label>
                    <input
                      type="password"
                      placeholder="gsk_..."
                      value={newApiKey}
                      onChange={(e) => setNewApiKey(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition font-mono"
                    />
                  </div>

                  {keyMessage && (
                    <div
                      className={`text-xs p-3 rounded-xl border ${
                        keyMessage.type === 'success'
                          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                          : 'bg-rose-950/40 text-rose-300 border-rose-800/50'
                      }`}
                    >
                      {keyMessage.text}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={keySaving || !newApiKey.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold text-sm text-white shadow-lg shadow-indigo-600/20 transition flex items-center justify-center gap-2"
                  >
                    {keySaving ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Key className="w-4 h-4" />
                        <span>Actualizar Clave de Groq</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>

            <p className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-slate-400">
              La clave se actualiza en tiempo real en la tabla <code className="text-slate-300 font-mono">Config</code> de Prisma sin reiniciar el bot.
            </p>
          </section>
        </div>

        {/* Section 3: Reminders Audit Table */}
        <section className="bg-slate-900/60 rounded-2xl border border-slate-800/80 shadow-xl backdrop-blur-sm overflow-hidden">
          {/* Header and filters */}
          <div className="p-6 border-b border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Auditoría de Recordatorios</h2>
                  <p className="text-xs text-slate-400">
                    Control de tareas programadas, alertas (-24h, -1h, exactas) y recurrencias
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Stat Counters */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                <span className="text-slate-400">Pendientes:</span>
                <span className="font-bold text-amber-400">{pendingCount}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Completados:</span>
                <span className="font-bold text-emerald-400">{completedCount}</span>
              </div>

              {/* Status Tabs */}
              <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs font-medium">
                {['ALL', 'PENDING', 'COMPLETED'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setFilterStatus(st)}
                    className={`px-3 py-1 rounded-lg transition ${
                      filterStatus === st
                        ? 'bg-indigo-600 text-white font-semibold shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {st === 'ALL' ? 'Todos' : st === 'PENDING' ? 'Pendientes' : 'Completados'}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar por texto o teléfono..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-48 sm:w-64"
                />
              </div>

              <button
                onClick={fetchReminders}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
                title="Recargar tabla"
              >
                <RefreshCw className={`w-4 h-4 ${remindersLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase font-semibold text-slate-400 border-b border-slate-800/80">
                <tr>
                  <th className="px-6 py-3.5">Usuario (Teléfono)</th>
                  <th className="px-6 py-3.5">Mensaje / Tarea</th>
                  <th className="px-6 py-3.5">Fecha Objetivo (UTC-5 Colombia)</th>
                  <th className="px-6 py-3.5">Estado</th>
                  <th className="px-6 py-3.5">Recurrencia</th>
                  <th className="px-6 py-3.5">Alertas Programadas</th>
                  <th className="px-6 py-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredReminders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      {remindersLoading
                        ? 'Cargando recordatorios...'
                        : 'No se encontraron recordatorios registrados.'}
                    </td>
                  </tr>
                ) : (
                  filteredReminders.map((rem) => {
                    const alerts = Array.isArray(rem.scheduledAlerts) ? rem.scheduledAlerts : [];
                    return (
                      <tr key={rem.id} className="hover:bg-slate-800/30 transition">
                        <td className="px-6 py-4 font-mono text-xs text-indigo-300 whitespace-nowrap">
                          {rem.user?.phone || 'Desconocido'}
                        </td>
                        <td className="px-6 py-4 font-medium text-white max-w-xs truncate" title={rem.texto}>
                          {rem.texto}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-300">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{formatColombiaDate(rem.targetDate)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {rem.status === 'completed' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> Completado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <Clock className="w-3 h-3" /> Pendiente
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs">
                          {rem.isRecurring ? (
                            <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                              Cada {rem.recurrenceDays || 1} d
                            </span>
                          ) : (
                            <span className="text-slate-500">No</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {['-24h', '-1h', 'exact'].map((type) => {
                              const found = alerts.find((a) => a.type === type);
                              const isSent = found?.status === 'sent';
                              return (
                                <span
                                  key={type}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${
                                    isSent
                                      ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80'
                                      : 'bg-slate-800 text-slate-400 border-slate-700'
                                  }`}
                                  title={`${type}: ${isSent ? 'Enviada' : 'Pendiente / Programada'}`}
                                >
                                  {type} {isSent ? '✓' : '⏳'}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleDeleteReminder(rem.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition"
                            title="Eliminar recordatorio"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
