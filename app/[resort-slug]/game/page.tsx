import { redirect } from 'next/navigation'

export default async function GamePage({
  params,
}: {
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
  // Always redirect to map page
  redirect(`/${resolvedParams['resort-slug']}/game/map`)
}
