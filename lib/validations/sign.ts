import { z } from 'zod'

// Validation schema for sign creation/update
export const signFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Sign name is required')
    .max(100, 'Sign name must be less than 100 characters')
    .trim(),
  
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .transform(val => val?.trim() || null),
  
  hint: z
    .string()
    .max(200, 'Hint must be less than 200 characters')
    .optional()
    .transform(val => val?.trim() || null),
  
  qr_code: z
    .string()
    .min(1, 'QR code is required')
    .max(100, 'QR code must be less than 100 characters')
    .regex(
      /^[a-zA-Z0-9-]+$/,
      'QR code can only contain letters, numbers, and hyphens'
    ),
  
  lat: z
    .number({ message: 'Latitude must be a number' })
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  
  lng: z
    .number({ message: 'Longitude must be a number' })
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  
  difficulty: z
    .enum(['easy', 'medium', 'hard'], {
      message: 'Invalid difficulty level',
    })
    .default('medium'),
  
  order_index: z
    .number()
    .int('Order index must be an integer')
    .min(0, 'Order index must be non-negative')
    .default(0),
  
  active: z.boolean().default(true),
})

// Type for the validated form data
export type SignFormData = z.infer<typeof signFormSchema>

// Helper to parse string coordinates to numbers for validation
export function parseSignFormData(data: {
  name: string
  description: string
  hint: string
  qr_code: string
  lat: string
  lng: string
  difficulty: string
  order_index: number
  active: boolean
}) {
  return signFormSchema.safeParse({
    ...data,
    lat: data.lat ? parseFloat(data.lat) : undefined,
    lng: data.lng ? parseFloat(data.lng) : undefined,
  })
}

