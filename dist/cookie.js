/**
 * Owner opt-out ("notrack"): cookie `qviks_no_track=1`, set by the SERVER on
 * every domain we track (Safari keeps server-set cookies a year, script-set 7
 * days). Not HttpOnly, so the green dot can read it. Safe to import anywhere.
 *
 * The switch for all our sites lives on Qviks: www.qviks.com/notrack.
 */
export const NOTRACK_COOKIE = "qviks_no_track";
export const NOTRACK_MAX_AGE = 60 * 60 * 24 * 365;
export const HUB_ORIGIN = "https://www.qviks.com";
export const HUB_URL = `${HUB_ORIGIN}/notrack`;
/** Is the opt-out cookie set in this Cookie header / document.cookie? */
export function hasNotrackCookie(cookieHeader) {
    return new RegExp(`(^|;\\s*)${NOTRACK_COOKIE}=1(;|$)`).test(cookieHeader ?? "");
}
