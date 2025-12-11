'use client'

import dynamic from 'next/dynamic'

// Lazy-load QR Scanner only when needed (saves ~20MB initial bundle)
const QRScanner = dynamic(() => import('./QRScanner'), {
  loading: () => (
    <div className="flex items-center justify-center py-8">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  ),
  ssr: false
})

interface LazyQRScannerProps {
  resortSlug: string
  signId: string
  onSuccess?: () => void
}

export default function LazyQRScanner({ resortSlug, signId, onSuccess }: LazyQRScannerProps) {
  return <QRScanner resortSlug={resortSlug} signId={signId} onSuccess={onSuccess} />
}

