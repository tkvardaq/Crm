import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ready: true, timestamp: true }, { status: 200 });
}