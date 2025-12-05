'use client'

import Speedometer from './Speedometer'

interface ProgressBarProps {
  foundCount: number
  totalCount: number
  speedData?: {
    current: number | null
    top: number
    average: number
  }
}

export default function ProgressBar({ foundCount, totalCount, speedData }: ProgressBarProps) {
  const percentage = totalCount > 0 ? (foundCount / totalCount) * 100 : 0

  return (
    <div className="fixed top-0 left-0 right-0 z-[1001] bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm">
      <div className="px-4 py-3 max-w-7xl mx-auto safe-area-top">
        <div className="flex flex-row items-center justify-between gap-4">
          {/* Progress Section - Left */}
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center text-sm mb-2">
              <span className="font-semibold text-gray-900">Progress</span>
              <span className="text-gray-600 font-medium">
                {foundCount} / {totalCount}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          {/* Speedometer Section - Right */}
          {speedData && (
            <div className="flex-shrink-0">
              <Speedometer 
                current={speedData.current} 
                top={speedData.top} 
                average={speedData.average} 
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

