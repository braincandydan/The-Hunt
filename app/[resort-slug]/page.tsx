import { redirect } from 'next/navigation'

export default async function ResortPage({
  params,
}: {
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
  // Always redirect to game page
  redirect(`/${resolvedParams['resort-slug']}/game`)
}
