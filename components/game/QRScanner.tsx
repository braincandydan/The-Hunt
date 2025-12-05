'use client'

import { useState, useRef, useEffect } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface QRScannerProps {
  resortSlug: string
  signId: string
}

export default function QRScanner({ resortSlug, signId }: QRScannerProps) {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null)
  const router = useRouter()
  const supabase = createClient()

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
          if (result) {
            handleScan(result.getText())
          }
          if (err && err.name !== 'NotFoundException') {
            console.error('Scan error:', err)
          }
        }
      )
    } catch (err: any) {
      setError(err.message || 'Failed to start camera')
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

  const handleScan = async (qrCode: string) => {
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

      // Verify QR code matches
      if (sign.qr_code !== qrCode) {
        setError('Invalid QR code. Please scan the correct sign.')
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

          // Optional: Validate GPS is within reasonable distance (50m)
          // This is a simple distance check - can be enhanced
          const distance = calculateDistance(
            gpsLat,
            gpsLng,
            parseFloat(sign.lat.toString()),
            parseFloat(sign.lng.toString())
          )

          if (distance > 0.1) {
            // More than 100m away - warn but allow
            console.warn('User is far from sign location')
          }
        }
      } catch (geoError) {
        // GPS failed, continue anyway
        console.warn('GPS error:', geoError)
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
      
      // Redirect after short delay
      setTimeout(() => {
        router.push(`/${resortSlug}/game`)
        router.refresh()
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    }
  }

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
