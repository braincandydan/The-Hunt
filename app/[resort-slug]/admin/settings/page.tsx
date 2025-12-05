'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useParams } from 'next/navigation'

export default function AdminSettingsPage() {
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [themeConfig, setThemeConfig] = useState({
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    fontFamily: 'Inter, sans-serif',
    logoUrl: '',
  })

  useEffect(() => {
    loadResortSettings()
  }, [])

  const loadResortSettings = async () => {
    setLoading(true)
    try {
      const resortSlug = params['resort-slug'] as string
      const { data: resort } = await supabase
        .from('resorts')
        .select('*')
        .eq('slug', resortSlug)
        .single()

      if (resort && resort.theme_config) {
        setThemeConfig({
          primaryColor: resort.theme_config.primaryColor || '#6366f1',
          secondaryColor: resort.theme_config.secondaryColor || '#8b5cf6',
          fontFamily: resort.theme_config.fontFamily || 'Inter, sans-serif',
          logoUrl: resort.theme_config.logoUrl || '',
        })
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const resortSlug = params['resort-slug'] as string
      const { error: updateError } = await supabase
        .from('resorts')
        .update({
          theme_config: themeConfig,
        })
        .eq('slug', resortSlug)

      if (updateError) throw updateError

      // Apply theme immediately
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--color-primary', themeConfig.primaryColor)
        if (themeConfig.secondaryColor) {
          document.documentElement.style.setProperty('--color-secondary', themeConfig.secondaryColor)
        }
        if (themeConfig.fontFamily) {
          document.documentElement.style.setProperty('--font-family', themeConfig.fontFamily)
        }
      }

      alert('Settings saved successfully!')
    } catch (err: any) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="px-4 py-6">Loading...</div>
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Resort Settings</h1>
        <p className="mt-2 text-gray-600">Customize the appearance and branding</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-4">Theme Configuration</h2>
          
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label htmlFor="primaryColor" className="block text-sm font-medium text-gray-700 mb-2">
                Primary Color
              </label>
              <div className="flex space-x-2">
                <input
                  type="color"
                  id="primaryColor"
                  value={themeConfig.primaryColor}
                  onChange={(e) => setThemeConfig({ ...themeConfig, primaryColor: e.target.value })}
                  className="h-10 w-20 border border-gray-300 rounded"
                />
                <input
                  type="text"
                  value={themeConfig.primaryColor}
                  onChange={(e) => setThemeConfig({ ...themeConfig, primaryColor: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                  placeholder="#6366f1"
                />
              </div>
            </div>

            <div>
              <label htmlFor="secondaryColor" className="block text-sm font-medium text-gray-700 mb-2">
                Secondary Color
              </label>
              <div className="flex space-x-2">
                <input
                  type="color"
                  id="secondaryColor"
                  value={themeConfig.secondaryColor}
                  onChange={(e) => setThemeConfig({ ...themeConfig, secondaryColor: e.target.value })}
                  className="h-10 w-20 border border-gray-300 rounded"
                />
                <input
                  type="text"
                  value={themeConfig.secondaryColor}
                  onChange={(e) => setThemeConfig({ ...themeConfig, secondaryColor: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                  placeholder="#8b5cf6"
                />
              </div>
            </div>

            <div>
              <label htmlFor="fontFamily" className="block text-sm font-medium text-gray-700 mb-2">
                Font Family
              </label>
              <input
                type="text"
                id="fontFamily"
                value={themeConfig.fontFamily}
                onChange={(e) => setThemeConfig({ ...themeConfig, fontFamily: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Inter, sans-serif"
              />
              <p className="mt-1 text-sm text-gray-500">
                Use web-safe fonts or Google Fonts (e.g., "Roboto, sans-serif")
              </p>
            </div>

            <div>
              <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700 mb-2">
                Logo URL
              </label>
              <input
                type="url"
                id="logoUrl"
                value={themeConfig.logoUrl}
                onChange={(e) => setThemeConfig({ ...themeConfig, logoUrl: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="https://example.com/logo.png"
              />
              <p className="mt-1 text-sm text-gray-500">
                URL to your resort logo image
              </p>
              {themeConfig.logoUrl && (
                <div className="mt-2">
                  <img
                    src={themeConfig.logoUrl}
                    alt="Logo preview"
                    className="h-16 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}

