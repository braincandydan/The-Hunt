'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface QRScannerProps {
  resortSlug: string
  signId: string
  onSuccess?: () => void
}

export default function QRScanner({ resortSlug, signId, onSuccess }: QRScannerProps) {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false) // Debounce flag
  // Use a ref to track processing state to avoid stale closure issues in callbacks
  const isProcessingRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const router = useRouter()
  // Create Supabase client once using useMemo
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (codeReaderRef.current) {
        codeReaderRef.current.reset()
      }
    }
  }, [])

  const startScanning = async () => {
    try {
      setError(null)
      setScanning(true)
      setIsProcessing(false)

      if (!videoRef.current) {
        throw new Error('Video element not available')
      }

      const codeReader = new BrowserMultiFormatReader()
      codeReaderRef.current = codeReader

      // Get available video input devices
      const videoInputDevices = await codeReader.listVideoInputDevices()

      if (videoInputDevices.length === 0) {
        throw new Error('No camera found')
      }

      // Use the first available camera (back camera preferred on mobile)
      const selectedDeviceId = videoInputDevices[0].deviceId

      // Start decoding from video device
      codeReader.decodeFromVideoDevice(
        selectedDeviceId,
        videoRef.current,
        (result, err) => {
          // Use ref to check processing state to avoid stale closure
          if (result && !isProcessingRef.current) {
            handleScan(result.getText())
          }
          // Silently ignore scan errors - NotFoundException is expected during scanning
        }
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start camera'
      setError(message)
      setScanning(false)
    }
  }

  const stopScanning = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset()
      codeReaderRef.current = null
    }
    setScanning(false)
  }

  const handleScan = useCallback(async (qrCode: string) => {
    // Debounce: prevent processing multiple scans using ref for immediate check
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    setIsProcessing(true)

    try {
      stopScanning()

      // Get the sign to verify QR code
      const { data: sign, error: signError } = await supabase
        .from('signs')
        .select('*')
        .eq('id', signId)
        .single()

      if (signError || !sign) {
        throw new Error('Sign not found')
      }

      // Normalize QR codes (trim whitespace)
      const scannedCode = qrCode.trim()
      const storedCode = sign.qr_code.trim()
      
      // Extract UUID from scanned code if it's a URL
      // QR codes might be encoded as URLs like "https://example.com/sign/{uuid}" or just the UUID
      let extractedCode = scannedCode
      
      // Try to extract UUID from URL if present
      const uuidMatch = scannedCode.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (uuidMatch) {
        extractedCode = uuidMatch[0]
      }
      
      // Compare (case-insensitive for UUIDs)
      const normalizedScanned = extractedCode.toLowerCase()
      const normalizedStored = storedCode.toLowerCase()
      
      // Verify QR code matches
      if (normalizedStored !== normalizedScanned) {
      setError('Invalid QR code. Please scan the correct sign.')
      isProcessingRef.current = false
      setIsProcessing(false)
      return
      }

      // Get user location (optional GPS validation)
      let gpsLat: number | null = null
      let gpsLng: number | null = null

      try {
        if (navigator.geolocation) {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 5000,
              maximumAge: 60000,
            })
          })
          gpsLat = position.coords.latitude
          gpsLng = position.coords.longitude

          // Validate GPS is within reasonable distance - warn but allow if too far
          calculateDistance(
            gpsLat,
            gpsLng,
            parseFloat(sign.lat.toString()),
            parseFloat(sign.lng.toString())
          )
        }
      } catch {
        // GPS failed, continue anyway - it's optional
      }

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('User not authenticated')
      }

      // Record discovery
      const { error: discoveryError } = await supabase
        .from('user_discoveries')
        .insert({
          user_id: user.id,
          sign_id: signId,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          qr_verified: true,
        })

      if (discoveryError) {
        // If already exists, that's okay - update instead
        if (discoveryError.code === '23505') {
          // Already discovered, update timestamp
          await supabase
            .from('user_discoveries')
            .update({ discovered_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('sign_id', signId)
        } else {
          throw discoveryError
        }
      }

      setSuccess(true)
      
      // Call success callback if provided
      if (onSuccess) {
        setTimeout(() => {
          onSuccess()
        }, 1500)
      } else {
        // Fallback: redirect after short delay
        setTimeout(() => {
          router.push(`/${resortSlug}/game/map`)
          router.refresh()
        }, 1500)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      isProcessingRef.current = false
      setIsProcessing(false)
    }
  }, [signId, supabase, onSuccess, router, resortSlug]) // Removed isProcessing from deps - using ref now

  // Calculate distance between two lat/lng points in kilometers
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371 // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          ✓ Successfully found the sign!
        </div>
      )}

      <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-64 bg-black object-cover"
          playsInline
        />
      </div>

      <div className="flex space-x-2">
        {!scanning ? (
          <button
            onClick={startScanning}
            className="flex-1 bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
          >
            Start Camera
          </button>
        ) : (
          <button
            onClick={stopScanning}
            className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition"
          >
            Stop Camera
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600 text-center">
        Position the QR code within the camera view
      </p>
    </div>
  )
}
