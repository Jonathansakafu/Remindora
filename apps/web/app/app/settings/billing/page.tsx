'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Remindora is free with every feature included; old billing links land on Settings. */
export default function BillingRedirect() {
  const router = useRouter();
  useEffect(() => router.replace('/app/settings'), [router]);
  return null;
}
