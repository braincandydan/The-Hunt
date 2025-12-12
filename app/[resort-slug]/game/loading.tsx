export default function GameLoading() {
  return (
    <div className="fixed inset-0 w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Loading game...</p>
      </div>
    </div>
  )
}



