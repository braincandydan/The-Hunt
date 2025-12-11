import { useEffect } from 'react'

/**
 * Custom hook to lock body scroll when a modal/overlay is open
 * Properly cleans up on unmount to prevent scroll lock being stuck
 * 
 * @param isLocked - Whether body scroll should be locked
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (isLocked) {
      // Store original overflow value
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      
      // Cleanup: restore original overflow on unmount or when unlocked
      return () => {
        document.body.style.overflow = originalOverflow || ''
      }
    }
  }, [isLocked])
}

export default useBodyScrollLock

