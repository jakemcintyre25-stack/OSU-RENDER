/** Stored browser preferences must not override the strict renderer option types.
 * Values are intentionally encoded as literal string booleans instead of
 * truthiness, because localStorage('false') is still a nonempty string.
 */
export function storedToggle(value: string | null, defaultValue = true): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
}
