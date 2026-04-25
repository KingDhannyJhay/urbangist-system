'use client';
import { useEffect } from 'react';
import Link from 'next/link';
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl mb-4">⚠️</div>
      <h1 className="text-2xl font-black text-[#F8F8F8] mb-3" style={{fontFamily:'Syne,sans-serif'}}>Something went wrong</h1>
      <p className="text-[#A3A3A3] mb-6">An unexpected error occurred. Our team has been notified.</p>
      {error.digest && <p className="text-xs text-[#525252] font-mono mb-6">ID: {error.digest}</p>}
      <div className="flex gap-3">
        <button onClick={reset} className="btn-primary">Try Again</button>
        <Link href="/" className="btn-secondary">Go Home</Link>
      </div>
    </main>
  );
}
