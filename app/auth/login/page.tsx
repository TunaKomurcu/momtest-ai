import { redirect } from 'next/navigation'

/**
 * Auth kaldırıldı — doğrudan dashboard'a yönlendir.
 */
export default function LoginPage() {
  redirect('/dashboard')
}
