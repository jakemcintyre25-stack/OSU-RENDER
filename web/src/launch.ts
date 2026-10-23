/** Safe, shareable entry points for osu-render and One Miss Merchants.
 * Deep links contain public osu! score/user IDs only; they cannot select a
 * local file, set credentials, redirect to other origins or request deployment.
 */
export type LaunchTarget =
  | { kind: 'score'; id: number }
  | { kind: 'user'; id: number }
  | { kind: 'home' };

const validId = (raw: string | null, digits: number) => {
  if (raw === null || !new RegExp('^[1-9][0-9]{0,' + (digits - 1) + '}$').test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
};

export function parseLaunchTarget(search: string): LaunchTarget {
  const params = new URLSearchParams(search);
  // A score deep link takes priority over a user, matching the most specific
  // requested playback action. Invalid score IDs never trigger unsafe fetches.
  if (params.has('score')) {
    const id = validId(params.get('score'), 12);
    return id === null ? { kind: 'home' } : { kind: 'score', id };
  }
  if (params.has('user')) {
    const id = validId(params.get('user'), 10);
    return id === null ? { kind: 'home' } : { kind: 'user', id };
  }
  return { kind: 'home' };
}

export function scoreShareUrl(currentLocation: string, scoreId: number): string {
  if (!Number.isSafeInteger(scoreId) || scoreId <= 0 || scoreId > 999_999_999_999)
    throw new Error('Cannot share an invalid score ID');
  const url = new URL(currentLocation);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Unsupported replay link scheme');
  url.search = '';
  url.hash = '';
  url.searchParams.set('score', String(scoreId));
  return url.toString();
}

export function userShareUrl(currentLocation: string, osuUserId: number): string {
  if (!Number.isSafeInteger(osuUserId) || osuUserId <= 0 || osuUserId > 9_999_999_999)
    throw new Error('Cannot share an invalid osu! user ID');
  const url = new URL(currentLocation);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Unsupported user link scheme');
  url.search = '';
  url.hash = '';
  url.searchParams.set('user', String(osuUserId));
  return url.toString();
}
