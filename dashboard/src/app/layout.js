import './globals.css';

export const metadata = {
  title: 'Panel de Control - WhatsApp Reminder Bot',
  description: 'Administración, Conexión WhatsApp, Configuración de Groq y Auditoría de Recordatorios',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
