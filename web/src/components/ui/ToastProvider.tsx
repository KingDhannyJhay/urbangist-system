'use client';

import { Toaster } from 'react-hot-toast';

export default function ToastProvider() {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{
        style: {
          background: '#1C1C1C',
          color:      '#F8F8F8',
          border:     '1px solid #2A2A2A',
          fontSize:   '13px',
          fontWeight: '500',
        },
        success: { iconTheme: { primary: '#22C55E', secondary: '#0B0B0B' } },
        error:   { iconTheme: { primary: '#EF4444', secondary: '#F8F8F8' } },
      }}
    />
  );
}
