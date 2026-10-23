/**
 * New accounts start on UTC. The apps adopt the device's zone the first time they
 * see a UTC account somewhere else, so "6pm" means 6pm where the user actually is.
 * A zone the user picked themselves (anything other than UTC) is never overwritten.
 */
export function timezoneToAdopt(accountZone: string | null | undefined, deviceZone: string | null | undefined): string | null {
  if (!deviceZone || deviceZone === 'UTC' || deviceZone === 'Etc/UTC') return null;
  if (accountZone && accountZone !== 'UTC') return null;
  return deviceZone;
}
