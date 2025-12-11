'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'
import { parseSignFormData } from '@/lib/validations/sign'

export default function EditSignPage() {
  const router = useRouter()
  const params = useParams()
  // Create Supabase client once using useMemo to prevent recreation on each render
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [gettingLocation, setGettingLocation] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    hint: '',
    qr_code: '',
    lat: '',
    lng: '',
    difficulty: 'medium',
    order_index: 0,
    active: true,
  })

  const loadSign = useCallback(async () => {
    try {
      const signId = params.id as string
      const { data: sign, error: signError } = await supabase
        .from('signs')
        .select('*')
        .eq('id', signId)
        .single()

      if (signError) throw signError

      setFormData({
        name: sign.name,
        description: sign.description || '',
        hint: sign.hint || '',
        qr_code: sign.qr_code,
        lat: sign.lat.toString(),
        lng: sign.lng.toString(),
        difficulty: sign.difficulty || 'medium',
        order_index: sign.order_index || 0,
        active: sign.active,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load sign'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [params.id, supabase])

  useEffect(() => {
    loadSign()
  }, [loadSign])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setFieldErrors({})

    // Validate form data using Zod schema
    const validationResult = parseSignFormData(formData)
    
    if (!validationResult.success) {
      // Extract field-level errors
      const errors: Record<string, string> = {}
      validationResult.error.issues.forEach((issue) => {
        const field = issue.path[0]?.toString() || 'form'
        errors[field] = issue.message
      })
      setFieldErrors(errors)
      setError('Please fix the validation errors below')
      setSaving(false)
      return
    }

    const validatedData = validationResult.data

    try {
      const signId = params.id as string
      const resortSlug = params['resort-slug'] as string
      
      const { error: updateError } = await supabase
        .from('signs')
        .update({
          name: validatedData.name,
          description: validatedData.description,
          hint: validatedData.hint,
          qr_code: validatedData.qr_code,
          lat: validatedData.lat,
          lng: validatedData.lng,
          difficulty: validatedData.difficulty,
          order_index: validatedData.order_index,
          active: validatedData.active,
        })
        .eq('id', signId)

      if (updateError) throw updateError

      router.push(`/${resortSlug}/admin/signs`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update sign'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      return
    }

    setGettingLocation(true)
    setLocationError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        setFormData({
          ...formData,
          lat: latitude.toFixed(8),
          lng: longitude.toFixed(8),
        })
        setGettingLocation(false)
      },
      (error) => {
        setGettingLocation(false)
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError('Location access denied. Please enable location permissions.')
            break
          case error.POSITION_UNAVAILABLE:
            setLocationError('Location information unavailable.')
            break
          case error.TIMEOUT:
            setLocationError('Location request timed out. Please try again.')
            break
          default:
            setLocationError('An error occurred while getting your location.')
            break
        }
      },
      {
        enableHighAccuracy: true, // Request high accuracy (uses GPS if available)
        timeout: 10000, // 10 second timeout
        maximumAge: 0, // Don't use cached position
      }
    )
  }

  if (loading) {
    return (
      <div className="px-4 py-6">
        <div>Loading...</div>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Edit Sign</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Sign Name *
          </label>
          <input
            type="text"
            id="name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="hint" className="block text-sm font-medium text-gray-700">
            Hint
          </label>
          <textarea
            id="hint"
            rows={2}
            value={formData.hint}
            onChange={(e) => setFormData({ ...formData, hint: e.target.value })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="Hint to help users find this sign"
          />
        </div>

        <div>
          <label htmlFor="qr_code" className="block text-sm font-medium text-gray-700">
            QR Code *
          </label>
          <input
            type="text"
            id="qr_code"
            required
            value={formData.qr_code}
            onChange={(e) => setFormData({ ...formData, qr_code: e.target.value })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Location *
            </label>
            <button
              type="button"
              onClick={getCurrentLocation}
              disabled={gettingLocation}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {gettingLocation ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Getting location...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Use Current Location
                </>
              )}
            </button>
          </div>
          {locationError && (
            <div className="mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {locationError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="lat" className="block text-sm font-medium text-gray-700">
                Latitude *
              </label>
              <input
                type="number"
                id="lat"
                required
                step="any"
                value={formData.lat}
                onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="39.8283"
              />
            </div>
            <div>
              <label htmlFor="lng" className="block text-sm font-medium text-gray-700">
                Longitude *
              </label>
              <input
                type="number"
                id="lng"
                required
                step="any"
                value={formData.lng}
                onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="-98.5795"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            GPS accuracy is typically 3-5 meters on mobile devices. You can fine-tune the coordinates after using your current location.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700">
              Difficulty
            </label>
            <select
              id="difficulty"
              value={formData.difficulty}
              onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label htmlFor="order_index" className="block text-sm font-medium text-gray-700">
              Order Index
            </label>
            <input
              type="number"
              id="order_index"
              value={formData.order_index}
              onChange={(e) => setFormData({ ...formData, order_index: parseInt(e.target.value) || 0 })}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center">
          <input
            id="active"
            type="checkbox"
            checked={formData.active}
            onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
          />
          <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
            Active (visible to users)
          </label>
        </div>

        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

