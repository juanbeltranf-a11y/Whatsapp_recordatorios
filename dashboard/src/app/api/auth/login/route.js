import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { pin } = await request.json();
    const expectedPin = process.env.DASHBOARD_PIN || '1234';

    if (!pin || pin.toString().trim() !== expectedPin.toString().trim()) {
      return NextResponse.json({ error: 'PIN incorrecto. Intenta de nuevo.' }, { status: 401 });
    }

    const response = NextResponse.json({ success: true, message: 'Autenticación exitosa' });

    // Set auth cookie
    response.cookies.set('dashboard_auth', expectedPin, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}
