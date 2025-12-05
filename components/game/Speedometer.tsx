'use client'

interface SpeedometerProps {
  current: number | null
  top: number
  average: number
}

export default function Speedometer({ current, top, average }: SpeedometerProps) {
  // Format speed for display
  const formatSpeed = (speed: number | null): string => {
    if (speed === null || speed === undefined || isNaN(speed)) return '--'
    return Math.round(speed).toString()
  }

  return (
    <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
      {/* Current Speed - Large Display */}
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <div className="text-xs text-gray-500 font-medium">Speed</div>
          <div className="text-xl sm:text-2xl font-bold text-gray-900">
            {formatSpeed(current)}
            <span className="text-xs sm:text-sm font-normal text-gray-500 ml-1">km/h</span>
          </div>
        </div>
      </div>

      {/* Top Speed */}
      <div className="flex items-center gap-2 border-l border-gray-200 pl-3 sm:pl-4">
        <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        <div className="flex flex-col">
          <div className="text-xs text-gray-500 font-medium">Top</div>
          <div className="text-base sm:text-lg font-bold text-red-600">
            {formatSpeed(top)}
            <span className="text-xs font-normal text-gray-500 ml-0.5">km/h</span>
          </div>
        </div>
      </div>

      {/* Average Speed */}
      <div className="flex items-center gap-2 border-l border-gray-200 pl-3 sm:pl-4">
        <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <div className="flex flex-col">
          <div className="text-xs text-gray-500 font-medium">Avg</div>
          <div className="text-base sm:text-lg font-bold text-blue-600">
            {formatSpeed(average)}
            <span className="text-xs font-normal text-gray-500 ml-0.5">km/h</span>
          </div>
        </div>
      </div>
    </div>
  )
}

